# Area Estimation (Preprocessing)

Backend support for design-based area estimation in the style of Olofsson et al.
2014: a classified map is not trusted to report class areas by itself, it is
used only to stratify a probability sample whose reference labels give the
unbiased estimate. `backend/src/area_estimation/` is where a campaign admin
turns a classified map into that stratification.

**What is implemented today is preprocessing only**: uploading or linking a
map, reprojecting it onto a shared equal-area grid, counting pixels per map
value (the raw census), optionally splitting those counts by areas of
interest, and folding map values into reporting classes to get a strata
raster and a strata census. Drawing the stratified sample and computing the
area estimator (and its confidence interval) from reference labels are not
built yet - the strata raster and strata census are what a later sampling
step will consume.

## Why the map is only a stratification device

A classified map's own pixel counts are a biased area estimate: classification
error inflates some classes and deflates others, and the bias does not cancel
out. Olofsson-style estimation instead draws a probability sample (usually
stratified by the map's classes, since that concentrates sample on the classes
that matter), gets each sampled pixel a reference label, and computes area
from the sample's confusion matrix against the strata weights. The map decides
*where* to sample and how to weight the estimator; it never decides the
answer. That is why this module cares more about counting pixels correctly
and honestly than about the map being accurate.

## Pipeline

1. Upload the map as one or more GeoTIFF tiles, or link it by URL.
2. Optionally attach areas of interest (a GeoJSON file or a zipped shapefile)
   to get per-area counts alongside the map-wide total.
3. **Preprocess**: choose an equal-area CRS (and optionally a resolution),
   reproject every tile onto one grid with nearest resampling, and count
   pixels per map value - the raw census.
4. **Stratify**: fold the map's values into named reporting classes, writing
   a strata raster (one code per class) and a strata census with the same
   counts regrouped by class.

Re-running preprocess invalidates any strata already computed from the old
grid; changing the areas of interest invalidates both, since every count was
taken over the previous ones.

## Processing rules

These are enforced in `area_estimation/raster.py` and exist to keep a pixel
count something the sampling design can trust:

- **Nearest resampling only.** No pixel may hold a value interpolated from
  neighbours; every class code in the output came from the source unchanged.
- **GDAL is told the source has no nodata at all**, and reads back the
  footprint from the alpha band the warper adds. Which pixels count as inside
  the map is decided by our code, never inherited silently from the file's own
  nodata tag.
- **A declared nodata value that fits in the class range is still counted**,
  like any other value, and reported separately in `declared_nodata` - the
  design, not the file header, decides whether it is nodata or a class.
- **NaN, and a declared nodata that cannot be a class** (not an integer, or
  out of range), are masked out of the footprint instead.
- **Non-integer values, negative values, and values above 65534 are errors.**
  A stratification map needs one class code per pixel; anything else means the
  file is not what it claims to be.
- **Tiles may overlap, but only where they agree.** A pixel two tiles disagree
  on is an error - there is no rule for picking a winner that would not also
  silently pick the stratum weights.
- **Areas of interest must not overlap.** A pixel belongs to the area its
  centre falls in, so with non-overlapping areas every pixel is counted at
  most once.
- **A map value with no class and no nodata declaration fails stratification.**
  Letting it through would either drop it from the population or count it
  somewhere it does not belong.
- **Strata counts are re-counted independently from the strata raster** and
  must equal the raw census regrouped by the same class definitions. If they
  do not, preprocessing is treated as inconsistent and the job fails rather
  than publish a wrong census.

## The grid

Every map is reprojected onto one raster: `uint16`, nodata `65535`, tiled
512x512, deflate-compressed. The CRS is validated before a single pixel is
read - `equal_area_crs` accepts only PROJ coordinate operations whose method
name matches one of a known equal-area family (equal area, equal earth,
mollweide, sinusoidal, eckert iv, eckert vi, hammer, bonne, goode
homolosine), and rejects anything not measured in metres. When no resolution
is given, GDAL derives one from the first tile (`calculate_default_transform`),
which keeps the pixel count close to the source's own. `AREA_ESTIMATION_MAX_GRID_PIXELS`
caps the grid a request may ask for; a resolution that would exceed it is
rejected before any reprojection starts.

## Where a map lives

A map, its areas of interest, the products a job wrote and the records
describing them live in a *workspace* while the design is written. Records
are whole documents replaced atomically, so a reader in another process never
sees a half-written one. Two workspaces implement the same contract
(`workspace.Workspace`):

- `LocalWorkspace`: a directory on the machine running the backend, the
  default, under `AREA_ESTIMATION_WORKDIR` or the system temp dir.
- `BlobWorkspace` (`blob.py`): an Azure Blob container, chosen by
  `AREA_ESTIMATION_BLOB_CONTAINER_URL`. Every replica and every worker sees
  the same maps. GDAL reads sources and products in place through `/vsiaz/`
  with range requests, authorised by a user-delegation SAS the workspace mints
  from the managed identity and renews before it expires; nothing is copied
  to read a map and no account key is involved. Products are written to
  local scratch first, because a tiled GeoTIFF needs seeks while it is
  written, and uploaded when the job finishes.

Both use one key layout:

```
campaign-<id>/
  maps/<map_id>/
    map.json          # MapRecord: sources, info, areas, latest products
    sources/          # uploaded tiles only - never populated for linked URLs
    areas.geojson     # areas of interest, EPSG:4326
    reprojected.tif   # preprocess output
    strata.tif        # stratify output
  jobs/<job_id>.json  # JobRecord, one per job
```

Uploaded tiles are stored only for as long as the sampling design is being
worked on; nothing here is durable, backed up, or migrated. A linked map is
never copied at all: every job reads the URL directly, so it should point at
a cloud-optimized GeoTIFF. Before a linked URL is accepted,
`net_guard.assert_public_url` rejects anything that resolves to a private or
loopback address; this check is point-in-time only, since GDAL does its own
fetch later and nothing pins that connection to the address checked at link
time.

## The runner seam

`jobs.execute` needs only the map's files on disk and nothing about FastAPI,
the database, or the process serving requests - it runs the same wherever it
is called. A `Runner` decides where that call happens, chosen by
`AREA_ESTIMATION_RUNNER`:

- `local` (the default, what every install without Azure uses): `LocalRunner`
  runs the job on a daemon thread inside the backend process, against that
  process's own disk. Fine for county-sized maps; a country-sized warp
  competes with request handling for the same CPU.
- `azure`: `AzureJobRunner` starts one execution of an Azure Container Apps
  Job per submitted job. The job runs the backend image with
  `python -m src.area_estimation.worker`, which reads the job named in
  `AREA_ESTIMATION_JOB` from the blob workspace, executes it, and exits. The
  worker leaves exactly the records a local thread would and the backend
  polls them the same way, which is why this runner requires the blob
  workspace. The execution is started through the management API with the
  backend's managed identity; a start that fails marks the job failed at once
  rather than after the stale sweep. Setup is in
  `deployment/azure/README.md`, "Area estimation worker".

Liveness is heartbeat-based: a running job stamps `heartbeat_at` every 15
seconds, and a job whose heartbeat has not moved in 120 seconds is judged
stale on the next poll, swept to `failed`, and its map's `active_job_id`
released so another job can start. A queued job gets 10 minutes before it
counts as stale, since a worker spun up for it may still be pulling its
image; a worker that starts after its job was swept sees it is no longer
queued and exits. Recovery needs nothing from the dead process - it is read
off the job record alone.

The caveat the local workspace leaves: it assumes one machine. With several
backend replicas behind a load balancer, a map's files exist only on the
replica that received the upload; the blob workspace is what removes that,
with or without the Azure runner.

## The API

Every route is under `/api/campaigns/{campaign_id}/area-estimation` and
requires campaign admin access.

| Method & path | Purpose | Response |
|---|---|---|
| `POST /maps` | Store a map from one or more uploaded GeoTIFF tiles | `MapOut` (201) |
| `POST /maps/link` | Register a map hosted elsewhere by URL; nothing is copied | `MapOut` (201) |
| `GET /maps` | List the campaign's maps on this worker | `list[MapOut]` |
| `GET /maps/{map_id}` | Read one map | `MapOut` |
| `DELETE /maps/{map_id}` | Delete a map (rejected while a job is running) | 204 |
| `PUT /maps/{map_id}/areas` | Attach areas of interest (GeoJSON or zipped shapefile); replaces any previous set and clears its census | `MapOut` |
| `DELETE /maps/{map_id}/areas` | Clear areas of interest | `MapOut` |
| `POST /maps/{map_id}/preprocess` | Start a preprocess job (`PreprocessRequest`: band, CRS, optional resolution) | `JobOut` (202) |
| `POST /maps/{map_id}/stratify` | Start a stratify job (`StratifyRequest`: reporting classes, nodata values) | `JobOut` (202) |
| `GET /jobs/{job_id}` | Poll a job's status and result | `JobOut` |

`MapOut` carries the map's id, sources, header info, areas of interest, and
the latest preprocess and strata products (each a spec plus its census).
`JobOut` carries status (`queued`/`running`/`done`/`failed`), progress
(0..1, windows written over windows planned), an error message when failed,
and the result once done - a `RawCensus` for a preprocess job, a `StrataCensus`
for a stratify job. `RawCensus` holds pixel counts per map value, for the
whole footprint and per area of interest, plus `masked_pixels` and
`declared_nodata`. `StrataCensus` holds the same shape of counts keyed by
class id instead of raw value, plus the 1-based code each class holds in the
strata raster.

Typical flow: upload or link a map, optionally attach areas of interest,
start a preprocess job and poll it to completion, then start a stratify job
with reporting classes built from the raw census and poll that too. A map can
be re-preprocessed or re-stratified at any point while no job is running on
it; each run replaces the previous product.

## The wizard

The data step of the area estimation wizard (`frontend/src/features/areaEstimation/`)
is what calls these routes: choosing a file or a URL stores the map, adding a
boundary file sets its areas, and a count runs whenever there is a map without
one - after the upload, after the areas change, after a band change, and when
an edited projection is committed by leaving the field. The map's distinct
values come out of that count, since a GeoTIFF carries no class list, and are
named by hand. The plan itself is still kept in the browser's local storage;
stratify is not called until a sample is drawn, which is not built yet.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `AREA_ESTIMATION_WORKDIR` | unset (falls back to a directory under the system temp dir) | Where the workspace lives on disk |
| `AREA_ESTIMATION_MAX_UPLOAD_BYTES` | 4 GiB | Per-file upload limit, for map tiles and area files alike |
| `AREA_ESTIMATION_MAX_GRID_PIXELS` | 200,000,000,000 | Upper bound on the equal-area grid a preprocess request may create |
| `AREA_ESTIMATION_MAX_CONCURRENT_JOBS` | 1 | How many jobs `LocalRunner` runs at once, across all campaigns |
| `AREA_ESTIMATION_RUNNER` | `local` | `local` runs jobs in the backend; `azure` starts a Container Apps Job execution per job |
| `AREA_ESTIMATION_AZURE_JOB_ID` | unset | ARM resource id of that job; required with the `azure` runner |
| `AREA_ESTIMATION_AZURE_CLIENT_ID` | unset | Client id of the user-assigned identity to act as; unset means whatever the environment offers |
| `AREA_ESTIMATION_BLOB_CONTAINER_URL` | unset | Blob container to use as the workspace instead of the workdir; required with the `azure` runner |

## Throughput

Measured on a developer machine, warping plus census counting runs at
roughly 8 to 15 million pixels per second, single-threaded. That puts a
county-sized map at a few seconds, and a country-sized map at 30 m resolution
at tens of minutes. These numbers are indicative only - they depend on tile
count, source resolution, storage latency for linked URLs, and how much of
the grid a source actually covers.

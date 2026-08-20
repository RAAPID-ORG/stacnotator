# Tile Serving

STACNotator supports four tile serving modes for raster imagery. Each collection within uses one of these depending on its source configuration. Vector tiles (annotations, custom vector layers) never go through a tiler - see [Vector Tiles](#vector-tiles) below.

## Tile Providers

### 1. Microsoft Planetary Computer (MPC) - Recommended

MPC hosts its own TiTiler instance with free egress from their STAC catalog. When a collection uses an MPC STAC collection with first-valid compositing and no masking, tiles are served directly from MPC for fast loading.

**Flow:**
1. During campaign creation, a CQL2 search is registered with MPC's `/mosaic/register` endpoint per slice.
2. MPC returns a `searchId` (hash) that encodes the search parameters.
3. The `searchId` is baked into the tile URL together with visualization parameters (bands, rescale, colormap).
4. The frontend fetches tiles directly from MPC - no proxy, no extra latency.

**Limitations:** MPC only supports `pixel_selection=first` (first-valid compositing). Advanced features (masking, median/mean compositing) are not available and will automatically route through the self-hosted tiler instead.

### 2. Self-Hosted TiTiler

We host a [titiler-pgstac](https://github.com/RAAPID-ORG/stacnotator-tiler) service that can serve any STAC catalog. It handles all compositing methods, pixel masking, and other advanced rendering features. The tiler keeps the items in its **own pgstac index** - the backend never stores STAC items (see [tilers.md](tilers.md)).

**Flow:**
1. During campaign creation, the backend triggers an ingest on the tiler per slice (`POST /ingest`): the tiler runs the STAC-API search for the campaign's bounding box and that slice's date range and upserts the matching items into its pgstac index. Preloaded tilers skip this step.
2. The backend registers a search per slice (`POST /searches/register`, a CQL2 body with the slice's date range and the campaign's bounding box) and bakes the returned search id into the tile URL together with visualization parameters.
3. For each tile request, titiler-pgstac resolves the search's items overlapping the requested map tile from pgstac, sorted by cloud cover ASC then date DESC, limited to `max_items` (user-configurable, 1-10).
4. The tiler reads the COG data from remote storage, composites the mosaic, and returns the rendered tile.

**Performance considerations:**
- Tile rendering speed depends on network distance to the COG storage (Azure Blob, S3, etc.). Co-locating the tiler in the same cloud region as the data significantly reduces latency.
- For first-valid compositing, the tiler processes items sequentially and stops early once all pixels are filled (rio-tiler's `FirstMethod` with `exit_when_filled=True`). This avoids reading unnecessary COGs.
- Items are sorted by cloud cover (lowest first) if available, so the best imagery is tried first.

**Non-MPC STAC catalogs are experimental.** Different catalogs may require specific environment variables (e.g. AWS region for Digital Africa), authentication, or CQL2 filter adjustments. Some catalogs don't support CQL2 filtering - the tiler falls back to basic STAC query parameters in that case. Contributions of catalog-specific configuration templates are welcome.

Custom-map overlays (COG custom layers) also render on the hosted tiler: the backend registers them as single-COG pgstac searches (`POST /searches/register-cog`) on the default tiler in a background thread with `registering → ready/failed` status, and bakes the tile URL the same way.

### 3. Bring Your Own (XYZ)

Any standard XYZ tile URL (`https://.../{z}/{x}/{y}.png`) can be used directly. No STAC integration - the URL is passed through to the map as-is. Useful for pre-rendered tile services, custom tile servers, or hosted basemaps.

**Planet basemaps are this case**, filled in automatically. Planet publishes its temporal structure through the Basemaps API's *series* rather than STAC, and serves each mosaic as finished XYZ tiles, so `backend/src/planet/` only reads that structure: it lists the series a key can see and turns each mosaic's tile link into a storable `{api_key}` template (`planet/tiles.py` - the link Planet returns carries the live key, which never leaves the backend). The wizard expands a series into ordinary manual collections, one slice per mosaic. Nothing is searched or registered, so the slices are renderable the moment they are saved, and the tiles then take route 4 below. The browse endpoints are POSTs whose body names either an organization key or one provided for this campaign - a pasted key is a secret, and query strings reach access logs. Analytic series expose their renderings through Planet's `proc` parameter, giving one `SliceTileUrl` per visualization exactly as elsewhere.

### 4. Backend key proxy

XYZ templates that contain an `{api_key}` placeholder (key-protected providers and basemaps) are never passed to the map. The frontend rewrites them to backend endpoints (`/api/{campaign_id}/imagery/slices|basemaps/.../tiles/{z}/{x}/{y}`, see `proxyTile.ts`); the backend decrypts the provider key server-side (`imagery/proxy_router.py`), fetches the upstream tile, and returns it with long-lived caching. Requests are authorized via the same `tiler_token` cookie the hosted tiler uses, so the key never reaches the client.

## Per-Visualization Tile Provider Selection

Within a single collection, each visualization of each slice picks its provider independently (`provider_by_viz` in `imagery/registration.py`); a slice can be registered on both MPC and a hosted tiler at once, emitting one `SliceTileUrl` per visualization. An example could look like this

- **First-valid visualizations** on an MPC collection → served directly from MPC (fast).
- **Median-composite visualization** of the same slice → routed through the self-hosted tiler (slower but supports compositing).
- **Any visualization with pixel masking** (e.g. SCL mask for Sentinel-2) → routed through the self-hosted tiler.

This is determined automatically during registration based on each visualization's parameters. The stored `tile_provider` (`"mpc"` or the tiler name) is also what the frontend uses to decide whether a tile request is credentialed (cookie) or anonymous.

## Vector Tiles

Neither of these involves a tiler; they only share the z/x/y URL shape with raster tiles.

- **Annotations (MVT):** the backend renders open-mode annotations itself, straight from Postgres via `ST_AsMVT`. Endpoint: `GET /api/campaigns/{id}/annotations/tiles/{z}/{x}/{y}.pbf` in `backend/src/annotation/router.py`, with the pure query/validation logic in `backend/src/annotation/tiles.py`. Auth is the regular bearer + campaign access, not the `tiler_token` cookie. Each feature carries only `annotation_id` and `label_id`; the frontend styles by label and fetches full geometry on edit. Requests below `MIN_TILE_ZOOM` (9, mirrored by `ANNOTATION_TILE_MIN_ZOOM` in `map/compose.ts`) return an empty tile without touching the DB. Responses carry a `?v=` version that only changes when the map decides to fetch the tiles again: writes made while the page is open are drawn from a local overlay instead (`campaign/annotationDelta.ts`), and a 20s poll of `GET /annotations/changes` brings other annotators' work into that same overlay - creates and edits as rows, deletions as ids from the `deleted_annotations` tombstone table (`DELETION_RETENTION` in `annotation/constants.py`; a cursor older than that is told to refetch instead).
- **Custom vector layers (PMTiles):** campaign overlay layers (`custom_layers`) are static PMTiles files read directly from blob storage via HTTP range requests (`ol-pmtiles` in the frontend). Neither the backend nor a tiler is in the request path.

## Tile Bulkhead

Every DB-touching tile route on the backend (annotation MVT, the key proxy) must acquire a slot from a per-worker semaphore (`TILE_DB_SLOTS`, default half the DB pool) before opening a session (`backend/src/tile_bulkhead.py`). This caps tile traffic's share of the connection pool so a burst of tile requests degrades to 503s (rendered as empty tiles) instead of starving the API.

## STAC Search vs Visualization

Setting up imagery from a STAC catalog involves two distinct concerns:

**1. Search parameters** control *which items* are selected for the mosaic:
- **Date range** - the temporal window per slice.
- **Cloud cover filter** - maximum allowed `eo:cloud_cover` percentage.
- **Item sort order** - how items are ordered before compositing. For first-valid compositing, the first matching item wins, so sorting by cloud cover (lowest first) puts the clearest imagery first.
- **CQL2-JSON query** - the full search query, auto-generated from the above or manually customized.

**2. Visualization parameters** control *how selected items are rendered* into map tiles:
- **Bands/assets** - which spectral bands to map to RGB (e.g. B04/B03/B02 for true color).
- **Color formula** - perceptual tone mapping applied per-pixel (e.g. gamma, sigmoidal contrast, saturation). This is a deterministic transform: the same input value always produces the same output color, regardless of tile, region, or scene.
- **Rescale** - linear min/max stretch (e.g. `0,3000`). An alternative to color formula for simpler datasets.
- **Colormap** - for single-band data (e.g. NDVI with `rdylgn`).
- **Compositing method** - how overlapping items are combined (first-valid, median, mean, etc.).
- **Masking** - pixel exclusion based on a mask layer (e.g. Sentinel-2 SCL for clouds).

These two concerns are configured independently, including for the cover slice which can have its own search and visualization settings.

### Collection Presets

For commonly used STAC collections, sensible defaults are pre-filled when selecting the collection:

| Collection | Visualization | Notes |
|---|---|---|
| **Sentinel-2 L2A** | True Color from the pre-rendered `visual` asset (no color formula); False Color (`gamma RGB 3.7, saturation 1.5, sigmoidal RGB 15 0.35`); Agriculture/SWIR/Geology band combos (`gamma RGB 3.2, saturation 0.8, sigmoidal RGB 25 0.35`); NDVI | Color formula approach is robust to the processing baseline offset change (Jan 2022) - no rescale needed. |
| **Landsat C2 L2** | True Color + False Color and band combos with color formula (`gamma RGB 2.7, saturation 1.5, sigmoidal RGB 15 0.55`) | Adapted gamma/sigmoidal for Landsat's value range. |
| **HLS (S30 + L30)** | True Color + False Color with color formula (`gamma RGB 3.5, saturation 1.2, sigmoidal RGB 15 0.35`) | HLS is pre-harmonized by NASA - no baseline offset issue. |
| **Sentinel-1 GRD** | VV and VH backscatter with grayscale colormap, rescale `0,250` | MPC stores VV/VH as uint16 amplitude DNs. No cloud cover filtering (radar penetrates clouds). |
| **NAIP** | True color RGB from the `image` asset (`asset_bidx image|1,2,3`) | Pre-rendered 4-band aerial imagery. |

Further presets exist (Sentinel-2 L1C, Landsat C2 L1, Copernicus DEM, MODIS NDVI, Planet Ethiopia biweekly); see `frontend/src/features/campaigns/components/imagery/collectionPresets.ts` for the authoritative list. For collections without presets, the user configures bands and rendering manually via the band picker and visualization panel.

## STAC Search & Mosaic Registration

The mosaic registration process (for both MPC and self-hosted) works as follows:

1. The frontend builds a CQL2-JSON search query with `{sliceStart}` and `{sliceEnd}` datetime placeholders, including `sortby` for item ordering.
2. The backend replaces placeholders with actual dates per slice and injects the campaign's bounding box.
3. For MPC: the query is POSTed to MPC's register endpoint, returning a `searchId`.
4. For self-hosted: the query is registered on the tiler (`/searches/register`), returning a search id; the tiler resolves items from its own pgstac index at render time.

**Cloud cover filtering** uses `isNull OR <=` to handle collections without `eo:cloud_cover` (e.g. SAR data). Items without the property pass through instead of being excluded.

**Item sort order** is passed via the STAC API Sort Extension (`sortby`). The default for collections with cloud cover is `eo:cloud_cover ASC, datetime DESC` - lowest cloud cover first, then newest. This is especially important for first-valid compositing where the first matching item wins.

**Nodata handling:** COG files typically declare their nodata value in the GeoTIFF metadata (e.g. `nodata=0` for Sentinel-2). Both MPC and rio-tiler read this automatically - nodata pixels are masked and skipped during compositing. The `nodata` visualization parameter can override this for datasets with missing metadata.

## Frontend Tile Display

### Loading State
Tiles that haven't loaded yet show a neutral grey background (`bg-neutral-200`), distinct from both imagery content and the no-data pattern.

### Empty Slice Detection (204 No Content)
Each `ImageryContainer` (map window) probes the slice with a standalone fetch of the tile at the crosshair position. A 204 marks the slice as empty, as we consider this insufficient information for annotation, and renders a diagonal 45-degree hatch pattern over the whole window (the `NoImageryOverlay` SVG). This triggers:

- **Auto-resolve:** On an empty slice the container keeps probing neighbouring slices and auto-commits to the first non-empty one, marking every probed-empty slice along the way.
- **Auto-skip:** Hotkeys and timeline navigation skip empty slices.
- **Visual indicator:** The slice dropdown shows empty slices grayed out with "(no data)" but they remain manually selectable.
- **Per-view state:** Empty slice tracking is saved per view and restored when switching between views.

### Tile Prefetching

Cover slices for upcoming tasks are prefetched in the background to warm the browser cache so that when the user advances, tiles render instantly. Prefetching is scoped to the active view's collections only. It pauses while the active layer is loading and resumes when idle.

#### How it works

The preloader (`frontend/src/features/annotation/components/Map/tilePreloader.ts`) is an ad-hoc priority queue driven by a `setInterval` drain loop. For each prefetch job, it expands a URL template + extent + zoom into a list of concrete `{z}/{x}/{y}` tile URLs using OL's `createXYZ()` tile grid so that the coords match exactly what OL will later request, then loads each URL via a plain `<img>` element (capped at `MAX_CONCURRENT = 50` in flight). The `crossOrigin` attribute is chosen per URL to match the OL source: `use-credentials` for our tilers and the backend proxy (so the auth cookie is sent), `anonymous` otherwise. Preloads are marked `fetchPriority='low'` while active-layer tiles load with `'high'`.

`<img>` is used instead of `fetch()` because OpenLayers also loads tiles through `<img>` elements. Both mechanisms share the same browser HTTP cache partition, so an `<img>`-preloaded response is later served to OL's tile img as a cache hit. I noticed in the past aht mixing `fetch()` and `<img>` in some browsers seemt to put them in different cache partitions and the warming effect is lost.

#### Priorities

Five levels, lower number = higher priority:

| Priority | What | Zoom |
|---|---|---|
| P1 | Current task's **other** collections (cover slices) - so switching collection inside the same task is instant | current viewport zoom |
| P2 | **Next** task's active collection (cover slice) | main window viewport at default zoom |
| P3 | Next task's **other** collections (cover slices) | main window viewport at  default zoom |
| P4 | **Task after next's** active collection (cover slice) | main window viewport at  default zoom |
| P5 | Task after next's other collections (cover slices) | main window viewport at  default zoom |

P1 is enqueued once the active layer finishes its initial load for the current task (via `LayerManager.onBusyChange`). P2-P5 are enqueued when the preloader goes idle, so they only run once P1 has drained.

If a prefetched group accumulates enough consecutive tile-load errors with no successes (`EMPTY_TILE_THRESHOLD`), the group is auto-aborted and a fallback request is enqueued for the next slice in the same collection - so the annotator doesn't end up stuck waiting for an empty cover slice when they advance.

#### Lifecycle on task navigation

On `currentTaskIndex` change the preloader's queue is cleared and its internal URL-dedup cache is reset, then the new task's P1/P2/P3-etc jobs are enqueued from scratch. A generation counter (`generation++`) invalidates any stale bookkeeping from in-flight loads belonging to the previous task.

**Important:** in-flight `<img>` loads are deliberately **not** aborted on task change. Chromium coalesces concurrent same-URL `<img>` fetches into a single underlying network request, so aborting a preloader img via `img.src = ''` also aborts any OpenLayers tile img sharing that fetch. OL then transitions the affected tile to `TileState.ERROR`, which it never retries within a source, leaving scattered permanently-gray tiles on the map. Letting in-flight loads drain naturally is safe because (a) `MAX_CONCURRENT = 50` is enforced by an `inflight` counter that only decrements on real completion, so fast navigation cannot pile up requests, and (b) the generation guard already ignores stale results. In-flight loads are only aborted on preloader `dispose()` (component unmount).

### Tile Authentication in the Map

No token ever appears in tile URLs. Tiles from our own tilers and the backend key proxy are credentialed via the `HttpOnly` `tiler_token` cookie: the OL source is created with `crossOrigin: 'use-credentials'` so the browser attaches it automatically, and the custom load function (`tileLoadImagery` in `utils/tileLoading.ts`) refreshes the cookie when it nears expiry and marks active-layer requests `fetchPriority='high'`. Whether a URL is "ours" is derived from the stored `tile_provider` (anything not `mpc`) or from it being a proxied backend URL; MPC tiles load anonymously.

### Empty-tile / broken-source heuristic

Both `WindowMap` and the `TilePreloader` track per-source `tileloaderror` / `tileloadend` counts and fire an `onEmptyTiles` callback if `EMPTY_TILE_THRESHOLD` errors occur with zero successes. This is how a broken signed URL or a genuinely empty cover slice is detected and surfaced.

Because OL caches errored tiles permanently within a source, `WindowMap` also recreates its `XYZ` source (via `setSource(new XYZ(...))`) on task navigation. This resets the per-source error cache and lets a re-navigation recover from any stuck-error state even if the underlying URL is fine.

### Known rough edges - refactor candidate

The custom tile loading stack has grown organically across several waves of fixes (flaky MPC responses, empty-slice detection, hatch rendering, auth tokens, background prefetching, error-retry workarounds) and is now messier than it should be. In particular:

- The empty-tile heuristic is duplicated in **two** places (`WindowMap.tsx` event listeners and `tilePreloader.ts` `groupStats`) with slightly different counter semantics.
- `WindowMap` recreates its tile source on every task switch as a workaround for OL not retrying errored tiles - effectively a per-component "refresh" that is load-bearing but undocumented in the component's public API.
- The preloader shares a cache partition with OL by convention (both using `<img crossOrigin="anonymous">`) and any future change that moves OL to `fetch()`-based tile loading will silently break prefetch warming.
- Preloader pause/resume is driven by `LayerManager.onBusyChange` which assumes one dominant "active" layer; multi-layer views complicate the bookkeeping.
- The recent "do not abort in-flight on task switch" fix (coalescence-poisoning gray tiles) is a subtle invariant that lives only in code comments - if someone re-introduces an `_abortInflight()` call into `clear()` or `pause()`, the bug silently returns.
- There is no ERROR-state retry path on the **main** map source at all, so any tile that does end up errored (for any reason) stays gray until the user changes slice/collection/visualization.

A future refactor should: try to use more OL native semantics and less custom workarounds and try to remove duplicate code. In general it is still hard to follow along from the codebase, as the prefetching and tile-loading handling is split over multiple components.

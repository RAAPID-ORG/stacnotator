# Tile Serving

STACNotator supports three tile serving modes. Each collection within uses one of these depending on its source configuration.

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

We host a TiTiler service that can connect to any STAC catalog. It handles all compositing methods, pixel masking, and other advanced rendering features.

**Flow:**
1. During campaign creation, a STAC search is executed for each slice's date range and the campaign's bounding box.
2. All matching items (with their bounding boxes, cloud cover, and STAC hrefs) are stored in a PostGIS-enabled database with a GiST spatial index.
3. For each tile request, a `ST_Intersects` query finds items overlapping the requested map tile, sorted by cloud cover ASC then date DESC, limited to `max_items` (user-configurable, 1-10).
4. TiTiler reads the COG data from remote storage, composites the mosaic, and returns the rendered tile.

**Performance considerations:**
- Tile rendering speed depends on network distance to the COG storage (Azure Blob, S3, etc.). Co-locating the tiler in the same cloud region as the data significantly reduces latency.
- For first-valid compositing, the tiler processes items sequentially and stops early once all pixels are filled (rio-tiler's `FirstMethod` with `exit_when_filled=True`). This avoids reading unnecessary COGs.
- Items are sorted by cloud cover (lowest first) if available, so the best imagery is tried first.

**Non-MPC STAC catalogs are experimental.** Different catalogs may require specific environment variables (e.g. AWS region for Digital Africa), authentication, or CQL2 filter adjustments. Some catalogs don't support CQL2 filtering - the tiler falls back to basic STAC query parameters in that case. Contributions of catalog-specific configuration templates are welcome.

### 3. Bring Your Own (XYZ)

Any standard XYZ tile URL (`https://.../{z}/{x}/{y}.png`) can be used directly. No STAC integration - the URL is passed through to the map as-is. Useful for pre-rendered tile services, custom tile servers, or hosted basemaps.

## Per-Slice Tile Provider Selection

Within a single collection, the slices can use different tile providers. An example could look like this

- **Regular slices** with first-valid compositing on MPC → served directly from MPC (fast).
- **Cover slice** with median compositing → routed through the self-hosted tiler (slower but supports compositing).
- **Any slice with pixel masking** (e.g. SCL mask for Sentinel-2) → routed through the self-hosted tiler.

This is determined automatically during registration based on each slice's visualization parameters.

## STAC Search & Mosaic Registration

The mosaic registration process (for both MPC and self-hosted) works as follows:

1. The frontend builds a CQL2-JSON search query with `{sliceStart}` and `{sliceEnd}` datetime placeholders.
2. The backend replaces placeholders with actual dates per slice and injects the campaign's bounding box.
3. For MPC: the query is POSTed to MPC's register endpoint, returning a `searchId`.
4. For self-hosted: the query is executed via pystac-client, and matching items are stored in the database.

**Cloud cover filtering** uses `isNull OR <=` to handle collections without `eo:cloud_cover` (e.g. SAR data). Items without the property pass through instead of being excluded.

**Nodata handling:** COG files typically declare their nodata value in the GeoTIFF metadata (e.g. `nodata=0` for Sentinel-2). Both MPC and rio-tiler read this automatically - nodata pixels are masked and skipped during compositing. The `nodata` visualization parameter can override this for datasets with missing metadata.

## Frontend Tile Display

### Loading State
Tiles that haven't loaded yet show a neutral grey background (`bg-neutral-200`), distinct from both imagery content and the no-data pattern.

### Empty Tiles (204 No Content)
When a tile server returns 204, the tile is rendered with a diagonal hatching pattern (45-degree lines). This is handled by a custom OpenLayers tile load function (`tileLoadWithHatch`) that intercepts the fetch response.

### Empty Slice Detection
Each `ImageryContainer` (map window) monitors 204 reports from the tile loader. When the tile at the crosshair position returns 204, the slice is marked as empty as we consider this insufficient infromation for annotation. This triggers:

- **Auto-skip:** Hotkeys and timeline navigation skip empty slices.
- **Visual indicator:** The slice dropdown shows empty slices grayed out with "(no data)" but they remain manually selectable.
- **Per-view state:** Empty slice tracking is saved per view and restored when switching between views.

### Tile Prefetching
Cover slices for upcoming tasks are prefetched in the background to warm the browser cache. Prefetching is scoped to the active view's collections only. It pauses while the active layer is loading and resumes when idle. Prefetching is divided into multiple priorities:

- P1: Fetch cover slices from the current task at the main windows viewport.
- P2: Fetch the cover slices of the next task  (at main window viewport and default zoom).
- P3: Fetch the cover slices of the task after (at main window viewport and default zoom).

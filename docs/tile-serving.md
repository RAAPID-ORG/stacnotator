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
| **Sentinel-2 L2A** | True Color + False Color with color formula (`Gamma RGB 3.2 Saturation 0.8 Sigmoidal RGB 25 0.35`) | Color formula approach is robust to the processing baseline offset change (Jan 2022) - no rescale needed. |
| **Landsat C2 L2** | True Color + False Color with color formula (`Gamma RGB 3.5 Saturation 1.0 Sigmoidal RGB 20 0.35`) | Adapted gamma/sigmoidal for Landsat's value range. |
| **HLS (S30 + L30)** | True Color + False Color with color formula (`Gamma RGB 3.5 Saturation 1.2 Sigmoidal RGB 15 0.35`) | HLS is pre-harmonized by NASA - no baseline offset issue. |
| **Sentinel-1 GRD** | VV and VH backscatter with grayscale colormap, rescale `0,0.4` / `0,0.1` | SAR data in linear sigma0 power scale. No cloud cover filtering (radar penetrates clouds). |
| **NAIP** | True color RGB from the `image` asset | Pre-rendered 4-band aerial imagery, rescale `0,255`. |

For collections without presets, the user configures bands and rendering manually via the band picker and visualization panel.

## STAC Search & Mosaic Registration

The mosaic registration process (for both MPC and self-hosted) works as follows:

1. The frontend builds a CQL2-JSON search query with `{sliceStart}` and `{sliceEnd}` datetime placeholders, including `sortby` for item ordering.
2. The backend replaces placeholders with actual dates per slice and injects the campaign's bounding box.
3. For MPC: the query is POSTed to MPC's register endpoint, returning a `searchId`.
4. For self-hosted: the query is executed via pystac-client, and matching items are stored in the database.

**Cloud cover filtering** uses `isNull OR <=` to handle collections without `eo:cloud_cover` (e.g. SAR data). Items without the property pass through instead of being excluded.

**Item sort order** is passed via the STAC API Sort Extension (`sortby`). The default for collections with cloud cover is `eo:cloud_cover ASC, datetime DESC` - lowest cloud cover first, then newest. This is especially important for first-valid compositing where the first matching item wins.

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

Cover slices for upcoming tasks are prefetched in the background to warm the browser cache so that when the user advances, tiles render instantly. Prefetching is scoped to the active view's collections only. It pauses while the active layer is loading and resumes when idle.

#### How it works

The preloader (`frontend/src/features/annotation/components/Map/tilePreloader.ts`) is an ad-hoc priority queue driven by a `setInterval` drain loop. For each prefetch job, it expands a URL template + extent + zoom into a list of concrete `{z}/{x}/{y}` tile URLs using OL's `createXYZ()` tile grid so that the coords match exactly what OL will later request, then loads each URL via a plain `<img crossOrigin="anonymous">` element (capped at `MAX_CONCURRENT = 50` in flight).

`<img>` is used instead of `fetch()` because OpenLayers also loads tiles through `<img crossOrigin="anonymous">`. Both mechanisms share the same browser HTTP cache partition, so an `<img>`-preloaded response is later served to OL's tile img as a cache hit. I noticed in the past aht mixing `fetch()` and `<img>` in some browsers seemt to put them in different cache partitions and the warming effect is lost.

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

### Custom Tile Load Functions

OpenLayers tile sources are configured with custom `tileLoadFunction`s in a few places:

- **`tileLoadWithHatch`** - intercepts fetch responses and renders a 45° hatch pattern on `204 No Content` replies (used for empty/no-data slice detection, see above).
- **`tileLoadWithAuth`** - appends a short-lived tiler auth token (`?token=...`) to self-hosted tiler URLs before loading, refreshing the token as needed.

Only the self-hosted tiler uses `tileLoadWithAuth`. MPC tiles go through the default loader.

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

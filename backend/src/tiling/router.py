import hashlib
import json
import logging
import time

import httpx
import numpy as np
from fastapi import APIRouter, HTTPException, Query
from rio_tiler.models import ImageData

from src.tiling.schemas import (
    MosaicRegisterRequest,
    MosaicRegisterResponse,
    SearchRequest,
    SearchResponse,
    StatsRequest,
    StatsResponse,
)
from src.tiling.stac_client import get_client, search_items
from src.tiling.stac_client import list_collections as _list_collections
from src.tiling.stac_reader import PCSignedSTACReader

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stac", tags=["STAC Browser"])

# ── Config ─────────────────────────────────────────────────────────────

STACINDEX_URL = "https://stacindex.org/api/catalogs"
STACINDEX_CACHE_TTL = 3600  # 1 hour
MPC_API_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

# Catalogs known to require authentication
_AUTH_REQUIRED_CATALOGS = {"usgs-m2m", "maxar"}


# ── Catalogs ───────────────────────────────────────────────────────────

_catalogs_cache: dict = {"data": None, "expires": 0}


@router.get("/catalogs")
async def list_catalogs():
    """Proxy StacIndex API with caching. Returns public STAC API catalogs."""
    now = time.time()
    if _catalogs_cache["data"] and now < _catalogs_cache["expires"]:
        return _catalogs_cache["data"]

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(STACINDEX_URL)
            resp.raise_for_status()
            all_catalogs = resp.json()
    except Exception as e:
        logger.error("Failed to fetch StacIndex catalogs: %s", e)
        if _catalogs_cache["data"]:
            return _catalogs_cache["data"]
        raise HTTPException(status_code=502, detail=f"StacIndex unavailable: {e}") from e

    filtered = []
    # MPC pinned at top
    filtered.append(
        {
            "id": "mpc",
            "title": "Microsoft Planetary Computer",
            "url": MPC_API_URL,
            "summary": "The Planetary Computer - petabytes of Earth observation data",
            "is_mpc": True,
            "auth_required": False,
        }
    )

    for cat in all_catalogs:
        if not cat.get("isApi"):
            continue
        url = cat.get("url", "")
        if "planetarycomputer" in url:
            continue
        cat_id = cat.get("id") or cat.get("slug", "")
        filtered.append(
            {
                "id": cat_id,
                "title": cat.get("title", ""),
                "url": url,
                "summary": cat.get("summary", ""),
                "is_mpc": False,
                "auth_required": cat_id in _AUTH_REQUIRED_CATALOGS,
            }
        )

    _catalogs_cache["data"] = filtered
    _catalogs_cache["expires"] = now + STACINDEX_CACHE_TTL
    return filtered


# ── Collections ────────────────────────────────────────────────────────


@router.get("/collections")
async def get_collections(catalog_url: str = Query(..., description="STAC API URL")):
    """List collections from a STAC API catalog."""
    try:
        return _list_collections(catalog_url)
    except Exception as e:
        logger.error("Failed to list collections from %s: %s", catalog_url, e)
        raise HTTPException(status_code=502, detail=f"Failed to connect to catalog: {e}") from e


# ── Search ─────────────────────────────────────────────────────────────


@router.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    """Search STAC items in a catalog collection."""
    try:
        items = search_items(
            catalog_url=request.catalog_url,
            collection_id=request.collection_id,
            bbox=request.bbox,
            datetime_range=request.datetime_range,
            limit=request.limit,
        )
        return {"items": items, "count": len(items)}
    except Exception as e:
        logger.error("STAC search failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Search failed: {e}") from e


# ── Mosaic Registration ───────────────────────────────────────────────
#
# Searches items for a time window, stores item refs in memory.
# TiTiler's built-in mosaic endpoint is used for actual tile serving
# when a MosaicJSON document is provided. For simpler cases, we store
# item refs and composite on the fly (like geo-ai-agents).

_mosaic_store: dict[str, dict] = {}


@router.post("/mosaic/register", response_model=MosaicRegisterResponse)
async def register_mosaic(request: MosaicRegisterRequest):
    """Create a mosaic from STAC search results for a single time window.

    Searches items via pystac_client, stores item refs server-side.
    Called once per slice at campaign creation time, not at browse time.
    """
    max_items = request.max_items or 500

    client = get_client(request.catalog_url)
    search = client.search(
        collections=[request.collection_id],
        bbox=request.bbox,
        datetime=request.datetime_range,
        max_items=max_items,
    )
    items = list(search.items())

    if not items:
        raise HTTPException(status_code=400, detail="No items found matching search criteria")

    item_refs = []
    for item in items:
        href = item.get_self_href()
        item_bbox = list(item.bbox) if item.bbox else None
        item_dt = item.datetime.isoformat() if item.datetime else None
        if href and item_bbox:
            item_refs.append(
                {
                    "href": href,
                    "bbox": item_bbox,
                    "id": item.id,
                    "datetime": item_dt,
                }
            )

    if not item_refs:
        raise HTTPException(status_code=400, detail="No items with valid self_href and bbox")

    # Discover available assets from first item
    sample_item = items[0]
    assets_info = {}
    for key, asset in sample_item.assets.items():
        assets_info[key] = {
            "title": asset.title or key,
            "type": asset.media_type or "",
            "roles": asset.roles or [],
        }

    # Stable ID from search params
    key_data = json.dumps(
        {
            "catalog_url": request.catalog_url,
            "collection_id": request.collection_id,
            "bbox": request.bbox,
            "datetime_range": request.datetime_range,
        },
        sort_keys=True,
    )
    mosaic_id = hashlib.sha256(key_data.encode()).hexdigest()[:16]

    _mosaic_store[mosaic_id] = {
        "item_refs": item_refs,
        "item_count": len(item_refs),
        "bbox": request.bbox,
        "catalog_url": request.catalog_url,
        "collection_id": request.collection_id,
        "pixel_selection": request.pixel_selection,
        "assets_info": assets_info,
    }

    return {
        "mosaic_id": mosaic_id,
        "item_count": len(item_refs),
        "assets": assets_info,
    }


# ── Mosaic Tiles ──────────────────────────────────────────────────────


def _get_items_for_tile(mosaic_id: str, tile_bbox: list[float], limit: int = 20) -> list[dict]:
    """Get mosaic items that intersect a tile bbox."""
    entry = _mosaic_store.get(mosaic_id)
    if not entry:
        return []

    tx0, ty0, tx1, ty1 = tile_bbox
    matching = []
    for ref in entry["item_refs"]:
        ix0, iy0, ix1, iy1 = ref["bbox"]
        if not (ix0 <= tx1 and ix1 >= tx0 and iy0 <= ty1 and iy1 >= ty0):
            continue
        matching.append(ref)
        if len(matching) >= limit:
            break
    return matching


@router.get("/mosaic/{mosaic_id}/tiles/{z}/{x}/{y}.png")
async def mosaic_tile(
    mosaic_id: str,
    z: int,
    x: int,
    y: int,
    assets: list[str] = Query(default=[]),
    asset_as_band: bool = Query(default=False),
    expression: str | None = Query(default=None),
    rescale: list[str] = Query(default=[]),
    colormap_name: str | None = Query(default=None),
    color_formula: str | None = Query(default=None),
    resampling: str | None = Query(default=None),
    compositing: str = Query(default="first"),
):
    """Serve a tile from a mosaic with compositing."""
    import morecantile
    from fastapi.responses import Response

    mosaic = _mosaic_store.get(mosaic_id)
    if not mosaic:
        raise HTTPException(status_code=404, detail="Mosaic not found")

    if not assets and not expression:
        raise HTTPException(status_code=400, detail="Specify assets or expression")

    tms = morecantile.tms.get("WebMercatorQuad")
    tile_bounds = tms.bounds(morecantile.Tile(x, y, z))
    tile_bbox = [tile_bounds.left, tile_bounds.bottom, tile_bounds.right, tile_bounds.top]

    matching_items = _get_items_for_tile(mosaic_id, tile_bbox)
    if not matching_items:
        return Response(content=_empty_tile(), media_type="image/png")

    # Build reader kwargs
    reader_kwargs: dict = {}
    if expression:
        reader_kwargs["expression"] = expression
    elif assets:
        reader_kwargs["assets"] = tuple(assets)
        if asset_as_band:
            reader_kwargs["asset_as_band"] = True

    if compositing == "first":
        img = _composite_first(matching_items, x, y, z, reader_kwargs)
    else:
        img = _composite_aggregate(matching_items, x, y, z, reader_kwargs, compositing)

    if img is None:
        return Response(content=_empty_tile(), media_type="image/png")

    # Apply rescale
    if rescale:
        in_range = []
        for r in rescale:
            parts = r.split(",")
            if len(parts) == 2:
                in_range.append((float(parts[0]), float(parts[1])))
        if in_range:
            img.rescale(in_range=in_range)

    if color_formula:
        img.apply_color_formula(color_formula)

    render_kwargs: dict = {}
    if colormap_name:
        from rio_tiler.colormap import cmap

        render_kwargs["colormap"] = cmap.get(colormap_name)

    content = img.render(img_format="PNG", **render_kwargs)
    return Response(content=content, media_type="image/png")


# ── Stats ─────────────────────────────────────────────────────────────


@router.post("/stats", response_model=StatsResponse)
async def sampled_stats(request: StatsRequest):
    """Return a rescale range for the requested assets.

    Priority: 1) STAC raster:bands metadata  2) Sampled chip reads
    """
    client = get_client(request.catalog_url)

    raster_rescale = _rescale_from_raster_extension(
        client,
        request.collection_id,
        request.assets,
        request.bbox,
        request.datetime_range,
        request.max_cloud_cover,
    )
    if raster_rescale:
        return {"rescale": raster_rescale, "source": "raster_extension"}

    rescale = _rescale_from_chips(
        client,
        request.collection_id,
        request.assets,
        request.bbox,
        request.datetime_range,
        request.max_cloud_cover,
    )
    if rescale:
        return {"rescale": rescale, "source": "sampled_chips"}

    raise HTTPException(status_code=404, detail="Could not determine rescale range")


# ── Compositing helpers ───────────────────────────────────────────────


def _composite_first(items, x, y, z, kwargs):
    """First-valid-pixel compositing."""
    for item_ref in items:
        try:
            with PCSignedSTACReader(item_ref["href"]) as src:
                img = src.tile(x, y, z, **kwargs)
                if img.mask.any():
                    return img
        except Exception as e:
            logger.debug("Tile read failed for %s: %s", item_ref["id"], e)
            continue
    return None


def _composite_aggregate(items, x, y, z, kwargs, method):
    """Pixel-level aggregation compositing (mean, median, max, min)."""
    arrays = []
    masks = []
    for item_ref in items:
        try:
            with PCSignedSTACReader(item_ref["href"]) as src:
                img = src.tile(x, y, z, **kwargs)
                if img.mask.any():
                    arrays.append(img.data.astype(np.float64))
                    masks.append(img.mask)
        except Exception as e:
            logger.debug("Tile read failed for %s: %s", item_ref["id"], e)
            continue

    if not arrays:
        return None

    if len(arrays) == 1:
        return ImageData(arrays[0].astype(np.uint16), masks[0])

    stacked = np.stack(arrays)
    stacked_masks = np.stack(masks)

    valid_counts = stacked_masks.sum(axis=0)
    valid_counts = np.maximum(valid_counts, 1)

    masked_data = stacked * stacked_masks

    if method == "mean":
        result = masked_data.sum(axis=0) / valid_counts
    elif method == "median":
        masked = np.ma.array(stacked, mask=~stacked_masks.astype(bool))
        result = np.ma.median(masked, axis=0).data
    elif method == "max":
        masked = np.ma.array(stacked, mask=~stacked_masks.astype(bool))
        result = np.ma.max(masked, axis=0).data
    elif method == "min":
        masked = np.ma.array(stacked, mask=~stacked_masks.astype(bool))
        result = np.ma.min(masked, axis=0).data
    else:
        return ImageData(arrays[0].astype(np.uint16), masks[0])

    combined_mask = stacked_masks.any(axis=0).astype(np.uint8) * 255
    return ImageData(result.astype(np.uint16), combined_mask)


def _empty_tile() -> bytes:
    """Generate a fully transparent 256x256 PNG tile."""
    from io import BytesIO

    from PIL import Image

    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ── Stats helpers ─────────────────────────────────────────────────────

CHIP_SIZE_DEG = 0.02
CHIP_MAX_SIZE = (256, 256)
TEMPORAL_SAMPLES = 4
SPATIAL_SAMPLES = 4


def _rescale_from_raster_extension(
    client, collection_id, assets, bbox, datetime_range, max_cloud_cover
) -> str | None:
    """Extract min/max from STAC raster:bands extension on a sample item."""
    search_kwargs: dict = {"collections": [collection_id], "max_items": 1}
    if bbox:
        search_kwargs["bbox"] = bbox
    if datetime_range:
        search_kwargs["datetime"] = datetime_range
    if max_cloud_cover is not None:
        search_kwargs["query"] = {"eo:cloud_cover": {"lte": max_cloud_cover}}

    try:
        items = list(client.search(**search_kwargs).items())
    except Exception:
        return None
    if not items:
        return None

    item = items[0]
    all_mins: list[float] = []
    all_maxs: list[float] = []

    for asset_key in assets:
        asset = item.assets.get(asset_key)
        if not asset:
            continue

        raster_bands = (asset.extra_fields or {}).get("raster:bands")
        if not raster_bands or not isinstance(raster_bands, list):
            continue

        for band in raster_bands:
            stats = band.get("statistics")
            if stats and "minimum" in stats and "maximum" in stats:
                all_mins.append(float(stats["minimum"]))
                all_maxs.append(float(stats["maximum"]))
                continue

            if "minimum" in band and "maximum" in band:
                all_mins.append(float(band["minimum"]))
                all_maxs.append(float(band["maximum"]))

    if not all_mins or not all_maxs:
        return None

    return f"{round(min(all_mins))},{round(max(all_maxs))}"


def _rescale_from_chips(
    client, collection_id, assets, bbox, datetime_range, max_cloud_cover
) -> str | None:
    """Compute rescale by reading small chips spread across time and space."""

    sample_points = _spread_points(bbox, SPATIAL_SAMPLES) if bbox else [(0, 0)]
    time_windows = _split_time_range(datetime_range, TEMPORAL_SAMPLES)

    reader_kwargs: dict = {"assets": tuple(assets)}
    if len(assets) == 3:
        reader_kwargs["asset_as_band"] = True

    all_pixels: list[np.ndarray] = []

    for dt_range in time_windows:
        for lng, lat in sample_points:
            chip_bbox = [
                lng - CHIP_SIZE_DEG / 2,
                lat - CHIP_SIZE_DEG / 2,
                lng + CHIP_SIZE_DEG / 2,
                lat + CHIP_SIZE_DEG / 2,
            ]
            search_kwargs: dict = {
                "collections": [collection_id],
                "bbox": chip_bbox,
                "max_items": 1,
            }
            if dt_range:
                search_kwargs["datetime"] = dt_range
            if max_cloud_cover is not None:
                search_kwargs["query"] = {"eo:cloud_cover": {"lte": max_cloud_cover}}

            try:
                items = list(client.search(**search_kwargs).items())
                if not items:
                    continue

                with PCSignedSTACReader(items[0].get_self_href()) as src:
                    img = src.part(chip_bbox, max_size=CHIP_MAX_SIZE, **reader_kwargs)
                    valid = img.mask > 0
                    if not valid.any():
                        continue
                    for band_idx in range(img.data.shape[0]):
                        band_data = img.data[band_idx][valid].astype(np.float64)
                        if band_data.size > 0:
                            all_pixels.append(band_data)
            except Exception as e:
                logger.debug("Stats chip read failed at (%.3f,%.3f): %s", lng, lat, e)
                continue

    if not all_pixels:
        return None

    combined = np.concatenate(all_pixels)
    p2 = float(np.percentile(combined, 2))
    p98 = float(np.percentile(combined, 98))
    return f"{round(p2)},{round(p98)}"


def _spread_points(bbox: list[float] | None, n: int) -> list[tuple[float, float]]:
    """Generate n points spread across a bbox."""
    import random

    if not bbox:
        return [(0, 0)]
    w, s, e, n_lat = bbox
    lng_range = e - w
    lat_range = n_lat - s

    cols = max(1, round(n**0.5))
    rows = max(1, (n + cols - 1) // cols)

    points = []
    lng_step = lng_range / (cols + 1)
    lat_step = lat_range / (rows + 1)
    jitter = min(lng_step, lat_step) * 0.2

    for r in range(rows):
        for c in range(cols):
            if len(points) >= n:
                break
            lng = w + lng_step * (c + 1) + random.uniform(-jitter, jitter)
            lat = s + lat_step * (r + 1) + random.uniform(-jitter, jitter)
            lng = max(w + CHIP_SIZE_DEG, min(e - CHIP_SIZE_DEG, lng))
            lat = max(s + CHIP_SIZE_DEG, min(n_lat - CHIP_SIZE_DEG, lat))
            points.append((lng, lat))

    return points


def _split_time_range(datetime_range: str | None, n: int) -> list[str | None]:
    """Split a datetime range into n sub-windows."""
    if not datetime_range:
        return [None]

    parts = datetime_range.split("/")
    if len(parts) != 2:
        return [datetime_range]

    from datetime import datetime as dt

    t0 = dt.fromisoformat(parts[0].replace("Z", "+00:00"))
    t1 = dt.fromisoformat(parts[1].replace("Z", "+00:00"))
    step = (t1 - t0) / n

    windows = []
    for i in range(n):
        ws = (t0 + step * i).strftime("%Y-%m-%dT%H:%M:%SZ")
        we = (t0 + step * (i + 1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        windows.append(f"{ws}/{we}")
    return windows

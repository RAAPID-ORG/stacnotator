"""Rescale range estimation from STAC items."""

import logging
import random
from datetime import datetime as dt

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.reader import PCSignedSTACReader
from src.stac_client import get_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/stac", tags=["Stats"])

CHIP_SIZE_DEG = 0.02
CHIP_MAX_SIZE = (256, 256)
TEMPORAL_SAMPLES = 4
SPATIAL_SAMPLES = 4


class StatsRequest(BaseModel):
    catalog_url: str
    collection_id: str
    assets: list[str]
    bbox: list[float] | None = None
    datetime_range: str | None = None
    max_cloud_cover: float | None = None


class StatsResponse(BaseModel):
    rescale: str
    source: str


@router.post("/stats", response_model=StatsResponse)
def sampled_stats(request: StatsRequest):
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
                lng - CHIP_SIZE_DEG / 2, lat - CHIP_SIZE_DEG / 2,
                lng + CHIP_SIZE_DEG / 2, lat + CHIP_SIZE_DEG / 2,
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
    if not datetime_range:
        return [None]
    parts = datetime_range.split("/")
    if len(parts) != 2:
        return [datetime_range]
    t0 = dt.fromisoformat(parts[0].replace("Z", "+00:00"))
    t1 = dt.fromisoformat(parts[1].replace("Z", "+00:00"))
    step = (t1 - t0) / n
    windows = []
    for i in range(n):
        ws = (t0 + step * i).strftime("%Y-%m-%dT%H:%M:%SZ")
        we = (t0 + step * (i + 1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        windows.append(f"{ws}/{we}")
    return windows

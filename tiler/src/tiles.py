"""Mosaic tile serving - reads item refs from DB, composites via rio-tiler."""

import logging
import struct
import time
import zlib

import morecantile
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from rio_tiler.colormap import cmap as rio_cmap
from rio_tiler.mosaic import mosaic_reader
from rio_tiler.mosaic.methods import defaults as mosaic_defaults
from rio_tiler.mosaic.methods.base import MosaicMethodBase
from sqlalchemy import text
from sqlalchemy.orm import Session

from src.database import get_db
from src.models import MosaicItem
from src.reader import PCSignedSTACReader

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/stac", tags=["Tiles"])

PIXEL_SELECTION_METHODS = {
    "first": mosaic_defaults.FirstMethod,
    "highest": mosaic_defaults.HighestMethod,
    "lowest": mosaic_defaults.LowestMethod,
    "mean": mosaic_defaults.MeanMethod,
    "median": mosaic_defaults.MedianMethod,
    "stdev": mosaic_defaults.StdevMethod,
}


class NDVIBestMethod(MosaicMethodBase):
    """Select pixels with highest NDVI score across items.

    Expects the last two bands to be NIR and Red (appended by the caller).
    Output is trimmed to the first n_display_bands.
    """

    def __init__(self, n_display_bands: int):
        super().__init__()
        self.n_display_bands = n_display_bands
        self._best_score = None

    def feed(self, array):
        nir = array[-2].astype(float)
        red = array[-1].astype(float)
        score = np.where((nir + red) == 0, -1, (nir - red) / (nir + red))
        if self.mosaic is None:
            self.mosaic = array
            self._best_score = score
        else:
            better = score > self._best_score
            self.mosaic[:, better] = array[:, better]
            self._best_score = np.maximum(self._best_score, score)

    @property
    def data(self):
        return self.mosaic[: self.n_display_bands]



def _get_items_for_tile(
    mosaic_id: str, tile_bbox: list[float], limit: int, db: Session
) -> list[dict]:
    """Find items intersecting this tile using PostGIS spatial index.

    Returns items sorted by cloud_cover ASC (nulls last), datetime DESC.
    Falls back to Python bbox check if geom column is not populated.
    """
    west, south, east, north = tile_bbox
    tile_wkt = (
        f"SRID=4326;POLYGON(({west} {south},{east} {south},"
        f"{east} {north},{west} {north},{west} {south}))"
    )

    rows = (
        db.execute(
            text(
                """
                SELECT item_id, href, bbox_west, bbox_south, bbox_east, bbox_north
                FROM data.mosaic_items
                WHERE mosaic_id = :mosaic_id
                  AND ST_Intersects(geom, ST_GeomFromEWKT(:tile_wkt))
                ORDER BY cloud_cover ASC NULLS LAST, datetime DESC
                LIMIT :limit
                """
            ),
            {"mosaic_id": mosaic_id, "tile_wkt": tile_wkt, "limit": limit},
        )
        .mappings()
        .all()
    )

    if rows:
        return [{"href": r["href"], "id": r["item_id"]} for r in rows]

    # Fallback: geom not populated (old data) - use Python bbox check
    items = (
        db.query(MosaicItem)
        .filter_by(mosaic_id=mosaic_id)
        .order_by(MosaicItem.cloud_cover.asc().nulls_last(), MosaicItem.datetime.desc())
        .all()
    )
    matching = []
    for it in items:
        if not (it.bbox_west <= east and it.bbox_east >= west and it.bbox_south <= north and it.bbox_north >= south):
            continue
        matching.append({"href": it.href, "id": it.item_id})
        if len(matching) >= limit:
            break
    return matching


@router.get("/mosaic/{mosaic_id}/tiles/{z}/{x}/{y}.png")
def mosaic_tile(
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
    nodata: float | None = Query(default=None),
    mask_layer: str = Query(default=""),
    mask_values: list[int] = Query(default=[]),
    nir_band: str = Query(default="B08"),
    red_band: str = Query(default="B04"),
    max_items: int = Query(default=5, ge=1, le=10),
    db: Session = Depends(get_db),
):
    t_start = time.perf_counter()

    if not assets and not expression:
        raise HTTPException(status_code=400, detail="Specify assets or expression")

    tms = morecantile.tms.get("WebMercatorQuad")
    tile_bounds = tms.bounds(morecantile.Tile(x, y, z))
    tile_bbox = [tile_bounds.left, tile_bounds.bottom, tile_bounds.right, tile_bounds.top]

    # ── Step 1: Spatial DB lookup ──
    t_db = time.perf_counter()
    matching_items = _get_items_for_tile(mosaic_id, tile_bbox, limit=max_items, db=db)
    t_db_done = time.perf_counter()

    if not matching_items:
        logger.info(
            "TILE %s z=%d x=%d y=%d | db=%.0fms items=0 | empty (no items)",
            mosaic_id[:8], z, x, y, (t_db_done - t_db) * 1000,
        )
        return Response(content=_empty_tile(), media_type="image/png")

    # ── Step 2: Prepare reader kwargs ──
    is_ndvi_best = compositing == "ndvi_best"
    display_assets = list(assets)
    if is_ndvi_best and assets:
        scoring_assets = list(assets)
        for b in [nir_band, red_band]:
            if b not in scoring_assets:
                scoring_assets.append(b)
    else:
        scoring_assets = list(assets)

    reader_kwargs: dict = {}
    if expression:
        reader_kwargs["expression"] = expression
    elif scoring_assets:
        reader_kwargs["assets"] = tuple(scoring_assets)
        if asset_as_band:
            reader_kwargs["asset_as_band"] = True
    if nodata is not None:
        reader_kwargs["nodata"] = nodata

    if is_ndvi_best:
        pixel_method = NDVIBestMethod(n_display_bands=len(display_assets))
    else:
        method_cls = PIXEL_SELECTION_METHODS.get(compositing, mosaic_defaults.FirstMethod)
        pixel_method = method_cls()

    apply_mask = bool(mask_layer and mask_values)

    # ── Step 3: Read COGs + composite ──
    item_timings: list[str] = []

    def read_tile(href: str):
        t0 = time.perf_counter()
        with PCSignedSTACReader(href) as src:
            t_open = time.perf_counter()
            img = src.tile(x, y, z, **reader_kwargs)
            t_tile = time.perf_counter()
            if apply_mask:
                try:
                    mask_img = src.tile(x, y, z, assets=[mask_layer])
                    invalid = np.isin(mask_img.data[0], mask_values)
                    img.array.mask[:, invalid] = True
                except Exception:
                    pass
            t_done = time.perf_counter()
            n = len(item_timings) + 1
            item_timings.append(
                f"  #{n} open={int((t_open-t0)*1000)}ms tile={int((t_tile-t_open)*1000)}ms"
                f" mask={int((t_done-t_tile)*1000)}ms href=...{href[-60:]}"
            )
            return img

    t_cog = time.perf_counter()
    item_hrefs = [item["href"] for item in matching_items]
    # For first-valid: process one item at a time so is_done short-circuits
    # after the first fully-valid image. For statistical methods: read all in parallel.
    is_first = compositing == "first"
    img, _ = mosaic_reader(
        item_hrefs,
        read_tile,
        pixel_selection=pixel_method,
        chunk_size=1 if is_first else None,
        threads=1 if is_first else None,
    )
    t_cog_done = time.perf_counter()

    if img is None or not img.mask.any():
        logger.info(
            "TILE %s z=%d x=%d y=%d | db=%.0fms items=%d read=%d cog=%.0fms | empty (no valid pixels)",
            mosaic_id[:8], z, x, y,
            (t_db_done - t_db) * 1000, len(matching_items), len(item_timings),
            (t_cog_done - t_cog) * 1000,
        )
        return Response(content=_empty_tile(), media_type="image/png")

    # ── Step 4: Post-process (rescale, colormap, render) ──
    t_render = time.perf_counter()

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
        render_kwargs["colormap"] = rio_cmap.get(colormap_name)

    content = img.render(img_format="PNG", **render_kwargs)
    t_render_done = time.perf_counter()

    t_total = (t_render_done - t_start) * 1000
    timings_detail = "\n".join(item_timings) if item_timings else ""
    logger.info(
        "TILE %s z=%d x=%d y=%d | db=%.0fms items=%d read=%d cog=%.0fms render=%.0fms total=%.0fms\n%s",
        mosaic_id[:8], z, x, y,
        (t_db_done - t_db) * 1000,
        len(matching_items), len(item_timings),
        (t_cog_done - t_cog) * 1000,
        (t_render_done - t_render) * 1000,
        t_total,
        timings_detail,
    )

    return Response(
        content=content,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


_EMPTY_TILE_BYTES: bytes | None = None


def _empty_tile() -> bytes:
    global _EMPTY_TILE_BYTES
    if _EMPTY_TILE_BYTES is not None:
        return _EMPTY_TILE_BYTES

    width, height = 256, 256
    raw_data = b"\x00" + b"\x00\x00\x00\x00" * width
    raw_rows = raw_data * height
    compressed = zlib.compress(raw_rows)

    def _chunk(chunk_type: bytes, data: bytes) -> bytes:
        c = chunk_type + data
        crc = struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + c + crc

    png = b"\x89PNG\r\n\x1a\n"
    png += _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += _chunk(b"IDAT", compressed)
    png += _chunk(b"IEND", b"")

    _EMPTY_TILE_BYTES = png
    return _EMPTY_TILE_BYTES

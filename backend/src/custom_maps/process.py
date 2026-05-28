"""COG preprocessing CLI; spawned by service._spawn_worker."""

from __future__ import annotations

import argparse
import logging
import shutil
import sys
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import numpy as np
import rasterio
from geoalchemy2.shape import from_shape
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT
from rasterio.warp import calculate_default_transform, transform_geom
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles
from shapely.geometry import box, shape

# Register every model so SQLAlchemy can resolve cross-module FK targets
# (e.g. custom_maps.campaign_id -> data.campaigns.id) in this fresh process.
import src.models  # noqa: F401, E402
from src import storage
from src.custom_maps.models import STATUS_FAILED, STATUS_READY, CustomMap
from src.database import SessionLocal

logger = logging.getLogger(__name__)

TARGET_CRS = "EPSG:3857"
DISK_HEADROOM_FACTOR = 1.5
# Bound on a single source-block read into RAM. Tiled TIFFs read one tile;
# compressed strips must decompress whole-strip. 1 GiB leaves headroom for
# the two-job concurrency cap on the 2 GiB backend.
MAX_SOURCE_BLOCK_BYTES = 1 * 1024 * 1024 * 1024


def main() -> int:
    parser = argparse.ArgumentParser(description="Process a custom map into a COG")
    parser.add_argument("--id", required=True, help="custom_maps.id (UUID)")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] custom_map_worker: %(message)s",
    )
    logging.getLogger("rasterio").setLevel(logging.WARNING)

    return _process(UUID(args.id))


def _process(custom_map_id: UUID) -> int:
    db = SessionLocal()
    try:
        custom_map = db.get(CustomMap, custom_map_id)
        if custom_map is None:
            logger.error("CustomMap %s not found", custom_map_id)
            return 1

        logger.info("Processing custom map %s (campaign %s)", custom_map_id, custom_map.campaign_id)
        try:
            result = _build_cog(custom_map)
            custom_map.cog_path = result.cog_path
            custom_map.bounds = from_shape(result.bounds, srid=4326)
            custom_map.band_count = result.band_count
            custom_map.min_value = result.min_value
            custom_map.max_value = result.max_value
            # Don't clobber an admin's existing viz_params on reprocess.
            if not custom_map.viz_params:
                custom_map.viz_params = result.default_viz_params
            custom_map.status = STATUS_READY
            custom_map.error_message = None
            custom_map.updated_at = datetime.now(UTC)
            db.commit()
            logger.info("Custom map %s ready", custom_map_id)
            return 0
        except Exception as e:
            logger.exception("Custom map %s failed", custom_map_id)
            db.rollback()
            custom_map = db.get(CustomMap, custom_map_id)
            if custom_map is not None:
                custom_map.status = STATUS_FAILED
                custom_map.error_message = _format_error(e)
                custom_map.updated_at = datetime.now(UTC)
                db.commit()
            return 1
    finally:
        db.close()


@dataclass
class _ProcessResult:
    cog_path: str
    bounds: shape
    band_count: int
    min_value: float | None
    max_value: float | None
    default_viz_params: dict


def _build_cog(custom_map: CustomMap) -> _ProcessResult:
    work_dir = Path(tempfile.mkdtemp(prefix=f"custom_map_{custom_map.id}_"))
    src_local = work_dir / "source.tif"
    cog_local = work_dir / "cog.tif"

    backend = storage.get_backend()
    try:
        logger.info("Downloading source %s", custom_map.source_path)
        backend.download_to(custom_map.source_path, src_local)

        src_size = src_local.stat().st_size
        free = shutil.disk_usage(work_dir).free
        needed = int(src_size * DISK_HEADROOM_FACTOR)
        if free < needed:
            raise RuntimeError(
                f"Insufficient disk: need ~{needed // (1024**2)} MiB free, "
                f"have {free // (1024**2)} MiB"
            )

        with rasterio.Env(GDAL_CACHEMAX=512):
            bounds_4326, band_count, vmin, vmax = _stream_reproject_to_cog(src_local, cog_local)

        logger.info("Uploading COG (%s bytes)", cog_local.stat().st_size)
        cog_blob_path = storage.custom_map_cog_path(custom_map.campaign_id, str(custom_map.id))
        backend.upload_from(cog_local, cog_blob_path)
        return _ProcessResult(
            cog_path=cog_blob_path,
            bounds=bounds_4326,
            band_count=band_count,
            min_value=vmin,
            max_value=vmax,
            default_viz_params=_default_viz_params(band_count, vmin, vmax),
        )
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def _default_viz_params(band_count: int, vmin: float | None, vmax: float | None) -> dict:
    params: dict = {}
    if band_count == 1:
        params["colormap_name"] = "viridis"
    if vmin is not None and vmax is not None and vmax > vmin:
        params["rescale"] = f"{vmin},{vmax}"
    return params


def _stream_reproject_to_cog(src_path: Path, dst_path: Path):
    with rasterio.open(src_path) as src:
        if src.crs is None:
            raise RuntimeError("Source raster has no CRS — cannot reproject")
        if src.count < 1:
            raise RuntimeError("Source raster has no bands")
        if src.count > 1:
            raise RuntimeError(
                f"Multi-band rasters not supported yet (got {src.count} bands). "
                "Split into single-band GeoTIFFs and upload separately."
            )

        _check_source_block_budget(src)

        stats = src.statistics(1, approx=True)
        vmin = float(stats.min) if stats.min is not None else None
        vmax = float(stats.max) if stats.max is not None else None

        # Nearest preserves categorical class IDs (ML output masks). Continuous
        # data would be better with bilinear but we cannot reliably distinguish.
        resampling = Resampling.nearest

        dst_transform, dst_width, dst_height = calculate_default_transform(
            src.crs, TARGET_CRS, src.width, src.height, *src.bounds
        )

        vrt_options = {
            "crs": TARGET_CRS,
            "transform": dst_transform,
            "width": dst_width,
            "height": dst_height,
            "resampling": resampling,
        }
        if src.nodata is not None:
            vrt_options["nodata"] = src.nodata

        bbox_geom = box(*src.bounds)
        reproj_geom = shape(transform_geom(src.crs, "EPSG:4326", bbox_geom.__geo_interface__))

        profile = cog_profiles.get("deflate")
        profile.update(blockxsize=512, blockysize=512)

        with WarpedVRT(src, **vrt_options) as vrt:
            cog_translate(
                vrt,
                str(dst_path),
                profile,
                in_memory=False,
                web_optimized=True,
                quiet=True,
                use_cog_driver=False,
            )

        return reproj_geom, src.count, vmin, vmax


def _check_source_block_budget(src) -> None:
    # block_shapes is one entry per band; use the largest in case bands differ.
    block_h, block_w = max(src.block_shapes, key=lambda s: s[0] * s[1])
    dtype_bytes = np.dtype(src.dtypes[0]).itemsize
    bytes_per_block = block_h * block_w * src.count * dtype_bytes

    # Uncompressed strips support sub-window seeks, so strip height doesn't
    # force a full-strip read.
    if not src.is_tiled and src.compression is None:
        return

    if bytes_per_block > MAX_SOURCE_BLOCK_BYTES:
        kind = "tile" if src.is_tiled else "compressed strip"
        budget_mib = MAX_SOURCE_BLOCK_BYTES // (1024 * 1024)
        actual_mib = bytes_per_block // (1024 * 1024)
        raise RuntimeError(
            f"Source raster's atomic {kind} is {actual_mib} MiB "
            f"({block_h}×{block_w}, {src.count} bands, {src.dtypes[0]}), "
            f"exceeding the {budget_mib} MiB per-read budget. "
            "Re-export with internal tiling, e.g.: "
            "gdal_translate -co TILED=YES -co BLOCKXSIZE=512 -co BLOCKYSIZE=512 "
            "in.tif out.tif"
        )


def _format_error(e: Exception) -> str:
    msg = str(e) or e.__class__.__name__
    return msg[:500]


if __name__ == "__main__":
    sys.exit(main())

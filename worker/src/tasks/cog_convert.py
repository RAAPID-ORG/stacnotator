"""Convert uploaded rasters to COG (Cloud Optimized GeoTIFF) format."""

import logging
import tempfile
import urllib.request
from pathlib import Path

import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.shutil import copy as rio_copy
from rasterio.warp import calculate_default_transform, reproject
from sqlalchemy.orm import Session

from src.storage import get_storage

logger = logging.getLogger(__name__)

OVERVIEW_LEVELS = [2, 4, 8, 16, 32, 64, 128]
COG_PROFILE = {
    "driver": "GTiff",
    "tiled": True,
    "blockxsize": 512,
    "blockysize": 512,
    "compress": "lzw",
    "copy_src_overviews": True,
    "interleave": "pixel",
}


def _reproject_to_4326(src: rasterio.DatasetReader, out_path: Path) -> bool:
    """Reproject to EPSG:4326 if needed. Returns True if reprojection was performed."""
    dst_crs = CRS.from_epsg(4326)
    if src.crs and src.crs.to_epsg() == 4326:
        return False

    transform, width, height = calculate_default_transform(
        src.crs, dst_crs, src.width, src.height, *src.bounds
    )
    with rasterio.open(
        out_path,
        "w",
        driver="GTiff",
        height=height,
        width=width,
        count=src.count,
        dtype=src.dtypes[0],
        crs=dst_crs,
        transform=transform,
        nodata=src.nodata,
    ) as dst:
        for band_idx in range(1, src.count + 1):
            reproject(
                source=rasterio.band(src, band_idx),
                destination=rasterio.band(dst, band_idx),
                src_transform=src.transform,
                src_crs=src.crs,
                dst_transform=transform,
                dst_crs=dst_crs,
                resampling=Resampling.nearest,
            )
    return True


def _build_cog(working_path: Path, cog_path: Path) -> None:
    """Build overviews on working_path then copy as COG to cog_path."""
    with rasterio.open(working_path, "r+") as src:
        src.build_overviews(OVERVIEW_LEVELS, Resampling.average)
        src.update_tags(ns="rio_overview", resampling="average")
    with rasterio.open(working_path) as src:
        rio_copy(src, cog_path, **COG_PROFILE)


def process(db: Session, custom_map) -> None:
    storage = get_storage()
    map_id = str(custom_map.id)

    with tempfile.TemporaryDirectory() as tmp_dir_str:
        tmp_dir = Path(tmp_dir_str)

        src_path_str = storage.get_accessible_path(custom_map.original_key)

        # For Azure (HTTP URL), download to temp first
        if src_path_str.startswith("http"):
            local_src = tmp_dir / "original.tif"
            urllib.request.urlretrieve(src_path_str, local_src)
            src_path = local_src
        else:
            src_path = Path(src_path_str)

        with rasterio.open(src_path) as src:
            band_count = src.count
            nodata = src.nodata
            reprojected_path = tmp_dir / "reprojected.tif"
            did_reproject = _reproject_to_4326(src, reprojected_path)

        working_path = reprojected_path if did_reproject else src_path

        with rasterio.open(working_path) as src_4326:
            b = src_4326.bounds
            bounds_dict = {"minx": b.left, "miny": b.bottom, "maxx": b.right, "maxy": b.top}

        cog_tmp = tmp_dir / "output.cog.tif"
        _build_cog(working_path, cog_tmp)

        cog_key = custom_map.original_key.replace(".tif", ".cog.tif")
        storage.upload(cog_key, str(cog_tmp))

        custom_map.status = "ready"
        custom_map.cog_key = cog_key
        custom_map.band_count = band_count
        custom_map.nodata = nodata
        custom_map.bounds = bounds_dict
        custom_map.error = None
        db.commit()
        logger.info("custom map %s processed successfully", map_id)

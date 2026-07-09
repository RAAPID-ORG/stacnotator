"""File-conversion helpers for overlay data: proper COGs and PMTiles."""

from collections.abc import Iterable
from pathlib import Path
from typing import Any, Literal

import rasterio
from pyogrio import raw
from rasterio.transform import from_origin
from rasterio.windows import from_bounds as window_from_bounds
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles

Resampling = Literal["nearest", "bilinear", "cubic", "average", "mode", "rms"]


def to_cog(
    src: str | Path, dst: str | Path | None = None, resampling: Resampling = "nearest"
) -> Path:
    """Convert a GeoTIFF into a valid Cloud-Optimized GeoTIFF.

    Tiled, deflate-compressed, with overviews (``resampling`` controls how they
    are built: "nearest" suits class rasters, "average" continuous data).
    ``dst`` defaults to ``<src stem>.cog.tif`` next to the source.
    """
    src = Path(src)
    dst = Path(dst) if dst else src.with_suffix(".cog.tif")
    profile: dict[str, Any] = cog_profiles.get("deflate")  # type: ignore[no-untyped-call]
    cog_translate(
        src,
        dst,
        profile,
        overview_resampling=resampling,
        in_memory=False,
        quiet=True,
    )
    return dst


def merge_to_cog(
    sources: str | Path | Iterable[str | Path],
    dst: str | Path,
    resampling: Resampling = "nearest",
) -> Path:
    """Mosaic many GeoTIFF chips (e.g. inference tiles) into one Cloud-Optimized GeoTIFF.

    ``sources`` is a folder (all ``.tif``/``.tiff`` inside), or an iterable of
    paths. Chips must share CRS, resolution, dtype, and band count; each is
    written into its window of the output, so memory stays flat no matter how
    many chips there are.
    """
    paths = _expand_sources(sources)
    dst = Path(dst)

    profiles = []
    for path in paths:
        with rasterio.open(path) as chip:
            profiles.append(
                {
                    "path": path,
                    "crs": chip.crs,
                    "res": chip.res,
                    "dtype": chip.dtypes[0],
                    "count": chip.count,
                    "bounds": chip.bounds,
                    "nodata": chip.nodata,
                }
            )
    _require_consistent(profiles)

    first = profiles[0]
    res_x, res_y = first["res"]
    west = min(p["bounds"].left for p in profiles)
    south = min(p["bounds"].bottom for p in profiles)
    east = max(p["bounds"].right for p in profiles)
    north = max(p["bounds"].top for p in profiles)
    width = round((east - west) / res_x)
    height = round((north - south) / res_y)
    transform = from_origin(west, north, res_x, res_y)

    tmp = dst.with_suffix(".merging.tif")
    try:
        with rasterio.open(
            tmp,
            "w",
            driver="GTiff",
            width=width,
            height=height,
            count=first["count"],
            dtype=first["dtype"],
            crs=first["crs"],
            transform=transform,
            nodata=first["nodata"],
            tiled=True,
            compress="deflate",
            bigtiff="IF_SAFER",
        ) as mosaic:
            for profile in profiles:
                window = (
                    window_from_bounds(*profile["bounds"], transform=transform)
                    .round_offsets()
                    .round_lengths()
                )
                with rasterio.open(profile["path"]) as chip:
                    mosaic.write(chip.read(), window=window)
        return to_cog(tmp, dst, resampling=resampling)
    finally:
        tmp.unlink(missing_ok=True)


def to_pmtiles(
    src: str | Path,
    dst: str | Path | None = None,
    layer: str | None = None,
    min_zoom: int = 0,
    max_zoom: int = 14,
) -> Path:
    """Convert a vector file (GeoJSON, GPKG, Shapefile, FlatGeobuf, ...) to PMTiles.

    The result is served to browsers directly via HTTP range requests, ready for
    ``campaign.register_vector_overlay``. ``layer`` names the tile layer (defaults
    to the source stem); raise ``max_zoom`` for very dense data.
    """
    src = Path(src)
    dst = Path(dst) if dst else src.with_suffix(".pmtiles")

    meta, _index, geometry, field_data = raw.read(src)
    raw.write(
        dst,
        geometry,
        field_data,
        fields=meta["fields"],
        driver="PMTiles",
        layer=layer or src.stem,
        geometry_type=meta["geometry_type"],
        crs=meta["crs"],
        dataset_options={"MINZOOM": str(min_zoom), "MAXZOOM": str(max_zoom)},
    )
    return dst


def _expand_sources(sources: str | Path | Iterable[str | Path]) -> list[Path]:
    if isinstance(sources, (str, Path)) and Path(sources).is_dir():
        folder = Path(sources)
        paths = sorted(p for p in folder.iterdir() if p.suffix.lower() in (".tif", ".tiff"))
        if not paths:
            raise ValueError(f"No GeoTIFFs (*.tif) found in {folder}")
        return paths
    if isinstance(sources, (str, Path)):
        return [Path(sources)]
    paths = [Path(p) for p in sources]
    if not paths:
        raise ValueError("No GeoTIFF sources given")
    return paths


def _require_consistent(profiles: list[dict[str, Any]]) -> None:
    first = profiles[0]
    for profile in profiles[1:]:
        if profile["crs"] != first["crs"]:
            raise ValueError(
                f"Chips must share one CRS: {profile['path']} has {profile['crs']}, "
                f"{first['path']} has {first['crs']}"
            )
        for key in ("res", "dtype", "count"):
            if profile[key] != first[key]:
                raise ValueError(
                    f"Chips must share {key}: {profile['path']} has {profile[key]}, "
                    f"{first['path']} has {first[key]}"
                )

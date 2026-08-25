"""File-conversion helpers for overlay data: proper COGs and PMTiles."""

import json
from collections.abc import Iterable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Literal

import numpy as np
import numpy.typing as npt
import rasterio
from pyogrio import raw
from rasterio.transform import from_bounds, from_origin
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


def array_to_cog(
    data: npt.NDArray[Any],
    bounds: tuple[float, float, float, float],
    dst: str | Path,
    crs: str = "EPSG:4326",
    nodata: float | None = None,
    resampling: Resampling = "nearest",
) -> Path:
    """Write a numpy array (e.g. model predictions) as a Cloud-Optimized GeoTIFF.

    ``data`` is (rows, cols) for a single band or (bands, rows, cols); row 0 is
    the northern edge. ``bounds`` is (west, south, east, north) in ``crs``
    units, e.g. a ``campaign.extent``.
    """
    if data.ndim == 2:
        data = data[np.newaxis]
    if data.ndim != 3:
        raise ValueError(
            f"data must be 2D (rows, cols) or 3D (bands, rows, cols), got {data.ndim}D"
        )
    west, south, east, north = bounds
    if east <= west or north <= south:
        raise ValueError(
            "bounds must be (west, south, east, north) with east > west and "
            f"north > south, got {bounds}"
        )
    count, height, width = data.shape

    dst = Path(dst)
    tmp = dst.with_suffix(".writing.tif")
    try:
        with rasterio.open(
            tmp,
            "w",
            driver="GTiff",
            width=width,
            height=height,
            count=count,
            dtype=data.dtype.name,
            crs=crs,
            transform=from_bounds(west, south, east, north, width, height),
            nodata=nodata,
        ) as out:
            out.write(data)
        return to_cog(tmp, dst, resampling=resampling)
    finally:
        tmp.unlink(missing_ok=True)


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
    src: "str | Path | Mapping[str, Any] | Sequence[Any] | Any",
    dst: str | Path | None = None,
    layer: str | None = None,
    min_zoom: int = 0,
    max_zoom: int = 14,
) -> Path:
    """Convert vector data to PMTiles.

    ``src`` is a file GDAL reads (GeoJSON, GPKG, Shapefile, FlatGeobuf, ...) or
    features already in memory: a GeoJSON FeatureCollection, an iterable of
    Features, or anything exposing ``__geo_interface__`` (a GeoDataFrame, a
    shapely geometry). In-memory features are WGS84, as GeoJSON defines them,
    and need a ``dst`` since there is no source name to derive one from.

    The result is served to browsers directly via HTTP range requests, ready for
    ``campaign.register_vector_overlay``. ``layer`` names the tile layer (defaults
    to the source stem); raise ``max_zoom`` for very dense data.

    Tiles are always Web Mercator - that is what PMTiles and every viewer of it
    assume - so a source in any other CRS is reprojected on the way in. A source
    with no CRS at all cannot be, and is refused rather than written to the wrong
    place on the map.
    """
    if isinstance(src, (str, Path)):
        return _file_to_pmtiles(Path(src), dst, layer, min_zoom, max_zoom)
    with _as_geojson_file(_feature_collection(src)) as tmp:
        if dst is None:
            raise ValueError(
                "dst is required when passing features rather than a file, e.g. "
                'to_pmtiles(features, "fields.pmtiles")'
            )
        return _file_to_pmtiles(tmp, dst, layer or Path(dst).stem, min_zoom, max_zoom)


def _file_to_pmtiles(
    src: Path,
    dst: str | Path | None,
    layer: str | None,
    min_zoom: int,
    max_zoom: int,
) -> Path:
    dst = Path(dst) if dst else src.with_suffix(".pmtiles")

    meta, _index, geometry, field_data = raw.read(src)
    if not meta["crs"]:
        raise ValueError(
            f"{src} declares no CRS, so its coordinates cannot be placed on the map. "
            "Set one on the source (GeoJSON is always WGS84; a Shapefile needs its "
            ".prj) and convert again."
        )
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


def _feature_collection(data: Any) -> dict[str, Any]:
    """Features in any of the shapes people hold them in, as one GeoJSON dict."""
    obj = getattr(data, "__geo_interface__", data)
    if isinstance(obj, Mapping):
        kind = obj.get("type")
        if kind == "FeatureCollection":
            return dict(obj)
        if kind == "Feature":
            return {"type": "FeatureCollection", "features": [dict(obj)]}
        if kind:  # a bare geometry
            return {
                "type": "FeatureCollection",
                "features": [{"type": "Feature", "geometry": dict(obj), "properties": {}}],
            }
    if isinstance(obj, Sequence) and not isinstance(obj, (str, bytes)):
        features = [_feature_collection(item)["features"][0] for item in obj]
        if features:
            return {"type": "FeatureCollection", "features": features}
    raise ValueError(
        "features must be a GeoJSON FeatureCollection, an iterable of Features, or "
        "an object with __geo_interface__ (e.g. a GeoDataFrame)"
    )


@contextmanager
def _as_geojson_file(collection: dict[str, Any]) -> "Iterator[Path]":
    """GeoJSON on disk is the shortest honest route into GDAL: one reader, one
    writer, and the CRS is defined by the format rather than guessed."""
    with TemporaryDirectory() as folder:
        path = Path(folder) / "features.geojson"
        path.write_text(json.dumps(collection))
        yield path


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

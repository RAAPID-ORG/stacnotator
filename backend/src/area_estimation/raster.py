"""Reading a classified map and counting it on an equal-area grid.

Pure functions over files and URLs: no FastAPI, no database, nothing that ties
them to the process serving requests, so the same code runs wherever the map
happens to live. Nothing here fits in memory by assumption - a map of a whole
country is read, warped, counted and written one window at a time.

Two rules keep the counts honest. Only nearest-neighbour resampling touches the
map, so no pixel ever holds a class that was not in the source. And GDAL is only
asked for geometry: it is told the source has no nodata at all, and the warped
footprint is read back from the alpha band it adds, so every decision about
which pixels count is made here, in the open, rather than inherited from the
file's nodata tag.
"""

import logging
import math
from collections.abc import Callable, Iterator
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass

import numpy as np
import rasterio
import rasterio.errors
import shapely
from affine import Affine
from pyproj import CRS as ProjCRS
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.vrt import WarpedVRT
from rasterio.warp import calculate_default_transform, transform_bounds
from rasterio.windows import Window
from rasterio.windows import bounds as window_bounds
from rasterio.windows import transform as window_transform
from shapely.geometry.base import BaseGeometry
from shapely.prepared import prep

from src.area_estimation.schemas import (
    MAX_VALUE,
    NODATA,
    STRATA_DTYPE,
    BandInfo,
    Bbox,
    GridSpec,
    MapInfo,
    RawCensus,
    ReportingClass,
    SourceInfo,
    StrataCensus,
)

logger = logging.getLogger(__name__)


class MapError(ValueError):
    """A map or a request that cannot be processed as asked. The message is
    written for the person who uploaded the map."""


WGS84 = CRS.from_epsg(4326)
WINDOW = 2048
# A nodata value no integer or float32 band can hold, handed to the warper so
# it treats every source pixel as data. See the module docstring.
NO_SOURCE_NODATA = -3.0e38

GTIFF_PROFILE = {
    "driver": "GTiff",
    "tiled": True,
    "blockxsize": 512,
    "blockysize": 512,
    "compress": "deflate",
    "predictor": 2,
    "bigtiff": "IF_SAFER",
    "sparse_ok": True,
}
GDAL_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "GDAL_HTTP_MAX_RETRY": 3,
    "GDAL_HTTP_RETRY_DELAY": 1,
    "GDAL_CACHEMAX": 512,
}
# PROJ method names of projections that preserve area. Anything else is refused
# rather than guessed at: a count taken on a grid that does not preserve area
# is not a stratum weight, it is a mistake.
EQUAL_AREA_METHODS = (
    "equal area",
    "equal earth",
    "mollweide",
    "sinusoidal",
    "eckert iv",
    "eckert vi",
    "hammer",
    "bonne",
    "goode homolosine",
)

Progress = Callable[[float], None]


@dataclass(frozen=True)
class Source:
    """One file of the map: the name a person knows it by, and where to read it."""

    name: str
    location: str


@dataclass(frozen=True)
class Zone:
    """An area of interest in the grid's own CRS."""

    id: str
    geometry: BaseGeometry


# ============================================================================
# Inspection
# ============================================================================


def _open(source: Source) -> rasterio.DatasetReader:
    try:
        return rasterio.open(source.location)
    except rasterio.errors.RasterioIOError as exc:
        raise MapError(f"{source.name} could not be opened as a raster: {exc}") from exc


def _proj_crs(crs: CRS) -> ProjCRS:
    return ProjCRS.from_wkt(crs.to_wkt())


def is_equal_area(crs: ProjCRS) -> bool:
    operation = crs.coordinate_operation
    if not crs.is_projected or operation is None:
        return False
    method = operation.method_name.lower()
    return any(name in method for name in EQUAL_AREA_METHODS)


def _metres_per_unit(crs: ProjCRS) -> float:
    return float(crs.axis_info[0].unit_conversion_factor)


def _pixel_area_m2(transform: Affine, crs: ProjCRS) -> float | None:
    if not crs.is_projected:
        return None
    factor = _metres_per_unit(crs)
    return abs(transform.determinant) * factor * factor


def _wgs84_bbox(ds: rasterio.DatasetReader, name: str) -> Bbox:
    try:
        west, south, east, north = transform_bounds(ds.crs, WGS84, *ds.bounds, densify_pts=21)
    except Exception as exc:
        raise MapError(f"The extent of {name} cannot be expressed in longitude/latitude") from exc
    if not all(math.isfinite(v) for v in (west, south, east, north)):
        raise MapError(f"The extent of {name} cannot be expressed in longitude/latitude")
    return Bbox(west=west, south=south, east=east, north=north)


def _band_nodata(value: float | None) -> float | None:
    # NaN is a nodata the census masks on sight; it has no value to report.
    return None if value is None or math.isnan(value) else float(value)


def inspect_source(source: Source) -> SourceInfo:
    with rasterio.Env(**GDAL_ENV), _open(source) as ds:
        if ds.crs is None:
            raise MapError(f"{source.name} has no coordinate reference system")
        if ds.count == 0:
            raise MapError(f"{source.name} has no bands")
        for dtype in ds.dtypes:
            if np.dtype(dtype).kind not in "iuf":
                raise MapError(f"{source.name} holds {dtype} pixels, which cannot be class codes")
        crs = _proj_crs(ds.crs)
        return SourceInfo(
            name=source.name,
            width=ds.width,
            height=ds.height,
            crs=ds.crs.to_string(),
            crs_name=crs.name,
            is_geographic=bool(crs.is_geographic),
            is_equal_area=is_equal_area(crs),
            resolution=(abs(ds.transform.a), abs(ds.transform.e)),
            pixel_area_m2=_pixel_area_m2(ds.transform, crs),
            bbox=_wgs84_bbox(ds, source.name),
            bands=[
                BandInfo(
                    index=index,
                    dtype=ds.dtypes[index - 1],
                    description=ds.descriptions[index - 1],
                    nodata=_band_nodata(ds.nodatavals[index - 1]),
                )
                for index in range(1, ds.count + 1)
            ],
        )


def proposed_laea(bbox: Bbox) -> str:
    """A Lambert azimuthal equal-area projection centred on the map. It preserves
    area everywhere, so the centre only needs to be roughly right."""
    lat = round((bbox.south + bbox.north) / 2, 2)
    lon = round((bbox.west + bbox.east) / 2, 2)
    return f"+proj=laea +lat_0={lat} +lon_0={lon} +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"


def inspect_map(sources: list[Source]) -> MapInfo:
    """Read every tile's header and check they describe one map."""
    infos = [inspect_source(source) for source in sources]
    first = infos[0]
    for info in infos[1:]:
        if [b.dtype for b in info.bands] != [b.dtype for b in first.bands]:
            raise MapError(
                f"{info.name} and {first.name} do not have the same bands, "
                "so they cannot be tiles of one map"
            )
    bbox = Bbox(
        west=min(i.bbox.west for i in infos),
        south=min(i.bbox.south for i in infos),
        east=max(i.bbox.east for i in infos),
        north=max(i.bbox.north for i in infos),
    )
    one_crs = len({info.crs for info in infos}) == 1
    equal_area = one_crs and first.is_equal_area
    return MapInfo(
        sources=infos,
        bands=first.bands,
        bbox=bbox,
        total_pixels=sum(i.width * i.height for i in infos),
        is_equal_area=equal_area,
        proposed_crs=first.crs if equal_area else proposed_laea(bbox),
    )


# ============================================================================
# The equal-area grid
# ============================================================================


def equal_area_crs(text: str) -> CRS:
    """Parse a CRS and refuse it unless it preserves area and measures in metres."""
    try:
        crs = ProjCRS.from_user_input(text.strip())
    except Exception as exc:
        raise MapError(f"Not a recognised coordinate reference system: {text!r}") from exc
    if not is_equal_area(crs):
        raise MapError(
            f"{crs.name} does not preserve area, so pixel counts taken on it would not be "
            "stratum weights. Use an equal-area projection."
        )
    if abs(_metres_per_unit(crs) - 1.0) > 1e-9:
        raise MapError(f"{crs.name} does not measure in metres")
    return CRS.from_wkt(crs.to_wkt())


def _dst_bounds(
    ds: rasterio.DatasetReader, dst: CRS, name: str
) -> tuple[float, float, float, float]:
    try:
        bounds = transform_bounds(ds.crs, dst, *ds.bounds, densify_pts=21)
    except Exception as exc:
        raise MapError(f"The extent of {name} cannot be projected into the chosen CRS") from exc
    if not all(math.isfinite(v) for v in bounds):
        raise MapError(f"The extent of {name} cannot be projected into the chosen CRS")
    return float(bounds[0]), float(bounds[1]), float(bounds[2]), float(bounds[3])


def plan_grid(
    sources: list[Source], crs_text: str, resolution_m: float | None, max_pixels: int
) -> GridSpec:
    """The grid the map is counted on: the chosen CRS, at the given resolution
    (else the finest GDAL derives for a tile), over the union of the tiles."""
    dst = equal_area_crs(crs_text)
    bounds = []
    derived = []
    with rasterio.Env(**GDAL_ENV):
        for source in sources:
            with _open(source) as ds:
                bounds.append(_dst_bounds(ds, dst, source.name))
                if resolution_m is None:
                    transform, _, _ = calculate_default_transform(
                        ds.crs, dst, ds.width, ds.height, *ds.bounds
                    )
                    derived.append(abs(transform.a))
    resolution = resolution_m if resolution_m is not None else min(derived)
    left = min(b[0] for b in bounds)
    bottom = min(b[1] for b in bounds)
    right = max(b[2] for b in bounds)
    top = max(b[3] for b in bounds)
    width = math.ceil((right - left) / resolution)
    height = math.ceil((top - bottom) / resolution)
    if width * height > max_pixels:
        raise MapError(
            f"A {resolution:g} m grid over this map has {width * height:,} pixels, "
            f"more than the {max_pixels:,} allowed. Use a coarser resolution."
        )
    transform = Affine(resolution, 0.0, left, 0.0, -resolution, top)
    return GridSpec(
        crs=dst.to_wkt(),
        resolution_m=resolution,
        width=width,
        height=height,
        transform=transform.to_gdal(),
    )


def _grid_transform(grid: GridSpec) -> Affine:
    return Affine.from_gdal(*grid.transform)


def _windows(grid: GridSpec) -> list[Window]:
    return [
        Window(col, row, min(WINDOW, grid.width - col), min(WINDOW, grid.height - row))
        for row in range(0, grid.height, WINDOW)
        for col in range(0, grid.width, WINDOW)
    ]


def _intersects(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


# ============================================================================
# Areas of interest on the grid
# ============================================================================


class _Zones:
    """Labels each window's pixels with the area their centre falls in.

    Whole windows inside an area are labelled without rasterising, and windows
    on a boundary rasterise only the clipped piece, which is what keeps a
    country-sized polygon from being rasterised thousands of times over.
    """

    def __init__(self, zones: list[Zone]):
        self.ids = [zone.id for zone in zones]
        self._geoms = [zone.geometry for zone in zones]
        self._prepared = [prep(zone.geometry) for zone in zones]
        self._bounds = [zone.geometry.bounds for zone in zones]

    def labels(self, window: Window, transform: Affine) -> np.ndarray | None:
        """Area index + 1 per pixel, 0 outside every area; None when the window
        touches no area at all."""
        shape = (int(window.height), int(window.width))
        bounds = window_bounds(window, transform)
        frame = shapely.box(*bounds)
        labels: np.ndarray | None = None
        for index, geometry in enumerate(self._geoms):
            if not _intersects(bounds, self._bounds[index]):
                continue
            if self._prepared[index].contains(frame):
                return np.full(shape, index + 1, dtype=np.int32)
            piece = shapely.clip_by_rect(geometry, *bounds)
            if not piece.is_valid:
                piece = shapely.make_valid(piece)
            piece = _polygonal(piece)
            if piece.is_empty:
                continue
            if labels is None:
                labels = np.zeros(shape, dtype=np.int32)
            rasterize(
                [(piece, index + 1)],
                out_shape=shape,
                transform=window_transform(window, transform),
                out=labels,
            )
        return labels


def _polygonal(geometry: BaseGeometry) -> BaseGeometry:
    parts = [
        part
        for part in shapely.get_parts(geometry)
        if part.geom_type in ("Polygon", "MultiPolygon") and not part.is_empty
    ]
    return shapely.union_all(parts) if parts else shapely.Polygon()


# ============================================================================
# Reprojection and the raw census
# ============================================================================


class _Counts:
    """Pixels per value, for the footprint and for every area."""

    def __init__(self, zone_ids: list[str]):
        self.total = np.zeros(NODATA + 1, dtype=np.int64)
        self.by_zone = {zone_id: np.zeros(NODATA + 1, dtype=np.int64) for zone_id in zone_ids}
        self._ids = zone_ids

    def add(self, values: np.ndarray, valid: np.ndarray, labels: np.ndarray | None) -> None:
        self.total += np.bincount(values[valid], minlength=NODATA + 1)
        if labels is None:
            return
        for index, zone_id in enumerate(self._ids):
            selected = valid & (labels == index + 1)
            if selected.any():
                self.by_zone[zone_id] += np.bincount(values[selected], minlength=NODATA + 1)

    @staticmethod
    def _as_dict(counts: np.ndarray) -> dict[int, int]:
        present = np.flatnonzero(counts)
        return {int(value): int(counts[value]) for value in present if value != NODATA}

    def total_dict(self) -> dict[int, int]:
        return self._as_dict(self.total)

    def by_zone_dict(self) -> dict[str, dict[int, int]]:
        return {zone_id: self._as_dict(counts) for zone_id, counts in self.by_zone.items()}


@dataclass
class _WarpedSource:
    source: Source
    band: int
    vrt: WarpedVRT
    bounds: tuple[float, float, float, float]
    declared_nodata: float | None

    def read(self, window: Window) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Class codes, the pixels holding a usable one, and the pixels inside the
        footprint that do not - NaN, or a declared nodata no class could be."""
        # One read for both bands: each read warps the window afresh.
        values, alpha = self.vrt.read([self.band, self.vrt.count], window=window)
        inside = alpha != 0
        masked = np.zeros_like(inside)
        if values.dtype.kind == "f":
            nan = np.isnan(values)
            masked |= inside & nan
            inside &= ~nan
            if inside.any() and not np.array_equal(values[inside], np.floor(values[inside])):
                raise MapError(
                    f"{self.source.name} holds non-integer values in band {self.band}; "
                    "a stratification map needs one class code per pixel"
                )
        declared = self.declared_nodata
        if declared is not None and not _representable(declared):
            hit = inside & (values == declared)
            masked |= hit
            inside &= ~hit
        if inside.any():
            low, high = values[inside].min(), values[inside].max()
            if low < 0 or high > MAX_VALUE:
                raise MapError(
                    f"{self.source.name} holds the value {low if low < 0 else high:g} in band "
                    f"{self.band}; class codes must lie in 0..{MAX_VALUE}"
                )
        codes = np.where(inside, values, NODATA).astype(STRATA_DTYPE)
        return codes, inside, masked


def _representable(value: float) -> bool:
    return float(value).is_integer() and 0 <= value <= MAX_VALUE


@contextmanager
def _warped(source: Source, band: int, grid: GridSpec, dst: CRS) -> Iterator[_WarpedSource]:
    with _open(source) as ds:
        if band > ds.count:
            raise MapError(f"{source.name} has {ds.count} band(s); there is no band {band}")
        with WarpedVRT(
            ds,
            crs=dst,
            transform=_grid_transform(grid),
            width=grid.width,
            height=grid.height,
            resampling=Resampling.nearest,
            src_nodata=NO_SOURCE_NODATA,
            add_alpha=True,
        ) as vrt:
            yield _WarpedSource(
                source=source,
                band=band,
                vrt=vrt,
                bounds=_dst_bounds(ds, dst, source.name),
                declared_nodata=ds.nodatavals[band - 1],
            )


def reproject(
    sources: list[Source],
    band: int,
    grid: GridSpec,
    zones: list[Zone],
    out_path: str,
    progress: Progress,
) -> RawCensus:
    """Warp every tile onto the grid with nearest resampling, write the result
    as one GeoTIFF of class codes, and count the pixels as they pass.

    Tiles may overlap where they agree; a pixel two tiles disagree about is an
    error, because whichever tile won would decide the stratum weights.
    """
    dst = CRS.from_wkt(grid.crs)
    transform = _grid_transform(grid)
    windows = _windows(grid)
    zone_labels = _Zones(zones)
    counts = _Counts([zone.id for zone in zones])
    footprint = 0
    masked_total = 0
    declared: list[int] = []

    with rasterio.Env(**GDAL_ENV), ExitStack() as stack:
        warped = [stack.enter_context(_warped(source, band, grid, dst)) for source in sources]
        for item in warped:
            value = item.declared_nodata
            if value is not None and _representable(value) and int(value) not in declared:
                declared.append(int(value))
        out = stack.enter_context(
            rasterio.open(
                out_path,
                "w",
                width=grid.width,
                height=grid.height,
                count=1,
                dtype=STRATA_DTYPE,
                crs=dst,
                transform=transform,
                nodata=NODATA,
                **GTIFF_PROFILE,
            )
        )
        for done, window in enumerate(windows):
            bounds = window_bounds(window, transform)
            touching = [item for item in warped if _intersects(bounds, item.bounds)]
            if touching:
                block, valid, masked = _merge(touching, window)
                if valid.any() or masked.any():
                    labels = zone_labels.labels(window, transform)
                    counts.add(block, valid, labels)
                    footprint += int(valid.sum()) + int(masked.sum())
                    masked_total += int(masked.sum())
                    out.write(block, 1, window=window)
            progress((done + 1) / len(windows))

    return RawCensus(
        grid=grid,
        band=band,
        total=counts.total_dict(),
        by_area=counts.by_zone_dict(),
        footprint_pixels=footprint,
        masked_pixels=masked_total,
        declared_nodata=declared,
    )


def _merge(
    sources: list[_WarpedSource], window: Window
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """First tile with a value wins; a later tile may only agree or add pixels."""
    shape = (int(window.height), int(window.width))
    block = np.full(shape, NODATA, dtype=STRATA_DTYPE)
    valid = np.zeros(shape, dtype=bool)
    masked = np.zeros(shape, dtype=bool)
    for item in sources:
        codes, inside, hidden = item.read(window)
        both = valid & inside
        if both.any() and not np.array_equal(block[both], codes[both]):
            disagree = int(np.count_nonzero(block[both] != codes[both]))
            raise MapError(
                f"{item.source.name} overlaps another tile with different values at "
                f"{disagree:,} pixel(s); tiles of one map must agree where they overlap"
            )
        new = inside & ~valid
        block[new] = codes[new]
        valid |= inside
        masked |= hidden
    masked &= ~valid
    return block, valid, masked


# ============================================================================
# Strata
# ============================================================================


def stratify(
    src_path: str,
    classes: list[ReportingClass],
    nodata_values: list[int],
    grid: GridSpec,
    zones: list[Zone],
    out_path: str,
    progress: Progress,
) -> StrataCensus:
    """Fold the reprojected map's values into class codes, 1-based in the
    order given, writing a strata raster and counting the result. A value
    with no class and no nodata declaration stops the run: it would either
    vanish from the population or be counted somewhere it does not belong."""
    lut = np.full(NODATA + 1, NODATA, dtype=STRATA_DTYPE)
    assigned = np.zeros(NODATA + 1, dtype=bool)
    assigned[NODATA] = True
    codes = {cls.id: code for code, cls in enumerate(classes, start=1)}
    for cls in classes:
        for value in cls.values:
            lut[value] = codes[cls.id]
            assigned[value] = True
    for value in nodata_values:
        assigned[value] = True

    transform = _grid_transform(grid)
    windows = _windows(grid)
    zone_labels = _Zones(zones)
    total = np.zeros(len(classes) + 1, dtype=np.int64)
    by_zone = {zone.id: np.zeros(len(classes) + 1, dtype=np.int64) for zone in zones}
    nodata_pixels = 0

    with rasterio.Env(**GDAL_ENV), rasterio.open(src_path) as src:
        _check_grid(src, grid)
        with rasterio.open(
            out_path,
            "w",
            width=grid.width,
            height=grid.height,
            count=1,
            dtype=STRATA_DTYPE,
            crs=src.crs,
            transform=transform,
            nodata=NODATA,
            **GTIFF_PROFILE,
        ) as out:
            for done, window in enumerate(windows):
                block = src.read(1, window=window)
                if not assigned[block].all():
                    unassigned = np.unique(block[~assigned[block]])
                    raise MapError(
                        "Map values without a class or a nodata declaration: "
                        + ", ".join(str(int(v)) for v in unassigned[:20])
                    )
                strata = lut[block]
                inside = block != NODATA
                if inside.any():
                    is_class = strata != NODATA
                    nodata_pixels += int(np.count_nonzero(inside & ~is_class))
                    total += np.bincount(strata[is_class], minlength=len(classes) + 1)
                    labels = zone_labels.labels(window, transform)
                    if labels is not None:
                        for index, zone_id in enumerate(by_zone):
                            selected = is_class & (labels == index + 1)
                            if selected.any():
                                by_zone[zone_id] += np.bincount(
                                    strata[selected], minlength=len(classes) + 1
                                )
                    out.write(strata, 1, window=window)
                progress((done + 1) / len(windows))

    def as_dict(counts: np.ndarray) -> dict[str, int]:
        return {cls.id: int(counts[codes[cls.id]]) for cls in classes}

    return StrataCensus(
        grid=grid,
        codes=codes,
        total=as_dict(total),
        by_area={zone_id: as_dict(counts) for zone_id, counts in by_zone.items()},
        nodata_pixels=nodata_pixels,
    )


def _check_grid(ds: rasterio.DatasetReader, grid: GridSpec) -> None:
    same = (
        ds.width == grid.width
        and ds.height == grid.height
        and ds.transform.almost_equals(_grid_transform(grid))
        and ds.dtypes[0] == STRATA_DTYPE
        and ds.nodata == NODATA
    )
    if not same:
        raise MapError(
            "The reprojected map on disk does not match its grid; run preprocessing again"
        )

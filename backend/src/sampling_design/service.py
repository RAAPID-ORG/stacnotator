import io
import logging
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
from fastapi import HTTPException, UploadFile
from shapely.geometry import MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union
from sqlalchemy.orm import Session

from src.campaigns.models import Campaign
from src.sampling_design.schemas import (
    MAX_TASKS_PER_RUN,
    GridSamplingConfig,
    RandomSamplingConfig,
)
from src.tasks.ingest import MAX_FILE_SIZE, GeoJSONParseError, insert_tasks, parse_geojson_features

logger = logging.getLogger(__name__)


# ============================================================================
# Region
# ============================================================================


async def read_region_file(file: UploadFile) -> Polygon | MultiPolygon:
    """The region an uploaded .geojson or zipped shapefile describes, as one
    WGS84 (multi)polygon."""
    contents = await file.read()
    filename = (file.filename or "").lower()
    if filename.endswith((".geojson", ".json")):
        try:
            geometries = [geom for geom, _ in parse_geojson_features(contents, MAX_FILE_SIZE)]
        except GeoJSONParseError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    elif filename.endswith(".zip"):
        if len(contents) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail="File too large")
        geometries = _shapefile_geometries(contents)
    else:
        raise HTTPException(
            status_code=400,
            detail="File must be either a .zip (containing shapefile) or .geojson/.json file",
        )

    polygons = [
        part
        for geometry in geometries
        for part in shapely.get_parts(geometry.buffer(0))
        if isinstance(part, Polygon) and not part.is_empty
    ]
    if not polygons:
        raise HTTPException(status_code=400, detail="Region file contains no polygons")
    return unary_union(polygons)


def _shapefile_geometries(contents: bytes) -> list:
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        try:
            with zipfile.ZipFile(io.BytesIO(contents)) as zip_ref:
                for member in zip_ref.namelist():
                    if not (temp_path / member).resolve().is_relative_to(temp_path.resolve()):
                        raise HTTPException(
                            status_code=400,
                            detail="Invalid zip file: contains path traversal entries",
                        )
                zip_ref.extractall(temp_path)
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="Invalid zip file") from None

        shp_files = list(temp_path.rglob("*.shp"))
        if len(shp_files) != 1:
            raise HTTPException(
                status_code=400,
                detail="The zip must contain exactly one .shp file",
            )
        try:
            gdf = gpd.read_file(shp_files[0])
        except Exception as e:
            raise HTTPException(status_code=400, detail="Failed to read shapefile") from e

    if gdf.crs is None:
        raise HTTPException(
            status_code=400,
            detail="Shapefile must have a defined Coordinate Reference System (CRS)",
        )
    try:
        gdf = gdf.to_crs(epsg=4326)
    except Exception as e:
        raise HTTPException(
            status_code=400, detail="Failed to convert shapefile to EPSG:4326"
        ) from e
    return list(gdf.geometry.dropna())


def clip_to_campaign(region: Polygon | MultiPolygon, campaign: Campaign) -> Polygon | MultiPolygon:
    """The part of `region` with area inside the campaign's box. A region that
    merely touches the box leaves lines behind, which the samplers cannot draw
    from, so that is no overlap."""
    clipped = region.intersection(box(*campaign.bbox))
    polygons = [part for part in shapely.get_parts(clipped) if isinstance(part, Polygon)]
    if not polygons:
        raise HTTPException(
            status_code=400,
            detail="Region file does not overlap the campaign bounding box",
        )
    return unary_union(polygons)


# ============================================================================
# Sampling Strategies
# ============================================================================


# Bounds the lattice built before it is clipped to the region, so a spacing far
# finer than the region's extent fails instead of exhausting memory.
MAX_LATTICE_NODES = 5_000_000
EDGE_SEGMENT_DEGREES = 0.05


def generate_random_points(
    geometry: Polygon | MultiPolygon, num_samples: int, rng: np.random.Generator
) -> list[Point]:
    """
    Generate random points within a polygon or multipolygon boundary.

    Args:
        geometry: Boundary within which to generate points
        num_samples: Number of points to generate
        rng: Draws every random number this call needs

    Returns:
        List of Point geometries within the boundary
    """
    # Use GeoSeries.sample_points for efficient sampling
    gs = gpd.GeoSeries([geometry])
    sampled = gs.sample_points(num_samples, rng=rng)

    # Extract individual points from the result & shuffle
    result = sampled.iloc[0]
    points = list(result.geoms) if hasattr(result, "geoms") else [result]
    rng.shuffle(points)

    return points


def local_equal_area_crs(geometry: Polygon | MultiPolygon) -> str:
    """
    Lambert azimuthal equal-area projection centred on the region.

    Gives metres to work in anywhere on the globe, with no UTM zone edge for a
    wide region to straddle, and equal cell areas across the whole lattice.
    """
    centroid = geometry.centroid
    return f"+proj=laea +lat_0={centroid.y} +lon_0={centroid.x} +datum=WGS84 +units=m +no_defs"


def _lattice_axis(origin: float, low: float, high: float, spacing: float) -> np.ndarray:
    """The lattice lines origin + k * spacing that fall in [low, high)."""
    start = origin + np.ceil((low - origin) / spacing) * spacing
    return np.arange(start, high, spacing)


def generate_grid_points(
    geometry: Polygon | MultiPolygon, spacing_km: float, rng: np.random.Generator
) -> list[Point]:
    """
    Generate a regular lattice of points spacing_km apart within a boundary.

    The whole lattice carries one random offset smaller than a cell, which is
    what makes systematic sampling unbiased under the design and keeps the grid
    off periodic features in the landscape such as field rows or road grids.

    Args:
        geometry: Boundary within which to generate points
        spacing_km: Distance between neighbouring points
        rng: Draws the lattice offset and the task order

    Returns:
        List of Point geometries within the boundary, in random order

    Raises:
        HTTPException: If the spacing leaves no points inside the region or
            would create more tasks than one run allows
    """
    crs = local_equal_area_crs(geometry)
    # Densify first: a bbox's four corners would project to straight chords,
    # while its parallels curve, and edge cells would land on the wrong side.
    dense = shapely.segmentize(geometry, max_segment_length=EDGE_SEGMENT_DEGREES)
    projected = gpd.GeoSeries([dense], crs=4326).to_crs(crs).iloc[0]
    spacing = spacing_km * 1000
    min_x, min_y, _, _ = projected.bounds
    origin_x = min_x + rng.uniform(0, spacing)
    origin_y = min_y + rng.uniform(0, spacing)

    # One lattice, laid over each part's own envelope: far-apart parts
    # would otherwise be charged for the empty space between them.
    parts = shapely.get_parts(projected)
    axes = [
        (
            _lattice_axis(origin_x, bounds[0], bounds[2], spacing),
            _lattice_axis(origin_y, bounds[1], bounds[3], spacing),
        )
        for bounds in shapely.bounds(parts)
    ]
    if sum(len(xs) * len(ys) for xs, ys in axes) > MAX_LATTICE_NODES:
        raise HTTPException(
            status_code=400,
            detail=f"A {spacing_km} km grid is far too fine for the extent of this region.",
        )

    kept_x, kept_y = [], []
    for part, (xs, ys) in zip(parts, axes, strict=True):
        grid_x, grid_y = (axis.ravel() for axis in np.meshgrid(xs, ys))
        inside = shapely.contains_xy(part, grid_x, grid_y)
        kept_x.append(grid_x[inside])
        kept_y.append(grid_y[inside])
    xs_inside = np.concatenate(kept_x)
    ys_inside = np.concatenate(kept_y)
    num_points = len(xs_inside)

    if num_points == 0:
        raise HTTPException(
            status_code=400,
            detail=(
                f"A {spacing_km} km grid leaves no points inside this region. "
                f"Use a smaller spacing."
            ),
        )
    if num_points > MAX_TASKS_PER_RUN:
        raise HTTPException(
            status_code=400,
            detail=(
                f"A {spacing_km} km grid over this region would create {num_points} tasks, "
                f"more than the {MAX_TASKS_PER_RUN} allowed in one run. Use a larger spacing."
            ),
        )

    points = list(
        gpd.GeoSeries(gpd.points_from_xy(xs_inside, ys_inside), crs=crs).to_crs(epsg=4326)
    )
    rng.shuffle(points)

    return points


# ============================================================================
# Task Generation
# ============================================================================


def create_tasks_from_sampling_strategy(
    db: Session,
    campaign: Campaign,
    strategy: RandomSamplingConfig | GridSamplingConfig,
    region_geometry: Polygon | MultiPolygon,
    task_set_id: int,
) -> int:
    """Sample points in the region and add them to the task set as tasks."""
    # One generator per request, shared by everything the strategy draws.
    rng = np.random.default_rng(strategy.seed)

    if isinstance(strategy, GridSamplingConfig):
        sample_points = generate_grid_points(region_geometry, strategy.spacing_km, rng)
    else:
        sample_points = generate_random_points(region_geometry, strategy.num_samples, rng)

    geometry_wkts = [f"POINT({point.x} {point.y})" for point in sample_points]
    raw_source_data = [
        {"sampling_strategy": strategy.strategy_type, "lon": point.x, "lat": point.y}
        for point in sample_points
    ]
    return insert_tasks(db, campaign, task_set_id, geometry_wkts, raw_source_data)

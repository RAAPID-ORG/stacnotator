import json
import logging
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
from fastapi import HTTPException, UploadFile
from shapely.geometry import MultiPolygon, Point, Polygon, box
from sqlalchemy.orm import Session

from src import background
from src.annotation import embeddings_service
from src.annotation.ingest import insert_tasks
from src.campaigns.models import Campaign
from src.sampling_design.schemas import (
    MAX_TASKS_PER_RUN,
    GridSamplingConfig,
    SamplingStrategy,
)

logger = logging.getLogger(__name__)


# ============================================================================
# Region File Processing (Shapefile or GeoJSON)
# ============================================================================


MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # 20MB


async def process_uploaded_region_file(file: UploadFile) -> gpd.GeoDataFrame:
    """
    Process uploaded region file (shapefile as .zip or .geojson) and return as GeoDataFrame in EPSG:4326.

    Args:
        file: Uploaded file - either a zip containing shapefile components or a .geojson file

    Returns:
        GeoDataFrame with geometry in EPSG:4326

    Raises:
        HTTPException: If file is invalid or cannot be processed
    """
    # Check file size before processing
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {MAX_UPLOAD_SIZE // (1024 * 1024)}MB",
        )
    await file.seek(0)

    filename = file.filename.lower() if file.filename else ""

    if filename.endswith(".geojson") or filename.endswith(".json"):
        return await _process_geojson(file)
    elif filename.endswith(".zip"):
        return await _process_shapefile_zip(file)
    else:
        raise HTTPException(
            status_code=400,
            detail="File must be either a .zip (containing shapefile) or .geojson/.json file",
        )


async def _process_geojson(file: UploadFile) -> gpd.GeoDataFrame:
    """Process uploaded GeoJSON file."""
    try:
        contents = await file.read()
        geojson_data = json.loads(contents.decode("utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid GeoJSON format") from None
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="GeoJSON must be UTF-8 encoded") from None
    except Exception as e:
        logger.exception("Failed to read GeoJSON file")
        raise HTTPException(status_code=400, detail="Failed to read GeoJSON file") from e

    try:
        gdf = gpd.GeoDataFrame.from_features(
            geojson_data.get("features", [geojson_data])
            if geojson_data.get("type") == "FeatureCollection"
            else [geojson_data]
            if geojson_data.get("type") == "Feature"
            else [{"type": "Feature", "geometry": geojson_data, "properties": {}}]
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail="Failed to parse GeoJSON geometry") from e

    if gdf.empty:
        raise HTTPException(status_code=400, detail="GeoJSON contains no valid geometries")

    # GeoJSON is always in WGS84 (EPSG:4326) by specification
    gdf = gdf.set_crs(epsg=4326)

    # Fix invalid geometries before dissolving
    gdf["geometry"] = gdf["geometry"].buffer(0)

    # Dissolve all features into a single geometry if multiple features exist
    if len(gdf) > 1:
        try:
            gdf = gdf.dissolve()
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail="Failed to merge geometries. The file may contain complex or invalid topology.",
            ) from e

    return gdf


async def _process_shapefile_zip(file: UploadFile) -> gpd.GeoDataFrame:
    """Process uploaded shapefile as ZIP."""
    # Create temporary directory for extraction
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        zip_path = temp_path / "upload.zip"

        # Save uploaded file
        try:
            contents = await file.read()
            with open(zip_path, "wb") as f:
                f.write(contents)
        except Exception as e:
            raise HTTPException(status_code=400, detail="Failed to save uploaded file") from e

        # Extract zip file (with Zip Slip protection)
        try:
            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                for member in zip_ref.namelist():
                    member_path = (temp_path / member).resolve()
                    if not member_path.is_relative_to(temp_path.resolve()):
                        raise HTTPException(
                            status_code=400,
                            detail="Invalid zip file: contains path traversal entries",
                        )
                zip_ref.extractall(temp_path)
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="Invalid zip file") from None
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("Failed to extract shapefile zip")
            raise HTTPException(status_code=400, detail="Failed to extract shapefile") from e

        # Find .shp file
        shp_files = list(temp_path.rglob("*.shp"))
        if not shp_files:
            raise HTTPException(status_code=400, detail="No .shp file found in the uploaded zip")

        if len(shp_files) > 1:
            raise HTTPException(
                status_code=400,
                detail="Multiple .shp files found. Please upload a zip with a single shapefile.",
            )

        shp_path = shp_files[0]

        try:
            gdf = gpd.read_file(shp_path)
        except Exception as e:
            raise HTTPException(status_code=400, detail="Failed to read shapefile") from e

        if gdf.crs is None:
            raise HTTPException(
                status_code=400,
                detail="Shapefile must have a defined Coordinate Reference System (CRS)",
            )

        if gdf.crs.to_epsg() != 4326:
            try:
                gdf = gdf.to_crs(epsg=4326)
            except Exception as e:
                raise HTTPException(
                    status_code=400, detail="Failed to convert shapefile to EPSG:4326"
                ) from e

        # Fix invalid geometries before dissolving
        gdf["geometry"] = gdf["geometry"].buffer(0)

        # Dissolve all features into a single geometry if multiple features exist
        if len(gdf) > 1:
            try:
                gdf = gdf.dissolve()
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail="Failed to merge geometries. The file may contain complex or invalid topology.",
                ) from e

        return gdf


def get_region_geometry(gdf: gpd.GeoDataFrame) -> Polygon | MultiPolygon:
    """
    Extract the region geometry from a GeoDataFrame.

    Args:
        gdf: GeoDataFrame with boundary geometry

    Returns:
        Shapely Polygon or MultiPolygon

    Raises:
        HTTPException: If geometry is invalid
    """
    if len(gdf) == 0:
        raise HTTPException(status_code=400, detail="Shapefile contains no geometries")

    geometry = gdf.geometry.iloc[0]

    if not geometry.is_valid:
        raise HTTPException(status_code=400, detail="Shapefile geometry is invalid")

    if geometry.is_empty:
        raise HTTPException(status_code=400, detail="Shapefile geometry is empty")

    return geometry


def create_bbox_polygon(campaign: Campaign) -> Polygon:
    """
    Create a Polygon geometry from a campaign's bounding box.

    Args:
        campaign: Campaign with bbox settings

    Returns:
        Shapely Polygon representing the bounding box

    Raises:
        HTTPException: If campaign settings or bbox is missing
    """
    if not campaign.settings:
        raise HTTPException(
            status_code=400,
            detail="Campaign settings not found. Cannot use campaign bounding box.",
        )

    bbox_west = campaign.settings.bbox_west
    bbox_south = campaign.settings.bbox_south
    bbox_east = campaign.settings.bbox_east
    bbox_north = campaign.settings.bbox_north

    if any(coord is None for coord in [bbox_west, bbox_south, bbox_east, bbox_north]):
        raise HTTPException(
            status_code=400,
            detail="Campaign bounding box is incomplete. Please set all bbox coordinates.",
        )

    return box(bbox_west, bbox_south, bbox_east, bbox_north)


# ============================================================================
# Sampling Strategies
# ============================================================================


# Bounds the lattice built before it is clipped to the region, so a spacing far
# finer than the region's extent fails instead of exhausting memory.
MAX_LATTICE_NODES = 5_000_000


def generate_random_points(
    geometry: Polygon | MultiPolygon, num_samples: int, rng: np.random.Generator
) -> list[Point]:
    """
    Generate random points within a polygon or multipolygon boundary.

    Args:
        geometry: Boundary within which to generate points
        num_samples: Number of points to generate
        rng: Draws every random number this call needs. Seed it once per
            request so composed strategies never repeat a stream.

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
    projected = gpd.GeoSeries([geometry], crs=4326).to_crs(crs).iloc[0]
    spacing = spacing_km * 1000
    min_x, min_y, max_x, max_y = projected.bounds

    lattice_nodes = ((max_x - min_x) / spacing + 1) * ((max_y - min_y) / spacing + 1)
    if lattice_nodes > MAX_LATTICE_NODES:
        raise HTTPException(
            status_code=400,
            detail=f"A {spacing_km} km grid is far too fine for the extent of this region.",
        )

    xs = np.arange(min_x + rng.uniform(0, spacing), max_x, spacing)
    ys = np.arange(min_y + rng.uniform(0, spacing), max_y, spacing)
    grid_x, grid_y = (axis.ravel() for axis in np.meshgrid(xs, ys))
    inside = shapely.contains_xy(projected, grid_x, grid_y)
    num_points = int(inside.sum())

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
        gpd.GeoSeries(gpd.points_from_xy(grid_x[inside], grid_y[inside]), crs=crs).to_crs(epsg=4326)
    )
    rng.shuffle(points)

    return points


# ============================================================================
# Task Generation
# ============================================================================


def create_tasks_from_sampling_strategy(
    db: Session,
    campaign_id: int,
    strategy: SamplingStrategy,
    region_geometry: Polygon | MultiPolygon,
    task_set_id: int,
) -> int:
    """
    Create annotation tasks based on a sampling strategy.

    Args:
        db: Database session
        campaign_id: ID of campaign to create tasks for
        strategy: Validated configuration of the strategy to draw with
        region_geometry: Boundary geometry for sampling
        task_set_id: ID of task set to assign created tasks to

    Returns:
        Number of tasks created

    Raises:
        HTTPException: If sampling or task creation fails
    """
    # One generator per request: every stage of a strategy draws from the same
    # stream, so no two of them can repeat each other's numbers.
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
    num_created = insert_tasks(db, campaign_id, task_set_id, geometry_wkts, raw_source_data)

    campaign = db.get(Campaign, campaign_id)
    embedding_year = campaign.settings.embedding_year if campaign and campaign.settings else None
    if embedding_year is not None and campaign is not None:
        # Off the request path: the spawned thread flips this to ready/failed
        # once populate_campaign_embeddings finishes (or fails).
        background.begin_status_run(campaign, embeddings_service.EMBEDDING_RUN)
        db.commit()
        embeddings_service.spawn_background_embedding_computation(campaign_id, embedding_year)

    return num_created

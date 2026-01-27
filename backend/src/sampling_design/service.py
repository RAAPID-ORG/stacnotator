import json
import tempfile
import zipfile
from pathlib import Path
from typing import List

import geopandas as gpd
import numpy as np
from fastapi import HTTPException, UploadFile
from shapely.geometry import Point, MultiPolygon, Polygon, box
from sqlalchemy import insert, select, func
from sqlalchemy.orm import Session

from src.annotation.models import AnnotationGeometry, AnnotationTaskItem
from src.campaigns.models import Campaign


# ============================================================================
# Region File Processing (Shapefile or GeoJSON)
# ============================================================================


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
        raise HTTPException(status_code=400, detail="Invalid GeoJSON format")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="GeoJSON must be UTF-8 encoded")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read GeoJSON: {str(e)}")

    try:
        gdf = gpd.GeoDataFrame.from_features(
            geojson_data.get("features", [geojson_data])
            if geojson_data.get("type") == "FeatureCollection"
            else [geojson_data]
            if geojson_data.get("type") == "Feature"
            else [{"type": "Feature", "geometry": geojson_data, "properties": {}}]
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse GeoJSON geometry: {str(e)}")

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
                detail=f"Failed to merge geometries. The GeoJSON may contain complex or invalid topology: {str(e)}",
            )

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
            raise HTTPException(status_code=400, detail=f"Failed to save uploaded file: {str(e)}")

        # Extract zip file
        try:
            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                zip_ref.extractall(temp_path)
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="Invalid zip file")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to extract shapefile: {str(e)}")

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
            raise HTTPException(status_code=400, detail=f"Failed to read shapefile: {str(e)}")

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
                    status_code=400, detail=f"Failed to convert shapefile to EPSG:4326: {str(e)}"
                )

        # Fix invalid geometries before dissolving
        gdf["geometry"] = gdf["geometry"].buffer(0)

        # Dissolve all features into a single geometry if multiple features exist
        if len(gdf) > 1:
            try:
                gdf = gdf.dissolve()
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to merge geometries. The shapefile may contain complex or invalid topology: {str(e)}",
                )

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


def generate_random_points(
    geometry: Polygon | MultiPolygon, num_samples: int, seed: int | None = None
) -> List[Point]:
    """
    Generate random points within a polygon or multipolygon boundary.

    Args:
        geometry: Boundary within which to generate points
        num_samples: Number of points to generate
        seed: Random seed for reproducibility

    Returns:
        List of Point geometries within the boundary
    """
    rng = np.random.default_rng(seed)

    # Use GeoSeries.sample_points for efficient sampling
    gs = gpd.GeoSeries([geometry])
    sampled = gs.sample_points(num_samples, rng=rng)

    # Extract individual points from the MultiPoint result
    points = list(sampled.iloc[0].geoms)

    return points


# ============================================================================
# Task Generation
# ============================================================================


def create_tasks_from_sampling_strategy(
    db: Session,
    campaign_id: int,
    strategy_type: str,
    num_samples: int,
    region_geometry: Polygon | MultiPolygon,
    parameters: dict | None = None,
) -> int:
    """
    Create annotation tasks based on a sampling strategy.

    Args:
        db: Database session
        campaign_id: ID of campaign to create tasks for
        strategy_type: Type of sampling ('random', 'stratified_random', etc.)
        num_samples: Number of samples to generate
        region_geometry: Boundary geometry for sampling
        parameters: Additional strategy-specific parameters

    Returns:
        Number of tasks created

    Raises:
        HTTPException: If strategy type is unsupported or generation fails
    """
    # Generate sample points based on strategy
    if strategy_type == "random":
        seed = parameters.get("seed") if parameters else None
        sample_points = generate_random_points(region_geometry, num_samples, seed)
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported sampling strategy: {strategy_type}. "
            f"Currently supported: ['random']",
        )

    # Get the current max annotation_number for this campaign
    max_annotation_number = db.scalar(
        select(func.coalesce(func.max(AnnotationTaskItem.annotation_number), 0)).where(
            AnnotationTaskItem.campaign_id == campaign_id
        )
    )

    # Create geometry records
    geometry_records = [
        {"geometry": f"SRID=4326;POINT({point.x} {point.y})"} for point in sample_points
    ]

    try:
        # Insert geometries and get IDs
        geometry_result = db.execute(
            insert(AnnotationGeometry).returning(AnnotationGeometry.id),
            geometry_records,
        )
        geometry_ids = [row.id for row in geometry_result]

        # Create task items
        task_records = [
            {
                "annotation_number": max_annotation_number + i + 1,
                "campaign_id": campaign_id,
                "geometry_id": geometry_id,
                "status": "pending",
                "raw_source_data": {
                    "sampling_strategy": strategy_type,
                    "lon": point.x,
                    "lat": point.y,
                },
            }
            for i, (geometry_id, point) in enumerate(zip(geometry_ids, sample_points))
        ]

        db.execute(insert(AnnotationTaskItem), task_records)
        db.commit()

        return len(task_records)

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create tasks: {str(e)}")

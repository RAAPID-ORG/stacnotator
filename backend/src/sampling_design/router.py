from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPBearer
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry import box as shapely_box
from sqlalchemy.orm import Session

from src.auth.dependencies import require_approved_user
from src.campaigns.dependencies import require_campaign_admin
from src.campaigns.models import Campaign
from src.campaigns.task_sets import require_task_set
from src.database import get_db
from src.sampling_design import service
from src.sampling_design.schemas import GenerateTasksResponse, SamplingStrategyConfig


def _intersect_region_with_bbox(
    region_geometry: Polygon | MultiPolygon,
    campaign: Campaign,
) -> Polygon | MultiPolygon:
    """Clip region_geometry to the campaign bbox if the campaign has settings.

    Returns the original geometry unchanged when the campaign has no settings
    (no bbox configured). Raises HTTP 400 if the intersection is empty.
    """
    if campaign.settings is None:
        return region_geometry

    campaign_bbox = shapely_box(
        campaign.settings.bbox_west,
        campaign.settings.bbox_south,
        campaign.settings.bbox_east,
        campaign.settings.bbox_north,
    )
    intersection = region_geometry.intersection(campaign_bbox)

    if intersection.is_empty:
        raise HTTPException(
            status_code=400,
            detail="Region file does not overlap the campaign bounding box",
        )
    return intersection


bearer = HTTPBearer()
router = APIRouter(
    prefix="/campaigns/{campaign_id}/sampling",
    tags=["Sampling Design"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
)


@router.post("/generate-tasks", response_model=GenerateTasksResponse)
async def generate_tasks_from_sampling(
    campaign_id: int,
    strategy: str = Form(..., description="JSON string of SamplingStrategyConfig"),
    task_set_id: int = Form(...),
    region_file: UploadFile | None = File(
        None,
        description="Region boundary file (.zip shapefile or .geojson). Optional if using campaign bbox.",
    ),
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """
    Generate annotation tasks using a sampling strategy.

    You can either upload a region boundary file OR use the campaign's bounding box:

    **Option 1: Upload a region boundary file**
    - `.zip` - Shapefile (containing .shp, .shx, .dbf, .prj files)
    - `.geojson` or `.json` - GeoJSON file

    **Option 2: Use campaign bounding box**
    - Set `use_campaign_bbox: true` in the strategy JSON
    - No region_file required

    **Parameters:**
    - strategy: JSON string with strategy_type, num_samples, use_campaign_bbox, and optional parameters
      Example with file: {"strategy_type":"random","num_samples":10,"use_campaign_bbox":false,"parameters":{"seed":42}}
      Example with bbox: {"strategy_type":"random","num_samples":10,"use_campaign_bbox":true,"parameters":{"seed":42}}

    Shapefiles will be automatically converted to EPSG:4326 if needed.
    GeoJSON files are assumed to be in WGS84 (EPSG:4326) per specification.
    Sample points will be generated within the boundary and created as annotation tasks.
    """
    # Parse strategy JSON string
    strategy_config = SamplingStrategyConfig.model_validate_json(strategy)
    require_task_set(db, campaign.id, task_set_id, status_code=400)

    # Determine region geometry source
    if strategy_config.use_campaign_bbox:
        # Use campaign bounding box
        region_geometry = service.create_bbox_polygon(campaign)
    else:
        # Use uploaded region file
        if not region_file:
            raise HTTPException(
                status_code=400,
                detail="region_file is required when use_campaign_bbox is false",
            )
        # Process region file (shapefile or GeoJSON)
        gdf = await service.process_uploaded_region_file(region_file)
        region_geometry = service.get_region_geometry(gdf)
        region_geometry = _intersect_region_with_bbox(region_geometry, campaign)

    # Generate tasks
    num_tasks_created = service.create_tasks_from_sampling_strategy(
        db=db,
        campaign_id=campaign_id,
        strategy_type=strategy_config.strategy_type,
        num_samples=strategy_config.num_samples,
        region_geometry=region_geometry,
        parameters=strategy_config.parameters,
        task_set_id=task_set_id,
    )

    return GenerateTasksResponse(
        campaign_id=campaign_id,
        num_tasks_created=num_tasks_created,
        message=f"Successfully generated {num_tasks_created} tasks using {strategy_config.strategy_type} sampling",
    )

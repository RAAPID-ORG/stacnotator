from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_approved_user
from src.campaigns.dependencies import require_campaign_admin
from src.campaigns.models import Campaign
from src.database import get_db
from src.sampling_design import service
from src.sampling_design.schemas import GenerateTasksResponse, SamplingStrategyConfig
from src.utils import FunctionNameOperationIdRoute

bearer = HTTPBearer()
router = APIRouter(
    prefix="/campaigns/{campaign_id}/sampling",
    tags=["Sampling Design"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
    route_class=FunctionNameOperationIdRoute,
)


@router.post("/generate-tasks", response_model=GenerateTasksResponse)
async def generate_tasks_from_sampling(
    campaign_id: int,
    strategy: str = Form(..., description="JSON string of SamplingStrategyConfig"),
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

    # Generate tasks
    num_tasks_created = service.create_tasks_from_sampling_strategy(
        db=db,
        campaign_id=campaign_id,
        strategy_type=strategy_config.strategy_type,
        num_samples=strategy_config.num_samples,
        region_geometry=region_geometry,
        parameters=strategy_config.parameters,
    )

    return GenerateTasksResponse(
        campaign_id=campaign_id,
        num_tasks_created=num_tasks_created,
        message=f"Successfully generated {num_tasks_created} tasks using {strategy_config.strategy_type} sampling",
    )

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPBearer
from pydantic import ValidationError
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry import box as shapely_box
from sqlalchemy.orm import Session

from src.auth.dependencies import require_authenticated_user
from src.campaigns.dependencies import require_campaign_admin
from src.campaigns.models import Campaign
from src.campaigns.task_sets import require_task_set
from src.database import get_db
from src.sampling_design import service
from src.sampling_design.schemas import GenerateTasksResponse, parse_sampling_strategy


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
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


@router.post("/generate-tasks", response_model=GenerateTasksResponse)
async def generate_tasks_from_sampling(
    campaign_id: int,
    strategy: str = Form(..., description="JSON string of a sampling strategy"),
    task_set_id: int = Form(...),
    use_campaign_bbox: bool = Form(
        False,
        description="Sample the campaign's bounding box instead of an uploaded region file",
    ),
    region_file: UploadFile | None = File(
        None,
        description="Region boundary file (.zip shapefile or .geojson). Optional if using campaign bbox.",
    ),
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """
    Generate annotation tasks using a sampling strategy.

    **Region**, either an uploaded boundary or the campaign's own box:
    - `.zip` (shapefile with its .shp/.shx/.dbf/.prj), or `.geojson`/`.json`.
      Shapefiles are converted to EPSG:4326; GeoJSON is assumed to be in it
      already, per the specification. The region is clipped to the campaign box.
    - `use_campaign_bbox: true` and no file.

    **Strategy**, a JSON string picked by `strategy_type`:
    - `{"strategy_type":"random","num_samples":100,"seed":42}` - independent
      uniform points across the region.
    - `{"strategy_type":"grid","spacing_km":5,"seed":42}` - a lattice with
      points 5 km apart, offset by one random step below a cell so the sample
      stays unbiased. The task count follows from the region's area.

    `seed` is optional in both and makes the draw reproducible. Sampled points
    become annotation tasks in the given task set.
    """
    try:
        strategy_config = parse_sampling_strategy(strategy)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=f"Invalid sampling strategy: {e}") from e

    require_task_set(db, campaign.id, task_set_id, status_code=400)

    if use_campaign_bbox:
        region_geometry = service.create_bbox_polygon(campaign)
    else:
        if not region_file:
            raise HTTPException(
                status_code=400,
                detail="region_file is required when use_campaign_bbox is false",
            )
        gdf = await service.process_uploaded_region_file(region_file)
        region_geometry = service.get_region_geometry(gdf)
        region_geometry = _intersect_region_with_bbox(region_geometry, campaign)

    num_tasks_created = service.create_tasks_from_sampling_strategy(
        db=db,
        campaign_id=campaign_id,
        strategy=strategy_config,
        region_geometry=region_geometry,
        task_set_id=task_set_id,
    )

    return GenerateTasksResponse(
        campaign_id=campaign_id,
        num_tasks_created=num_tasks_created,
        message=(
            f"Successfully generated {num_tasks_created} tasks "
            f"using {strategy_config.strategy_type} sampling"
        ),
    )

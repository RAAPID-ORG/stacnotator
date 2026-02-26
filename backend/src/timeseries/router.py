from calendar import monthrange

from fastapi import APIRouter, Depends
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_approved_user
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.database import get_db
from src.timeseries import service
from src.timeseries.constants import (
    SUPPORTED_TIMESERIES_PROVIDERS,
    SUPPORTED_TIMESERIES_SOURCES,
    SUPPORTED_TIMESERIES_TYPES,
)
from src.timeseries.schemas import (
    TimeseriesBulkCreateRequest,
    TimeseriesBulkCreateResponse,
    TimeseriesDataResponse,
    TimeseriesListResponse,
    TimeSeriesOptionsOut,
)
from src.utils import FunctionNameOperationIdRoute

router = APIRouter(
    tags=["Time Series"],
    dependencies=[Depends(HTTPBearer()), Depends(require_approved_user)],
    route_class=FunctionNameOperationIdRoute,
)


@router.get("/campaigns/{campaign_id}/timeseries", response_model=TimeseriesListResponse)
def get_timeseries_for_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    """Get all timeseries configurations for a campaign. NOT the actual data, just the metadata about the timeseries."""
    timeseries = service.get_timeseries_for_campaign(campaign_id, db)
    return TimeseriesListResponse(items=timeseries)


@router.post("/campaigns/{campaign_id}/timeseries", response_model=TimeseriesBulkCreateResponse)
def create_timeseries_for_campaign(
    campaign_id: int,
    request: TimeseriesBulkCreateRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Bulk create timeseries items for a campaign. Will register the timeseries configuration to campaign."""
    new_items = service.create_timeseries_bulk(campaign_id, request.timeseries, db)
    return TimeseriesBulkCreateResponse(new_items=new_items)


@router.get("/timeseries/create-options", response_model=TimeSeriesOptionsOut)
def get_timeseries_creation_options():
    """Get options for registering new timeseries for a campaign, such as supported data sources, providers, and types."""
    return TimeSeriesOptionsOut(
        data_sources=SUPPORTED_TIMESERIES_SOURCES,
        providers=SUPPORTED_TIMESERIES_PROVIDERS,
        ts_types=SUPPORTED_TIMESERIES_TYPES,
    )


# TODO might need to think again if this route requires campaign member access
@router.get(
    "/timeseries/{timeseries_id}/{latitude}/{longitude}/data", response_model=TimeseriesDataResponse
)
def get_timeseries_data(
    timeseries_id: int, latitude: float, longitude: float, db: Session = Depends(get_db)
):
    """Fetch the actual timeseries data from an external provider based on the timeseries config."""
    timeseries = service.get_timeseries_by_id(timeseries_id, db)

    start_year, start_month = int(timeseries.start_ym[:4]), int(timeseries.start_ym[4:6])
    end_year, end_month = int(timeseries.end_ym[:4]), int(timeseries.end_ym[4:6])
    start = f"{start_year}-{start_month:02d}-01"
    end = f"{end_year}-{end_month:02d}-{monthrange(end_year, end_month)[1]}"

    timeseries_data_df = service.get_timeseries_data(
        ts_type=timeseries.ts_type,
        source=timeseries.data_source,
        latitude=latitude,
        longitude=longitude,
        start_date=start,
        end_date=end,
    )

    return TimeseriesDataResponse(
        timeseries_id=timeseries_id, data=timeseries_data_df.to_dict(orient="records")
    )


@router.delete("/campaigns/{campaign_id}/timeseries/{timeseries_id}", status_code=204)
def delete_timeseries(
    campaign_id: int,
    timeseries_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Delete a timeseries. If it's the last one, removes it from all layouts."""
    service.delete_timeseries(timeseries_id, campaign_id, db)

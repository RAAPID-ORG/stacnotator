from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_approved_user
from src.auth.models import User
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.database import get_db
from src.routing import FunctionNameOperationIdRoute
from src.timeseries import service
from src.timeseries.constants import (
    SUPPORTED_TIMESERIES_PROVIDERS,
    SUPPORTED_TIMESERIES_SOURCES,
    SUPPORTED_TIMESERIES_TYPES,
)
from src.timeseries.ndvi_ee import RateLimited, UpstreamFailed
from src.timeseries.schemas import (
    TimeseriesBulkCreateRequest,
    TimeseriesBulkCreateResponse,
    TimeseriesDataResponse,
    TimeseriesListResponse,
    TimeSeriesOptionsOut,
    ym_range_to_dates,
)

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


@router.get(
    "/timeseries/{timeseries_id}/{latitude}/{longitude}/data", response_model=TimeseriesDataResponse
)
def get_timeseries_data(
    timeseries_id: int,
    latitude: float,
    longitude: float,
    db: Session = Depends(get_db),
    user: User = Depends(require_approved_user),
):
    """Fetch the actual timeseries data from an external provider based on the timeseries config."""
    timeseries = service.get_timeseries_by_id(timeseries_id, db)
    require_campaign_access(campaign_id=timeseries.campaign_id, db=db, user=user)

    try:
        start, end = ym_range_to_dates(timeseries.start_ym, timeseries.end_ym)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Timeseries has an invalid date range: {exc}"
        ) from exc

    # Free the pooled connection back before the slow Earth Engine call.
    ts_type, source = timeseries.ts_type, timeseries.data_source
    db.close()

    try:
        timeseries_data_df = service.get_timeseries_data(
            ts_type=ts_type,
            source=source,
            latitude=latitude,
            longitude=longitude,
            start_date=start,
            end_date=end,
        )
    except RateLimited as exc:
        raise HTTPException(
            status_code=503,
            detail="Earth Engine is rate-limiting requests. Please retry in a moment.",
        ) from exc
    except UpstreamFailed as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Earth Engine request failed: {exc}",
        ) from exc

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

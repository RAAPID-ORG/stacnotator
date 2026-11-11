from collections.abc import Callable

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_authenticated_user
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.database import get_db
from src.earth_engine import ensure_earth_engine
from src.timeseries import service
from src.timeseries.fetch import (
    RateLimited,
    UpstreamFailed,
    fetch_index_series,
    fetch_zonal_index_series,
)
from src.timeseries.indices import SpectralIndex
from src.timeseries.schemas import (
    CustomIndexIn,
    CustomIndexOut,
    TimeseriesBulkCreateRequest,
    TimeseriesBulkCreateResponse,
    TimeseriesDataResponse,
    TimeseriesOptionsOut,
    TimeseriesWindowRenameRequest,
    ZonalTimeseriesRequest,
    timeseries_options,
    ym_range_to_dates,
)
from src.timeseries.sources import TimeseriesSource

router = APIRouter(
    tags=["Time Series"],
    dependencies=[Depends(HTTPBearer()), Depends(require_authenticated_user)],
)


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


@router.get("/timeseries/create-options", response_model=TimeseriesOptionsOut)
def get_timeseries_creation_options():
    """Get options for registering new timeseries for a campaign: the satellite
    sources, the spectral indices each one can compute, and what they are for."""
    return timeseries_options()


@router.post("/timeseries/custom-indices/preview", response_model=CustomIndexOut)
def preview_custom_index(request: CustomIndexIn):
    """Check a custom index without saving it: its rendered formula and the sources
    that can compute it, or a 422 saying what is wrong with the expression."""
    return CustomIndexOut.model_validate(request)


@router.post(
    "/campaigns/{campaign_id}/timeseries/custom-indices",
    response_model=CustomIndexOut,
    status_code=201,
)
def create_custom_index(
    campaign_id: int,
    request: CustomIndexIn,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    return CustomIndexOut.model_validate(service.create_custom_index(db, campaign_id, request))


@router.put(
    "/campaigns/{campaign_id}/timeseries/custom-indices/{name}", response_model=CustomIndexOut
)
def update_custom_index(
    campaign_id: int,
    name: str,
    request: CustomIndexIn,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    return CustomIndexOut.model_validate(
        service.update_custom_index(db, campaign_id, name, request)
    )


@router.delete("/campaigns/{campaign_id}/timeseries/custom-indices/{name}", status_code=204)
def delete_custom_index(
    campaign_id: int,
    name: str,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    service.delete_custom_index(db, campaign_id, name)


@router.patch("/campaigns/{campaign_id}/timeseries/windows/{window_id}", status_code=204)
def rename_timeseries_window(
    campaign_id: int,
    window_id: int,
    request: TimeseriesWindowRenameRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    service.rename_timeseries_window(campaign_id, window_id, request.name, db)


def _series_data(
    campaign_id: int,
    timeseries_id: int,
    db: Session,
    fetch: Callable[[TimeseriesSource, SpectralIndex, str, str], pd.DataFrame],
) -> TimeseriesDataResponse:
    """Look up a campaign's series, release the DB connection, then run `fetch`
    (source, index, start, end) against Earth Engine with errors mapped."""
    timeseries = service.get_timeseries_by_id(timeseries_id, db)
    if timeseries.campaign_id != campaign_id:
        raise HTTPException(status_code=404, detail="Timeseries not found")

    try:
        start, end = ym_range_to_dates(timeseries.start_ym, timeseries.end_ym)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Timeseries has an invalid date range: {exc}"
        ) from exc
    try:
        source, index = service.series_definition(timeseries)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Free the pooled connection back before the slow Earth Engine call.
    db.close()

    if not ensure_earth_engine():
        raise HTTPException(
            status_code=503,
            detail="Earth Engine is currently unavailable. Please retry in a moment.",
        )

    try:
        timeseries_data_df = fetch(source, index, start, end)
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


@router.get(
    "/campaigns/{campaign_id}/timeseries/{timeseries_id}/data",
    response_model=TimeseriesDataResponse,
)
def get_timeseries_data(
    campaign_id: int,
    timeseries_id: int,
    latitude: float,
    longitude: float,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    """A series' values at a point, fetched from its provider."""
    return _series_data(
        campaign_id,
        timeseries_id,
        db,
        lambda source, index, start, end: fetch_index_series(
            source,
            index,
            latitude=latitude,
            longitude=longitude,
            start_date=start,
            end_date=end,
        ),
    )


@router.post(
    "/campaigns/{campaign_id}/timeseries/{timeseries_id}/data",
    response_model=TimeseriesDataResponse,
)
def get_zonal_timeseries_data(
    campaign_id: int,
    timeseries_id: int,
    request: ZonalTimeseriesRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    """A series' per-image mean over a polygon. Each point is the mean of the index
    over the polygon's clear pixels (cloud 0), or over all its pixels when every one
    is cloudy (cloud 1); images with no unmasked pixel in the polygon are left out."""
    geometry = request.geometry_json()
    return _series_data(
        campaign_id,
        timeseries_id,
        db,
        lambda source, index, start, end: fetch_zonal_index_series(
            source,
            index,
            geometry=geometry,
            start_date=start,
            end_date=end,
        ),
    )


@router.delete("/campaigns/{campaign_id}/timeseries/{timeseries_id}", status_code=204)
def delete_timeseries(
    campaign_id: int,
    timeseries_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Delete a timeseries, and its window when it was the window's last."""
    service.delete_timeseries(timeseries_id, campaign_id, db)

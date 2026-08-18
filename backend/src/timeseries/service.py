import pandas as pd
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.campaigns.models import Campaign
from src.canvas.service import sync_main_layouts
from src.config import get_settings
from src.timeseries.fetch import fetch_index_series
from src.timeseries.indices import index_for
from src.timeseries.models import TimeSeries
from src.timeseries.schemas import TimeSeriesCreate
from src.timeseries.sources import source_for
from src.timeseries.windows import distinct_window_keys, sync_timeseries_windows_in_layout

settings = get_settings()


def get_timeseries_data(
    ts_type: str,
    data_source: str,
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """Resolve a stored series' source and index, then fetch its values. Raises
    ValueError if the stored combination is no longer one we can compute."""
    source = source_for(data_source)
    if source is None:
        raise ValueError(f"Unsupported data source: {data_source}")

    index = index_for(ts_type)
    if index is None:
        raise ValueError(f"Unknown index: {ts_type}")

    return fetch_index_series(
        source,
        index,
        latitude=latitude,
        longitude=longitude,
        start_date=start_date,
        end_date=end_date,
    )


# ============================================================================
# Timeseries management functions
# ============================================================================


def sync_campaign_timeseries_windows(campaign_id: int, db: Session) -> None:
    """
    Reconcile every main canvas layout with the campaign's current timeseries
    windows: one window per distinct ``window_name`` (unnamed series share the
    default window). Called after any create/delete so windows appear as their
    first series is added and disappear once emptied. Main layouts have
    ``view_id = None`` (both the campaign default and per-user personal copies).
    """
    window_names = (
        db.execute(select(TimeSeries.window_name).where(TimeSeries.campaign_id == campaign_id))
        .scalars()
        .all()
    )
    desired_keys = distinct_window_keys(window_names)
    sync_main_layouts(
        db, campaign_id, lambda ld: sync_timeseries_windows_in_layout(ld, desired_keys)
    )


def get_timeseries_for_campaign(campaign_id: int, db: Session) -> list[TimeSeries]:
    # Check campaign exists
    campaign = db.execute(select(Campaign).where(Campaign.id == campaign_id)).scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail=f"Campaign with id {campaign_id} not found")

    return list(
        db.execute(select(TimeSeries).where(TimeSeries.campaign_id == campaign_id)).scalars().all()
    )


def create_timeseries_bulk(
    campaign_id: int, ts_creates: list[TimeSeriesCreate], db: Session
) -> list[TimeSeries]:
    """
    Create multiple timeseries for a campaign and sync the canvas windows.

    Each series is placed in the window named by its ``window_name`` (unnamed
    series share the default window); the main canvas layouts gain one window per
    distinct name.

    Args:
        campaign_id: ID of the campaign
        ts_creates: List of timeseries creation schemas
        db: Database session

    Returns:
        List of created timeseries objects
    """
    # Verify campaign exists
    campaign = db.execute(select(Campaign).where(Campaign.id == campaign_id)).scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail=f"Campaign with id {campaign_id} not found")

    # Create timeseries entries
    new_items = []
    for ts_create in ts_creates:
        ts_item = TimeSeries(
            campaign_id=campaign_id,
            name=ts_create.name,
            window_name=ts_create.window_name,
            start_ym=ts_create.start_ym,
            end_ym=ts_create.end_ym,
            data_source=ts_create.data_source,
            provider=ts_create.provider,
            ts_type=ts_create.ts_type,
        )
        new_items.append(ts_item)

    db.add_all(new_items)
    db.flush()

    sync_campaign_timeseries_windows(campaign_id, db)

    db.commit()
    return new_items


def get_timeseries_by_id(timeseries_id: int, db: Session) -> TimeSeries:
    ts_item = db.execute(
        select(TimeSeries).where(TimeSeries.id == timeseries_id)
    ).scalar_one_or_none()
    if not ts_item:
        raise HTTPException(status_code=404, detail=f"TimeSeries with id {timeseries_id} not found")
    return ts_item


def delete_timeseries(timeseries_id: int, campaign_id: int, db: Session) -> None:
    """
    Delete a timeseries and sync the canvas windows.

    Removing the last series in a window drops that window from all main canvas
    layouts (default and personal); other windows are left in place.

    Args:
        timeseries_id: ID of the timeseries to delete
        campaign_id: ID of the campaign (for validation)
        db: Database session
    """
    # Verify timeseries exists and belongs to campaign
    ts_item = db.execute(
        select(TimeSeries).where(
            TimeSeries.id == timeseries_id,
            TimeSeries.campaign_id == campaign_id,
        )
    ).scalar_one_or_none()

    if not ts_item:
        raise HTTPException(
            status_code=404,
            detail=f"TimeSeries {timeseries_id} not found in campaign {campaign_id}",
        )

    # Delete the timeseries
    db.delete(ts_item)
    db.flush()

    sync_campaign_timeseries_windows(campaign_id, db)

    db.commit()

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.canvas.layout import rename_window_in_layout
from src.canvas.service import sync_main_layouts
from src.timeseries.fetch import fetch_index_series
from src.timeseries.indices import index_for
from src.timeseries.models import Timeseries
from src.timeseries.schemas import TimeseriesCreate
from src.timeseries.sources import source_for
from src.timeseries.windows import (
    distinct_window_keys,
    sync_timeseries_windows_in_layout,
    window_grid_key,
)


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
        db.execute(select(Timeseries.window_name).where(Timeseries.campaign_id == campaign_id))
        .scalars()
        .all()
    )
    desired_keys = distinct_window_keys(window_names)
    sync_main_layouts(
        db, campaign_id, lambda ld: sync_timeseries_windows_in_layout(ld, desired_keys)
    )


def add_timeseries(
    db: Session, campaign_id: int, ts_creates: list[TimeseriesCreate]
) -> list[Timeseries]:
    """Add series to a campaign (uncommitted) and give each window name a canvas window."""
    new_items = [Timeseries(campaign_id=campaign_id, **ts.model_dump()) for ts in ts_creates]
    db.add_all(new_items)
    db.flush()
    sync_campaign_timeseries_windows(campaign_id, db)
    return new_items


def create_timeseries_bulk(
    campaign_id: int, ts_creates: list[TimeseriesCreate], db: Session
) -> list[Timeseries]:
    new_items = add_timeseries(db, campaign_id, ts_creates)
    db.commit()
    return new_items


def rename_timeseries_window(campaign_id: int, old_name: str, new_name: str, db: Session) -> None:
    series = list(
        db.execute(
            select(Timeseries).where(Timeseries.campaign_id == campaign_id).with_for_update()
        )
        .scalars()
        .all()
    )
    old_key, new_key = window_grid_key(old_name), window_grid_key(new_name)
    matching = [item for item in series if window_grid_key(item.window_name) == old_key]
    if not matching:
        raise HTTPException(status_code=404, detail="Timeseries window not found")
    if old_key == new_key:
        return
    if any(window_grid_key(item.window_name) == new_key for item in series):
        raise HTTPException(status_code=409, detail="A window with this name already exists")
    for item in matching:
        item.window_name = new_name
    sync_main_layouts(
        db, campaign_id, lambda layout: rename_window_in_layout(layout, old_key, new_key)
    )
    db.commit()


def get_timeseries_by_id(timeseries_id: int, db: Session) -> Timeseries:
    ts_item = db.execute(
        select(Timeseries).where(Timeseries.id == timeseries_id)
    ).scalar_one_or_none()
    if not ts_item:
        raise HTTPException(status_code=404, detail=f"Timeseries with id {timeseries_id} not found")
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
        select(Timeseries).where(
            Timeseries.id == timeseries_id,
            Timeseries.campaign_id == campaign_id,
        )
    ).scalar_one_or_none()

    if not ts_item:
        raise HTTPException(
            status_code=404,
            detail=f"Timeseries {timeseries_id} not found in campaign {campaign_id}",
        )

    # Delete the timeseries
    db.delete(ts_item)
    db.flush()

    sync_campaign_timeseries_windows(campaign_id, db)

    db.commit()

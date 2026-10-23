import pandas as pd
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.timeseries.fetch import fetch_index_series
from src.timeseries.indices import index_for
from src.timeseries.models import Timeseries, TimeseriesWindow
from src.timeseries.schemas import TimeseriesCreate
from src.timeseries.sources import source_for


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


def add_timeseries(
    db: Session, campaign_id: int, ts_creates: list[TimeseriesCreate]
) -> list[Timeseries]:
    """Add series to a campaign (uncommitted), each into the window it names, which
    is created the first time a series names it."""
    windows = {
        w.name: w
        for w in db.scalars(
            select(TimeseriesWindow).where(TimeseriesWindow.campaign_id == campaign_id)
        )
    }
    new_items = []
    for ts in ts_creates:
        window = windows.get(ts.window_name)
        if window is None:
            window = TimeseriesWindow(
                campaign_id=campaign_id, name=ts.window_name, display_order=len(windows)
            )
            db.add(window)
            windows[ts.window_name] = window
        new_items.append(
            Timeseries(
                campaign_id=campaign_id, window=window, **ts.model_dump(exclude={"window_name"})
            )
        )
    db.add_all(new_items)
    db.flush()
    return new_items


def create_timeseries_bulk(
    campaign_id: int, ts_creates: list[TimeseriesCreate], db: Session
) -> list[Timeseries]:
    new_items = add_timeseries(db, campaign_id, ts_creates)
    db.commit()
    return new_items


def rename_timeseries_window(campaign_id: int, window_id: int, name: str, db: Session) -> None:
    window = db.scalar(
        select(TimeseriesWindow).where(
            TimeseriesWindow.id == window_id, TimeseriesWindow.campaign_id == campaign_id
        )
    )
    if window is None:
        raise HTTPException(status_code=404, detail="Timeseries window not found")
    if window.name == name:
        return
    taken = db.scalar(
        select(TimeseriesWindow.id).where(
            TimeseriesWindow.campaign_id == campaign_id, TimeseriesWindow.name == name
        )
    )
    if taken is not None:
        raise HTTPException(status_code=409, detail="A window with this name already exists")
    window.name = name
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
    Delete a timeseries; a window left without series goes with it.

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

    window = ts_item.window
    db.delete(ts_item)
    db.flush()
    db.refresh(window)
    if not window.series:
        db.delete(window)
    db.commit()

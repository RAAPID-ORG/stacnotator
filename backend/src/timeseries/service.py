from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from src.timeseries.indices import SpectralIndex, index_for
from src.timeseries.models import CustomIndex, Timeseries, TimeseriesWindow
from src.timeseries.schemas import MAX_CUSTOM_INDICES, CustomIndexIn, TimeseriesCreate
from src.timeseries.sources import TimeseriesSource, offers, source_for


def series_definition(timeseries: Timeseries) -> tuple[TimeseriesSource, SpectralIndex]:
    """A stored series' source and index. Raises ValueError if the stored
    combination is no longer one we can compute."""
    source = source_for(timeseries.data_source)
    if source is None:
        raise ValueError(f"Unsupported data source: {timeseries.data_source}")
    index = timeseries.spectral_index
    if index is None:
        raise ValueError(f"Unknown index: {timeseries.ts_type}")
    if not offers(source, index):
        raise ValueError(f"{source.label} does not carry the bands {index.label} needs")
    return source, index


def _series_index(source_key: str, ts_type: str, custom: dict[str, SpectralIndex]) -> SpectralIndex:
    """The index a new series plots, refused when its source lacks the bands. Catching
    this on save means a series can never fail every time an annotator opens it."""
    index = index_for(ts_type) or custom.get(ts_type)
    if index is None:
        raise HTTPException(status_code=422, detail=f"Unknown index: {ts_type}")
    source = source_for(source_key)
    if source is None or not offers(source, index):
        raise HTTPException(
            status_code=422, detail=f"{source_key} does not carry the bands {index.label} needs"
        )
    return index


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
    # Locked so a rename or delete of an index waits until these series are
    # committed, and then sees them.
    custom = {
        row.name: row.spectral_index
        for row in db.scalars(
            select(CustomIndex).where(CustomIndex.campaign_id == campaign_id).with_for_update()
        )
    }
    new_items = []
    for ts in ts_creates:
        _series_index(ts.data_source, ts.ts_type, custom)
        window = windows.get(ts.window_name)
        if window is None:
            window = TimeseriesWindow(campaign_id=campaign_id, name=ts.window_name)
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


# ============================================================================
# Custom indices
# ============================================================================


def _custom_index_row(db: Session, campaign_id: int, name: str) -> CustomIndex:
    row = db.scalar(
        select(CustomIndex)
        .where(CustomIndex.campaign_id == campaign_id, CustomIndex.name == name)
        .with_for_update()
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"Custom index {name} not found")
    return row


def add_custom_indices(db: Session, campaign_id: int, items: list[CustomIndexIn]) -> None:
    """Add indices to a campaign (uncommitted), refusing a name it already uses."""
    taken = set(db.scalars(select(CustomIndex.name).where(CustomIndex.campaign_id == campaign_id)))
    if len(taken) + len(items) > MAX_CUSTOM_INDICES:
        raise HTTPException(
            status_code=422, detail=f"A campaign has at most {MAX_CUSTOM_INDICES} custom indices"
        )
    for item in items:
        if item.name in taken:
            raise HTTPException(status_code=409, detail=f"{item.name} already exists")
        taken.add(item.name)
        db.add(CustomIndex(campaign_id=campaign_id, **item.model_dump()))
    db.flush()


def create_custom_index(db: Session, campaign_id: int, item: CustomIndexIn) -> CustomIndex:
    add_custom_indices(db, campaign_id, [item])
    db.commit()
    return _custom_index_row(db, campaign_id, item.name)


def update_custom_index(
    db: Session, campaign_id: int, name: str, item: CustomIndexIn
) -> CustomIndex:
    """Change an index in place. Its series follow a rename, and an edit that
    reads a band one of their sources lacks is refused."""
    row = _custom_index_row(db, campaign_id, name)
    if item.name != name and db.scalar(
        select(CustomIndex.id).where(
            CustomIndex.campaign_id == campaign_id, CustomIndex.name == item.name
        )
    ):
        raise HTTPException(status_code=409, detail=f"{item.name} already exists")

    series = db.scalars(
        select(Timeseries).where(Timeseries.campaign_id == campaign_id, Timeseries.ts_type == name)
    ).all()
    edited = item.spectral_index
    for ts in series:
        _series_index(ts.data_source, item.name, {item.name: edited})

    for field, value in item.model_dump().items():
        setattr(row, field, value)
    db.execute(
        update(Timeseries)
        .where(Timeseries.campaign_id == campaign_id, Timeseries.ts_type == name)
        .values(ts_type=item.name)
    )
    db.commit()
    return row


def delete_custom_index(db: Session, campaign_id: int, name: str) -> None:
    row = _custom_index_row(db, campaign_id, name)
    in_use = db.scalar(
        select(Timeseries.name).where(
            Timeseries.campaign_id == campaign_id, Timeseries.ts_type == name
        )
    )
    if in_use is not None:
        raise HTTPException(
            status_code=409, detail=f"{name} is plotted by the series {in_use}; remove it first"
        )
    db.delete(row)
    db.commit()

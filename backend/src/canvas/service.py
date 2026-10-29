"""DB-bound canvas layout operations: creating the default layouts and saving the
ones people arrange. Nothing else writes a layout - which windows exist follows from
the campaign, so adding imagery or a time series never has to touch one.
"""

from copy import deepcopy
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.canvas.layout import DEFAULT_MAIN_CANVAS_LAYOUT
from src.canvas.models import CanvasLayout
from src.canvas.schemas import CanvasLayoutCreate
from src.imagery.models import ImageryView


def new_default_main_layout(campaign_id: int) -> CanvasLayout:
    """The campaign's shared main layout, seeded with the page chrome."""
    return CanvasLayout(
        layout_data=deepcopy(DEFAULT_MAIN_CANVAS_LAYOUT),
        user_id=None,
        campaign_id=campaign_id,
        view_id=None,
        is_default=True,
    )


def new_default_view_layout(campaign_id: int, view_id: int) -> CanvasLayout:
    """A view's shared layout. It starts empty: every window of the view is shown and
    the client places them until an admin saves where they go."""
    return CanvasLayout(
        layout_data=[], user_id=None, campaign_id=campaign_id, view_id=view_id, is_default=True
    )


def _find_layout(
    db: Session, campaign_id: int, view_id: int | None, user_id: UUID | None
) -> CanvasLayout | None:
    """``user_id=None`` finds the shared default layout, else the user's personal copy."""
    query = select(CanvasLayout).where(
        CanvasLayout.campaign_id == campaign_id,
        CanvasLayout.view_id == view_id if view_id is not None else CanvasLayout.view_id.is_(None),
    )
    if user_id is None:
        query = query.where(CanvasLayout.is_default, CanvasLayout.user_id.is_(None))
    else:
        query = query.where(CanvasLayout.user_id == user_id)
    return db.execute(query).scalar_one_or_none()


def _set_items(layout: CanvasLayout, items: list[dict], hidden: list[str]) -> None:
    layout.layout_data = items
    layout.hidden = hidden


def _update_default_layout(
    db: Session,
    campaign_id: int,
    view_id: int | None,
    items: list[dict],
    hidden: list[str],
    not_found: str,
) -> CanvasLayout:
    layout = _find_layout(db, campaign_id, view_id, user_id=None)
    if not layout:
        raise HTTPException(status_code=404, detail=not_found)
    _set_items(layout, items, hidden)
    return layout


def _upsert_personal_layout(
    db: Session,
    campaign_id: int,
    view_id: int | None,
    user_id: UUID,
    items: list[dict],
    hidden: list[str],
) -> CanvasLayout:
    layout = _find_layout(db, campaign_id, view_id, user_id)
    if layout is None:
        layout = CanvasLayout(
            user_id=user_id, campaign_id=campaign_id, view_id=view_id, is_default=False
        )
        db.add(layout)
    _set_items(layout, items, hidden)
    return layout


def save_canvas_layouts(
    db: Session,
    campaign_id: int,
    layout_data: CanvasLayoutCreate,
    user_id: UUID,
    view_id: int | None = None,
    should_be_default: bool = False,
) -> dict:
    """Create or update the caller's (or the campaign default) canvas layouts.

    Callers must have already checked campaign access and, when
    ``should_be_default`` is set, campaign-admin authorization.
    """

    if view_id is not None:
        view = db.execute(
            select(ImageryView).where(
                ImageryView.id == view_id, ImageryView.campaign_id == campaign_id
            )
        ).scalar_one_or_none()
        if not view:
            raise HTTPException(
                status_code=404, detail=f"View {view_id} not found in campaign {campaign_id}"
            )

    main_items = [item.model_dump(exclude_none=True) for item in layout_data.main_layout_data]
    view_items = (
        [item.model_dump(exclude_none=True) for item in layout_data.view_layout_data]
        if layout_data.view_layout_data is not None
        else None
    )
    if view_items is not None and view_id is None:
        raise HTTPException(
            status_code=400,
            detail="view_id is required when providing view_layout_data",
        )

    result = {}

    if should_be_default:
        result["main_layout"] = _update_default_layout(
            db,
            campaign_id,
            None,
            main_items,
            [],
            f"Default main canvas layout not found for campaign {campaign_id}",
        )
        if view_items is not None:
            result["view_layout"] = _update_default_layout(
                db,
                campaign_id,
                view_id,
                view_items,
                layout_data.view_hidden,
                f"Default canvas layout not found for view {view_id}",
            )
    else:
        result["main_layout"] = _upsert_personal_layout(
            db, campaign_id, None, user_id, main_items, []
        )
        if view_items is not None:
            result["view_layout"] = _upsert_personal_layout(
                db, campaign_id, view_id, user_id, view_items, layout_data.view_hidden
            )

    db.commit()

    db.refresh(result["main_layout"])
    if "view_layout" in result:
        db.refresh(result["view_layout"])

    return result

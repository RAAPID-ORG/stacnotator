"""DB-bound canvas layout operations.

The canvas module owns every read and write of ``CanvasLayout.layout_data``;
domains contribute window keys (timeseries window names, imagery collection
ids) and never touch layout dicts themselves.
"""

from collections.abc import Callable
from copy import deepcopy
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from src.campaigns.models import Campaign, CampaignUser
from src.canvas.layout import (
    DEFAULT_MAIN_CANVAS_LAYOUT,
    VIEW_LAYOUT_START_Y,
    VIEW_WINDOW_H,
    VIEW_WINDOW_W,
    layout_bottom,
    packed_layout,
    reconcile_layout,
)
from src.canvas.models import CanvasLayout
from src.canvas.schemas import CanvasLayoutCreate
from src.imagery.models import ImageryView


def new_default_main_layout(campaign_id: int) -> CanvasLayout:
    """The campaign's shared main layout, seeded with the page chrome."""
    return CanvasLayout(
        # Copy the template so later window syncs never mutate the shared constant.
        layout_data=deepcopy(DEFAULT_MAIN_CANVAS_LAYOUT),
        user_id=None,
        campaign_id=campaign_id,
        view_id=None,
        is_default=True,
    )


def new_default_view_layout(
    campaign_id: int, view_id: int, window_collection_ids: list[int]
) -> CanvasLayout:
    """A view's shared layout: its windows packed in rows below the main canvas.

    Gaps are kept on later edits so user customizations survive collection
    changes (see sync_view_layouts).
    """
    return CanvasLayout(
        layout_data=packed_layout(
            [str(cid) for cid in window_collection_ids],
            item_width=VIEW_WINDOW_W,
            item_height=VIEW_WINDOW_H,
            min_y=VIEW_LAYOUT_START_Y,
        ),
        user_id=None,
        campaign_id=campaign_id,
        view_id=view_id,
        is_default=True,
    )


def sync_main_layouts(db: Session, campaign_id: int, sync: Callable[[list[dict]], bool]) -> None:
    """Apply an in-place layout sync to every main layout of a campaign.

    Main layouts have ``view_id = None`` - the campaign default and each user's
    personal copy. ``sync`` returns whether it changed the list.
    """
    main_layouts = (
        db.execute(
            select(CanvasLayout).where(
                CanvasLayout.campaign_id == campaign_id,
                CanvasLayout.view_id.is_(None),
            )
        )
        .scalars()
        .all()
    )
    for layout in main_layouts:
        if sync(layout.layout_data):
            flag_modified(layout, "layout_data")


def sync_view_layouts(
    db: Session,
    view_id: int,
    campaign_id: int,
    window_collection_ids: set[int],
    added_collection_ids: list[int],
) -> None:
    """Reconcile every canvas_layout for a view against its current windows.

    ``window_collection_ids`` is the full set of collections currently shown as
    windows in the view. Any layout item for a collection outside that set is
    dropped - this is what removes the slots of deleted collections (or ones
    toggled off), so they no longer reserve grid space or push new windows below
    a source that no longer exists.

    Only ``added_collection_ids`` (freshly-added windows) are placed, not the
    full window set, so a window a user has personally hidden - present in the
    view but absent from their layout - stays hidden.
    """
    keep = {str(cid) for cid in window_collection_ids}

    # The page chrome (main map / controls / minimap / timeseries) lives in the
    # view_id=NULL "main" layout and shares the same grid as the windows on the
    # client. New windows must clear it, so index each user's chrome bottom (with
    # the campaign default as the fallback for users without a personal main).
    main_layouts = (
        db.execute(
            select(CanvasLayout).where(
                CanvasLayout.campaign_id == campaign_id,
                CanvasLayout.view_id.is_(None),
            )
        )
        .scalars()
        .all()
    )
    chrome_bottom_by_user = {ml.user_id: layout_bottom(ml.layout_data) for ml in main_layouts}
    default_chrome_bottom = chrome_bottom_by_user.get(None, VIEW_LAYOUT_START_Y)

    layouts = (
        db.execute(select(CanvasLayout).where(CanvasLayout.view_id == view_id)).scalars().all()
    )
    for layout in layouts:
        chrome_bottom = chrome_bottom_by_user.get(layout.user_id, default_chrome_bottom)
        changed = reconcile_layout(
            layout.layout_data,
            managed=lambda _: True,
            keep=keep,
            add=[str(cid) for cid in added_collection_ids],
            item_width=VIEW_WINDOW_W,
            item_height=VIEW_WINDOW_H,
            min_y=chrome_bottom,
        )
        if changed:
            flag_modified(layout, "layout_data")


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


def _set_items(layout: CanvasLayout, items: list[dict]) -> None:
    layout.layout_data = items
    flag_modified(layout, "layout_data")


def _update_default_layout(
    db: Session, campaign_id: int, view_id: int | None, items: list[dict], not_found: str
) -> CanvasLayout:
    layout = _find_layout(db, campaign_id, view_id, user_id=None)
    if not layout:
        raise HTTPException(status_code=404, detail=not_found)
    _set_items(layout, items)
    return layout


def _upsert_personal_layout(
    db: Session, campaign_id: int, view_id: int | None, user_id: UUID, items: list[dict]
) -> CanvasLayout:
    layout = _find_layout(db, campaign_id, view_id, user_id)
    if layout:
        _set_items(layout, items)
    else:
        layout = CanvasLayout(
            user_id=user_id,
            campaign_id=campaign_id,
            view_id=view_id,
            layout_data=items,
            is_default=False,
        )
        db.add(layout)
    return layout


def save_canvas_layouts(
    db: Session,
    campaign_id: int,
    layout_data: CanvasLayoutCreate,
    user_id: UUID,
    view_id: int | None = None,
    should_be_default: bool = False,
) -> dict:
    """Create or update the caller's (or the campaign default) canvas layouts."""

    campaign = db.execute(select(Campaign).where(Campaign.id == campaign_id)).scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail=f"Campaign {campaign_id} not found")

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

    if should_be_default:
        has_admin_access = db.execute(
            select(CampaignUser).where(
                CampaignUser.campaign_id == campaign_id,
                CampaignUser.user_id == user_id,
                CampaignUser.is_admin,
            )
        ).scalar_one_or_none()
        if not has_admin_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only campaign admins can modify default layouts",
            )

    main_items = [item.model_dump() for item in layout_data.main_layout_data]
    view_items = (
        [item.model_dump() for item in layout_data.view_layout_data]
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
            f"Default main canvas layout not found for campaign {campaign_id}",
        )
        if view_items is not None:
            result["view_layout"] = _update_default_layout(
                db,
                campaign_id,
                view_id,
                view_items,
                f"Default canvas layout not found for view {view_id}",
            )
    else:
        result["main_layout"] = _upsert_personal_layout(db, campaign_id, None, user_id, main_items)
        if view_items is not None:
            result["view_layout"] = _upsert_personal_layout(
                db, campaign_id, view_id, user_id, view_items
            )

    db.commit()

    db.refresh(result["main_layout"])
    if "view_layout" in result:
        db.refresh(result["view_layout"])

    return result

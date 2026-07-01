from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from src.campaigns.constants import (
    VIEW_LAYOUT_COLS_PER_ROW,
    VIEW_LAYOUT_START_Y,
    VIEW_LAYOUT_WINDOW_H,
    VIEW_LAYOUT_WINDOW_W,
)
from src.campaigns.models import Campaign, CampaignUser, CanvasLayout
from src.imagery.models import ImageryView
from src.imagery.schemas import CanvasLayoutCreate


def _layout_window_for(slot: int, base_y: int) -> dict:
    """Return a layout item dict for a given linear slot (0-indexed) and base y."""
    return {
        "x": (slot % VIEW_LAYOUT_COLS_PER_ROW) * VIEW_LAYOUT_WINDOW_W,
        "y": base_y + (slot // VIEW_LAYOUT_COLS_PER_ROW) * VIEW_LAYOUT_WINDOW_H,
        "w": VIEW_LAYOUT_WINDOW_W,
        "h": VIEW_LAYOUT_WINDOW_H,
    }


def _layout_bottom(layout_data: list | None) -> int:
    """Lowest occupied grid row (max y+h) across the items, 0 when empty."""
    return max(
        (int(it.get("y", 0)) + int(it.get("h", 0)) for it in (layout_data or [])),
        default=0,
    )


def _sync_view_layouts(
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
    a source that no longer exists. Items kept hold their positions (gaps are
    fine for react-grid-layout).

    ``added_collection_ids`` are freshly-added windows; they're appended below
    everything already on the grid. We only append the *new* ones (not the full
    window set) so a window a user has personally hidden - present in the view
    but absent from their layout - stays hidden.
    """
    valid = {str(cid) for cid in window_collection_ids}

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
    chrome_bottom_by_user = {ml.user_id: _layout_bottom(ml.layout_data) for ml in main_layouts}
    default_chrome_bottom = chrome_bottom_by_user.get(None, VIEW_LAYOUT_START_Y)

    layouts = (
        db.execute(select(CanvasLayout).where(CanvasLayout.view_id == view_id)).scalars().all()
    )
    for layout in layouts:
        original = layout.layout_data or []
        items = [it for it in original if it.get("i") in valid]
        present = {it.get("i") for it in items}
        to_add = [cid for cid in added_collection_ids if str(cid) not in present]
        if to_add:
            chrome_bottom = chrome_bottom_by_user.get(layout.user_id, default_chrome_bottom)
            # Stack new windows below both the kept windows and the page chrome,
            # so they never overlap an existing item in the merged grid.
            base_y = max(
                max(
                    (int(it.get("y", 0)) + int(it.get("h", 0)) for it in items),
                    default=VIEW_LAYOUT_START_Y,
                ),
                chrome_bottom,
            )
            for offset, cid in enumerate(to_add):
                items.append({"i": str(cid), **_layout_window_for(offset, base_y)})
        if items != original:
            layout.layout_data = items
            flag_modified(layout, "layout_data")


def create_new_canvas_layout(
    db: Session,
    campaign_id: int,
    layout_data: CanvasLayoutCreate,
    user_id: UUID,
    view_id: int | None = None,
    should_be_default: bool = False,
) -> dict:
    """Create or update canvas layouts for a view."""

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

    result = {}

    if should_be_default:
        existing_main_layout = db.execute(
            select(CanvasLayout).where(
                CanvasLayout.campaign_id == campaign_id,
                CanvasLayout.view_id.is_(None),
                CanvasLayout.is_default,
                CanvasLayout.user_id.is_(None),
            )
        ).scalar_one_or_none()
        if not existing_main_layout:
            raise HTTPException(
                status_code=404,
                detail=f"Default main canvas layout not found for campaign {campaign_id}",
            )

        existing_main_layout.layout_data = layout_data.main_layout_data
        flag_modified(existing_main_layout, "layout_data")
        result["main_layout"] = existing_main_layout

        if layout_data.view_layout_data is not None:
            if view_id is None:
                raise HTTPException(
                    status_code=400,
                    detail="view_id is required when providing view_layout_data",
                )

            existing_view_layout = db.execute(
                select(CanvasLayout).where(
                    CanvasLayout.campaign_id == campaign_id,
                    CanvasLayout.view_id == view_id,
                    CanvasLayout.is_default,
                    CanvasLayout.user_id.is_(None),
                )
            ).scalar_one_or_none()
            if not existing_view_layout:
                raise HTTPException(
                    status_code=404,
                    detail=f"Default canvas layout not found for view {view_id}",
                )

            existing_view_layout.layout_data = layout_data.view_layout_data
            flag_modified(existing_view_layout, "layout_data")
            result["view_layout"] = existing_view_layout
    else:
        main_layout = db.execute(
            select(CanvasLayout).where(
                CanvasLayout.user_id == user_id,
                CanvasLayout.campaign_id == campaign_id,
                CanvasLayout.view_id.is_(None),
            )
        ).scalar_one_or_none()

        if main_layout:
            main_layout.layout_data = layout_data.main_layout_data
            flag_modified(main_layout, "layout_data")
        else:
            main_layout = CanvasLayout(
                user_id=user_id,
                campaign_id=campaign_id,
                view_id=None,
                layout_data=layout_data.main_layout_data,
                is_default=False,
            )
            db.add(main_layout)

        result["main_layout"] = main_layout

        if layout_data.view_layout_data is not None:
            if view_id is None:
                raise HTTPException(
                    status_code=400,
                    detail="view_id is required when providing view_layout_data",
                )

            view_layout = db.execute(
                select(CanvasLayout).where(
                    CanvasLayout.user_id == user_id,
                    CanvasLayout.campaign_id == campaign_id,
                    CanvasLayout.view_id == view_id,
                )
            ).scalar_one_or_none()

            if view_layout:
                view_layout.layout_data = layout_data.view_layout_data
                flag_modified(view_layout, "layout_data")
            else:
                view_layout = CanvasLayout(
                    user_id=user_id,
                    campaign_id=campaign_id,
                    view_id=view_id,
                    layout_data=layout_data.view_layout_data,
                    is_default=False,
                )
                db.add(view_layout)

            result["view_layout"] = view_layout

    db.commit()

    if "main_layout" in result:
        db.refresh(result["main_layout"])
    if "view_layout" in result:
        db.refresh(result["view_layout"])

    return result

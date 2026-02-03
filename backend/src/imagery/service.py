from datetime import datetime, timedelta
import json
from typing import List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from src.campaigns.constants import CAMPAIGN_ROLE_ADMIN
from src.campaigns.models import Campaign, CampaignUser, CanvasLayout
from src.imagery.models import Imagery, ImageryVisualizationUrlTemplate, ImageryWindow
from src.imagery.schemas import CanvasLayoutCreate, ImageryCreate
from src.utils import find_free_position_in_layout, format_date_to_yyyymmdd, parse_ym_to_date
from dateutil.relativedelta import relativedelta
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.orm import Session


# ============================================================================
# Canvas Layout Management
# ============================================================================


def add_windows_to_canvas_layout(
    layout_data: List[dict],
    windows: List[ImageryWindow],
    window_width: int = 10,
    window_height: int = 8,
    grid_width: int = 60,
) -> None:
    """
    Add imagery windows to canvas layout using 2D bin packing.

    Places windows in available spaces, creating new rows as needed.
    All windows have fixed dimensions (10x8 by default).
    Canvas is scrollable so there is no height limit.

    Args:
        layout_data: Existing layout data to append to (modified in place)
        windows: List of ImageryWindow objects to add
        window_width: Width of each window in grid units
        window_height: Height of each window in grid units
        grid_width: Total grid width available
    """
    if not windows:
        return

    # Place each window
    for window in windows:
        x, y = find_free_position_in_layout(
            layout_data=layout_data,
            item_width=window_width,
            item_height=window_height,
            grid_width=grid_width,
        )

        # Add to layout
        layout_entry = {
            "i": f"{window.id}",
            "x": x,
            "y": y,
            "w": window_width,
            "h": window_height,
        }
        layout_data.append(layout_entry)


# ============================================================================
# Imagery Creation
# ============================================================================


def _build_windows(imagery: Imagery) -> List[ImageryWindow]:
    """
    Build temporal windows based on imagery date range and interval settings.

    If no window interval is configured, creates a single window for the entire
    date range. Otherwise, subdivides the range according to the interval unit
    (days, months, or years).

    Args:
        imagery: Imagery object with date range and windowing configuration

    Returns:
        List of ImageryWindow objects covering the full date range
    """
    start_date = parse_ym_to_date(imagery.start_ym)
    end_date = parse_ym_to_date(imagery.end_ym)

    # Extend end_date to include the entire last month
    if end_date.month == 12:
        end_date = datetime(end_date.year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = datetime(end_date.year, end_date.month + 1, 1) - timedelta(days=1)

    windows = []

    if imagery.window_interval is None or imagery.window_unit is None:
        # No windowing - single window for entire range
        window = ImageryWindow(
            imagery_id=imagery.id,
            window_start_date=format_date_to_yyyymmdd(start_date),
            window_end_date=format_date_to_yyyymmdd(end_date),
            window_index=0,
        )
        windows.append(window)
    else:
        # Create windows based on interval and unit
        current_start = start_date
        window_index = 0

        while current_start <= end_date:
            # Calculate end of current window
            if imagery.window_unit == "days":
                current_end = (
                    current_start + timedelta(days=imagery.window_interval) - timedelta(days=1)
                )
            elif imagery.window_unit == "months":
                current_end = (
                    current_start
                    + relativedelta(months=imagery.window_interval)
                    - timedelta(days=1)
                )
            elif imagery.window_unit == "years":
                current_end = (
                    current_start + relativedelta(years=imagery.window_interval) - timedelta(days=1)
                )
            else:
                raise HTTPException(
                    status_code=422, detail=f"Invalid window_unit: {imagery.window_unit}"
                )

            # Don't exceed the end date
            if current_end > end_date:
                current_end = end_date

            window = ImageryWindow(
                imagery_id=imagery.id,
                window_start_date=format_date_to_yyyymmdd(current_start),
                window_end_date=format_date_to_yyyymmdd(current_end),
                window_index=window_index,
            )
            windows.append(window)
            window_index += 1

            # Move to next window
            if imagery.window_unit == "days":
                current_start = current_start + timedelta(days=imagery.window_interval)
            elif imagery.window_unit == "months":
                current_start = current_start + relativedelta(months=imagery.window_interval)
            elif imagery.window_unit == "years":
                current_start = current_start + relativedelta(years=imagery.window_interval)

            if current_start > end_date:
                break

    return windows


def _build_imagery_from_schema(
    imagery_schema: ImageryCreate,
    campaign_id: int,
) -> Imagery:
    """Convert ImageryCreate schema to Imagery model with visualization templates."""
    # Prepare imagery data
    imagery_data = imagery_schema.model_dump(exclude={"visualization_url_templates"})
    imagery_data["search_body"] = json.loads(imagery_schema.search_body)

    # Create imagery object
    imagery = Imagery(
        campaign_id=campaign_id,
        **imagery_data,
    )

    # Add visualization templates
    for template_data in imagery_schema.visualization_url_templates:
        template = ImageryVisualizationUrlTemplate(
            name=template_data.name,
            visualization_url=template_data.visualization_url,
        )
        imagery.visualization_url_templates.append(template)

    return imagery


def create_imagery_with_layouts_bulk_no_commit(
    db: Session,
    *,
    campaign: Campaign,
    imagery_items: List[ImageryCreate],
) -> List[Imagery]:
    """
    Create multiple imagery objects with canvas layouts and temporal windows.
    NOT COMMITING!

    Args:
        db: Database session
        campaign: Parent campaign
        imagery_items: List of imagery configurations (typically 2-7 items)

    Returns:
        List of created Imagery objects with all relationships loaded

    Raises:
        ValueError: If campaign settings are not found
    """
    if not campaign.settings:
        raise HTTPException(
            status_code=404, detail=f"Campaign settings not found for campaign {campaign.id}"
        )

    imagery_objects = []

    for imagery_item in imagery_items:
        # Create imagery object
        imagery = _build_imagery_from_schema(
            imagery_schema=imagery_item,
            campaign_id=campaign.id,
        )
        db.add(imagery)
        db.flush()

        # Create default canvas layout for this imagery
        canvas_layout = CanvasLayout(
            layout_data=[],
            user_id=None,
            campaign_id=campaign.id,
            imagery_id=imagery.id,
            is_default=True,  # Mark as default for this imagery
        )
        db.add(canvas_layout)

        # Create windows
        windows = _build_windows(imagery)
        for window in windows:
            db.add(window)
        db.flush()  # Flush to assign IDs to windows

        # Set default main window to the middle window
        if windows:
            middle_index = len(windows) // 2
            imagery.default_main_window_id = windows[middle_index].id
            db.flush()  # Flush to persist the default_main_window_id

        # Update layout with window positions (needed to wait for window to be created with ids)
        add_windows_to_canvas_layout(
            layout_data=canvas_layout.layout_data,
            windows=imagery.windows,
        )
        flag_modified(canvas_layout, "layout_data")

        # Refresh to load all relationships
        db.refresh(imagery)
        imagery_objects.append(imagery)

    return imagery_objects


def create_new_canvas_layout(
    db: Session,
    campaign_id: int,
    layout_data: CanvasLayoutCreate,
    user_id: UUID,
    imagery_id: Optional[int] = None,
    should_be_default: bool = False,
) -> dict:
    """
    Create or update canvas layouts for imagery visualization.

    Handles both main layout (main window + timeseries + minimap) and
    imagery-specific layouts. Can create default layouts (campaign-wide)
    or personal user layouts.
    """

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail=f"Campaign {campaign_id} not found")

    imagery = None
    if imagery_id is not None:
        imagery = (
            db.query(Imagery)
            .filter(
                Imagery.id == imagery_id,
                Imagery.campaign_id == campaign_id,
            )
            .first()
        )
        if not imagery:
            raise HTTPException(
                status_code=404, detail=f"Imagery {imagery_id} not found in campaign {campaign_id}"
            )

    # If creating default layout, verify user is campaign admin
    if should_be_default:
        has_admin_access = (
            db.query(CampaignUser)
            .filter(
                CampaignUser.campaign_id == campaign_id,
                CampaignUser.user_id == user_id,
                CampaignUser.role == CAMPAIGN_ROLE_ADMIN,
            )
            .first()
        )

        if not has_admin_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only campaign admins can modify default layouts",
            )

    result = {}

    if should_be_default:
        # Update default layouts (campaign-wide, user_id = None, is_default = True)

        # Update main campaign layout
        existing_main_layout = (
            db.query(CanvasLayout)
            .filter(
                CanvasLayout.campaign_id == campaign_id,
                CanvasLayout.imagery_id.is_(None),
                CanvasLayout.is_default,
                CanvasLayout.user_id.is_(None),
            )
            .first()
        )

        if not existing_main_layout:
            raise HTTPException(
                status_code=404,
                detail=f"Default main canvas layout not found for campaign {campaign_id}",
            )

        existing_main_layout.layout_data = layout_data.main_layout_data
        flag_modified(existing_main_layout, "layout_data")
        result["main_layout"] = existing_main_layout

        # Update imagery-specific layout if provided
        if layout_data.imagery_layout_data is not None:
            if imagery_id is None:
                raise HTTPException(
                    status_code=400,
                    detail="imagery_id is required when providing imagery_layout_data",
                )

            existing_imagery_layout = (
                db.query(CanvasLayout)
                .filter(
                    CanvasLayout.campaign_id == campaign_id,
                    CanvasLayout.imagery_id == imagery_id,
                    CanvasLayout.is_default,
                    CanvasLayout.user_id.is_(None),
                )
                .first()
            )

            if not existing_imagery_layout:
                raise HTTPException(
                    status_code=404,
                    detail=f"Default canvas layout not found for imagery {imagery_id}",
                )

            existing_imagery_layout.layout_data = layout_data.imagery_layout_data
            flag_modified(existing_imagery_layout, "layout_data")
            result["imagery_layout"] = existing_imagery_layout

    else:
        # Create/update personal layouts for the user (is_default = False)

        # Handle main personal layout (campaign-level)
        main_layout = (
            db.query(CanvasLayout)
            .filter(
                CanvasLayout.user_id == user_id,
                CanvasLayout.campaign_id == campaign_id,
                CanvasLayout.imagery_id.is_(None),
            )
            .first()
        )

        if main_layout:
            # Update existing personal main layout
            main_layout.layout_data = layout_data.main_layout_data
            flag_modified(main_layout, "layout_data")
        else:
            # Create new personal main layout
            main_layout = CanvasLayout(
                user_id=user_id,
                campaign_id=campaign_id,
                imagery_id=None,
                layout_data=layout_data.main_layout_data,
                is_default=False,
            )
            db.add(main_layout)

        result["main_layout"] = main_layout

        # Handle imagery-specific personal layout if provided
        if layout_data.imagery_layout_data is not None:
            if imagery_id is None:
                raise HTTPException(
                    status_code=400,
                    detail="imagery_id is required when providing imagery_layout_data",
                )

            imagery_layout = (
                db.query(CanvasLayout)
                .filter(
                    CanvasLayout.user_id == user_id,
                    CanvasLayout.campaign_id == campaign_id,
                    CanvasLayout.imagery_id == imagery_id,
                )
                .first()
            )

            if imagery_layout:
                # Update existing personal imagery layout
                imagery_layout.layout_data = layout_data.imagery_layout_data
                flag_modified(imagery_layout, "layout_data")
            else:
                # Create new personal imagery layout
                imagery_layout = CanvasLayout(
                    user_id=user_id,
                    campaign_id=campaign_id,
                    imagery_id=imagery_id,
                    layout_data=layout_data.imagery_layout_data,
                    is_default=False,
                )
                db.add(imagery_layout)

            result["imagery_layout"] = imagery_layout

    db.commit()

    # Refresh to load all relationships
    if "main_layout" in result:
        db.refresh(result["main_layout"])
    if "imagery_layout" in result:
        db.refresh(result["imagery_layout"])

    return result


def delete_imagery(
    db: Session,
    imagery_id: int,
    campaign_id: int,
) -> None:
    """
    Delete an imagery entry and all associated data.
    """
    imagery = (
        db.query(Imagery)
        .filter(
            Imagery.id == imagery_id,
            Imagery.campaign_id == campaign_id,
        )
        .first()
    )

    if not imagery:
        raise HTTPException(
            status_code=404, detail=f"Imagery {imagery_id} not found in campaign {campaign_id}"
        )

    db.delete(imagery)
    db.commit()


def update_imagery(
    db: Session,
    imagery_id: int,
    campaign_id: int,
    updates: dict,
) -> Imagery:
    """
    Update an imagery entry with new values.
    Excludes temporal fields (start_ym, end_ym, window_*, slicing_*) which cannot be changed.
    """
    imagery = (
        db.query(Imagery)
        .filter(
            Imagery.id == imagery_id,
            Imagery.campaign_id == campaign_id,
        )
        .first()
    )

    if not imagery:
        raise HTTPException(
            status_code=404, detail=f"Imagery {imagery_id} not found in campaign {campaign_id}"
        )

    # Update visualization templates if provided
    if "visualization_url_templates" in updates and updates["visualization_url_templates"] is not None:
        # Delete existing templates
        db.query(ImageryVisualizationUrlTemplate).filter(
            ImageryVisualizationUrlTemplate.imagery_id == imagery_id
        ).delete()
        
        # Create new templates
        for template_data in updates["visualization_url_templates"]:
            template = ImageryVisualizationUrlTemplate(
                imagery_id=imagery_id,
                name=template_data.get("name", ""),
                visualization_url=template_data.get("visualization_url", ""),
            )
            db.add(template)
        
        # Remove from updates dict as we've handled it
        del updates["visualization_url_templates"]

    # Parse search_body if it's a JSON string
    if "search_body" in updates and updates["search_body"] is not None:
        if isinstance(updates["search_body"], str):
            updates["search_body"] = json.loads(updates["search_body"])

    # Update other fields
    for key, value in updates.items():
        if value is not None and hasattr(imagery, key):
            setattr(imagery, key, value)

    db.commit()
    db.refresh(imagery)

    return imagery

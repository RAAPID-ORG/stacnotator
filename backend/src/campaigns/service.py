from typing import List, Optional
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.orm.attributes import flag_modified

from fastapi import HTTPException
from sqlalchemy.orm import Session

from src.auth.models import User
from src.campaigns.constants import (
    CAMPAIGN_ROLE_ADMIN,
    CAMPAIGN_ROLE_MEMBER,
    DEFAULT_CAMPAIGN_MAIN_CANVAS_LAYOUT,
)
from src.campaigns.models import (
    Campaign,
    CampaignSettings,
    CampaignUser,
    CanvasLayout,
)
from src.campaigns.schemas import CampaignSettingsCreate
from sqlalchemy.orm import joinedload
from src.imagery.models import Imagery
from src.annotation.models import AnnotationTaskItem
from src.imagery.service import create_imagery_with_layouts_bulk_no_commit
from src.timeseries.service import _add_timeseries_entry_to_layout
from src.timeseries.models import TimeSeries


# ============================================================================
# Campaign Management
# ============================================================================


def list_campaigns_with_user_roles(db: Session, user_id: int) -> List[dict]:
    """
    Retrieve all campaigns with user role information.

    Returns list of dicts containing campaign data plus is_admin/is_member flags.
    """
    stmt = select(Campaign).options(joinedload(Campaign.users)).order_by(Campaign.created_at.desc())
    campaigns = db.scalars(stmt).unique().all()

    is_global_admin = select(User).where(User.id == user_id, User.is_admin == True)
    if db.scalars(is_global_admin).first():
        # If user is global admin, they are admin of all campaigns
        results = []
        for campaign in campaigns:
            results.append(
                {
                    "campaign": campaign,
                    "is_admin": True,
                    "is_member": True,
                }
            )
        return results

    results = []
    for campaign in campaigns:
        is_admin = False
        is_member = False

        for campaign_user in campaign.users:
            if campaign_user.user_id == user_id:
                is_member = True
                if campaign_user.role == CAMPAIGN_ROLE_ADMIN:
                    is_admin = True
                break

        results.append(
            {
                "campaign": campaign,
                "is_admin": is_admin,
                "is_member": is_member,
            }
        )

    return results


def list_campaigns(db: Session) -> List[Campaign]:
    """Retrieve all campaigns ordered by creation date (newest first)."""
    stmt = select(Campaign).order_by(Campaign.created_at.desc())
    return db.scalars(stmt).all()


def get_campaign_with_layouts(db: Session, campaign_id: int) -> Campaign:
    """
    Get campaign with all canvas layouts eagerly loaded.
    """

    campaign = (
        db.query(Campaign)
        .options(
            joinedload(Campaign.canvas_layouts),
            joinedload(Campaign.imagery).joinedload(Imagery.canvas_layouts),
        )
        .filter(Campaign.id == campaign_id)
        .first()
    )

    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    return campaign


def create_campaign(
    db: Session,
    *,
    name: str,
    mode: str,
    settings: CampaignSettingsCreate,
    user_id: int,
    imagery_configs: Optional[List] = None,
    timeseries_configs: Optional[List] = None,
) -> Campaign:
    """
    Create a new campaign with default layout, settings, admin user, and optionally imagery/timeseries.

    Args:
        db: Database session
        name: Campaign name
        mode: Campaign mode (e.g., 'tasks' or 'open-world')
        settings: Campaign configuration settings
        user_id: ID of user to set as admin
        imagery_configs: Optional list of imagery configurations to create
        timeseries_configs: Optional list of timeseries configurations to create

    Returns:
        Created campaign with all relationships loaded
    """

    # Create campaign first
    campaign = Campaign(name=name, mode=mode)
    db.add(campaign)
    db.flush()  # Get campaign.id

    # Create default main canvas layout for the campaign
    default_layout = CanvasLayout(
        layout_data=DEFAULT_CAMPAIGN_MAIN_CANVAS_LAYOUT,
        user_id=None,  # Default layout for all users
        campaign_id=campaign.id,
        imagery_id=None,  # Main campaign layout, not imagery-specific
        is_default=True,  # Mark as default
    )
    db.add(default_layout)

    # Create campaign settings
    campaign_settings = CampaignSettings(
        campaign_id=campaign.id,
        **settings.to_orm(),
    )
    db.add(campaign_settings)

    # Add user as admin
    campaign_user = CampaignUser(
        user_id=user_id,
        campaign_id=campaign.id,
        role=CAMPAIGN_ROLE_ADMIN,
    )
    db.add(campaign_user)

    # Flush to get relationships loaded
    db.flush()
    db.refresh(campaign)

    # Create timeseries if provided
    if timeseries_configs:
        for ts_create in timeseries_configs:
            ts_item = TimeSeries(
                campaign_id=campaign.id,
                name=ts_create.name,
                start_ym=ts_create.start_ym,
                end_ym=ts_create.end_ym,
                data_source=ts_create.data_source,
                provider=ts_create.provider,
                ts_type=ts_create.ts_type,
            )
            db.add(ts_item)

        # Add timeseries entry to the default layout
        added = _add_timeseries_entry_to_layout(
            layout_data=default_layout.layout_data,
            window_width=10,
            window_height=8,
        )
        if added:
            flag_modified(default_layout, "layout_data")
            db.flush()
            db.refresh(campaign)

    # Create imagery if provided
    if imagery_configs:
        create_imagery_with_layouts_bulk_no_commit(
            db,
            campaign=campaign,
            imagery_items=imagery_configs,
        )

    # Commit everything together
    db.commit()
    db.refresh(campaign)
    return campaign


def add_users_to_campaign_bulk(
    db: Session,
    campaign_id: int,
    user_ids: List[UUID],
) -> None:
    """
    Add multiple users to a campaign by email addresses.
    All users are added with MEMBER role.
    """
    stmt = select(User).where(User.id.in_(user_ids))
    users = db.scalars(stmt).all()

    found_user_ids = {user.id for user in users}
    missing_user_ids = set(user_ids) - found_user_ids
    if missing_user_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Users not found with IDs: {', '.join(str(uid) for uid in missing_user_ids)}",
        )

    campaign_users = [
        CampaignUser(
            user_id=user.id,
            campaign_id=campaign_id,
            role=CAMPAIGN_ROLE_MEMBER,
        )
        for user in users
    ]

    db.add_all(campaign_users)
    db.commit()


def make_admin(db: Session, campaign_id: int, user_id: UUID) -> None:
    """
    Promote a campaign user to admin role.
    """
    result = db.execute(
        update(CampaignUser)
        .where(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user_id,
        )
        .values(role=CAMPAIGN_ROLE_ADMIN)
    )

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="User is not assigned to this campaign")

    db.commit()


def update_campaign_name(db: Session, campaign_id: int, new_name: str) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    campaign.name = new_name
    db.commit()
    db.refresh(campaign)
    return campaign


def update_campaign_bbox(db: Session, campaign_id: int, bbox: dict) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if not campaign.settings:
        raise HTTPException(status_code=404, detail="Campaign settings not found")
    for key in ["bbox_west", "bbox_south", "bbox_east", "bbox_north"]:
        if key not in bbox:
            raise HTTPException(status_code=422, detail=f"Missing {key} in bbox")
        setattr(campaign.settings, key, bbox[key])
    db.commit()
    db.refresh(campaign)
    return campaign


def remove_user_from_campaign(db: Session, campaign_id: int, user_id: UUID) -> None:
    """
    Remove a user from a campaign.

    This only deletes the user's membership record (CampaignUser).
    All annotations created by the user remain in the campaign, as the
    Annotation model uses RESTRICT on user deletion.
    """
    result = db.execute(
        delete(CampaignUser).where(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user_id,
        )
    )

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="User is not assigned to this campaign")

    db.commit()


def demote_admin(db: Session, campaign_id: int, user_id: UUID) -> None:
    """
    Demote a campaign admin to member role.
    """
    result = db.execute(
        update(CampaignUser)
        .where(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user_id,
            CampaignUser.role == CAMPAIGN_ROLE_ADMIN,
        )
        .values(role=CAMPAIGN_ROLE_MEMBER)
    )

    if result.rowcount == 0:
        raise HTTPException(
            status_code=404,
            detail="User is not an admin of this campaign or not assigned to the campaign",
        )

    db.commit()


def assign_tasks_to_users(db: Session, campaign_id: int, task_assignments: dict[int, UUID]) -> None:
    """
    Assign multiple annotation tasks to different users in bulk.
    """

    # Verify all users are members of the campaign
    user_ids = list(set(task_assignments.values()))
    stmt = select(CampaignUser).where(
        CampaignUser.campaign_id == campaign_id, CampaignUser.user_id.in_(user_ids)
    )
    campaign_users = db.scalars(stmt).all()

    found_user_ids = {cu.user_id for cu in campaign_users}
    missing_user_ids = set(user_ids) - found_user_ids

    if missing_user_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Users not assigned to campaign: {', '.join(str(uid) for uid in missing_user_ids)}",
        )

    # Verify all tasks belong to the campaign and update assignments
    task_ids = list(task_assignments.keys())
    stmt = select(AnnotationTaskItem).where(
        AnnotationTaskItem.id.in_(task_ids), AnnotationTaskItem.campaign_id == campaign_id
    )
    tasks = db.scalars(stmt).all()

    found_task_ids = {task.id for task in tasks}
    missing_task_ids = set(task_ids) - found_task_ids

    if missing_task_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Tasks not found in campaign: {', '.join(str(tid) for tid in missing_task_ids)}",
        )

    # Update task assignments
    for task in tasks:
        task.assigned_user_id = task_assignments[task.id]

    db.commit()


def delete_annotation_tasks(db: Session, campaign_id: int, task_ids: list[int]) -> int:
    """
    Delete multiple annotation tasks from a campaign.
    
    This will also delete any annotations associated with these tasks.
    
    Args:
        db: Database session
        campaign_id: ID of the campaign
        task_ids: List of task IDs to delete
        
    Returns:
        Number of tasks deleted
        
    Raises:
        HTTPException: If tasks don't exist or don't belong to campaign
    """
    if not task_ids:
        return 0
    
    # Verify all tasks belong to the campaign
    stmt = select(AnnotationTaskItem).where(
        AnnotationTaskItem.id.in_(task_ids),
        AnnotationTaskItem.campaign_id == campaign_id
    )
    tasks = db.scalars(stmt).all()
    
    found_task_ids = {task.id for task in tasks}
    missing_task_ids = set(task_ids) - found_task_ids
    
    if missing_task_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Tasks not found in campaign: {', '.join(str(tid) for tid in missing_task_ids)}",
        )
    
    # Delete the tasks (annotations will be cascade deleted)
    for task in tasks:
        db.delete(task)
    
    db.commit()
    
    return len(tasks)


def delete_campaign(db: Session, campaign_id: int) -> None:
    """
    Delete a campaign and all associated data.

    Cascading deletes will automatically remove:
    - Campaign settings
    - Canvas layouts (both default and personal)
    - Imagery and imagery windows
    - Timeseries
    - Annotations
    - Annotation task items
    - Campaign user associations

    Args:
        db: Database session
        campaign_id: ID of the campaign to delete
    """
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    db.delete(campaign)
    db.commit()

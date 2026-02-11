from typing import List, Optional
from datetime import datetime
from uuid import UUID
import logging
import random
from collections import defaultdict

import numpy as np
from src.annotation import embeddings_service
import krippendorff
from sqlalchemy import delete, select, update, func
from sqlalchemy.orm.attributes import flag_modified

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from src.auth.models import User
from src.auth.service import is_admin as is_global_admin
from src.campaigns.constants import (
    DEFAULT_CAMPAIGN_MAIN_CANVAS_LAYOUT,
)
from src.campaigns.models import (
    Campaign,
    CampaignSettings,
    CampaignUser,
    CanvasLayout,
)
from src.campaigns.schemas import CampaignSettingsCreate
from src.imagery.models import Imagery
from src.annotation.models import AnnotationTask, AnnotationTaskAssignment
from src.imagery.service import create_imagery_with_layouts_bulk_no_commit
from src.timeseries.service import _add_timeseries_entry_to_layout
from src.timeseries.models import TimeSeries

logger = logging.getLogger(__name__)


# ============================================================================
# Helpers
# ============================================================================

def _identify_imagery_time_range(
    db: Session,
    campaign_id: int,
) -> tuple[datetime, datetime]:
    """Derive the embedding time range from the campaign's imagery.

    Returns the most recent year from all imagery.
    """
    stmt = (
        select(
            func.min(Imagery.start_ym),
            func.max(Imagery.end_ym),
        )
        .where(Imagery.campaign_id == campaign_id)
    )
    row = db.execute(stmt).one()
    min_ym, max_ym = row[0], row[1]

    if min_ym is None or max_ym is None:
        raise ValueError("Campaign has no imagery - cannot derive time range.")

    earliest_year = int(min_ym[:4])
    latest_year = int(max_ym[:4])

    return (
        datetime(latest_year, 1, 1),
        datetime(latest_year, 12, 31),
    )


# ============================================================================
# Campaign Management
# ============================================================================

def list_campaigns(db: Session) -> List[Campaign]:
    """Retrieve all campaigns ordered by creation date (newest first)."""
    stmt = select(Campaign).order_by(Campaign.created_at.desc())
    return db.scalars(stmt).all()


def get_campaign_users_with_roles(db: Session, campaign_id: int) -> List[CampaignUser]:
    """
    
    Args:
        db: Database session
        campaign_id: ID of the campaign
        
    Returns:
        List of campaign user associations with user data loaded
    """
    stmt = (
        select(CampaignUser)
        .where(CampaignUser.campaign_id == campaign_id)
        .options(joinedload(CampaignUser.user))
    )
    
    return db.scalars(stmt).unique().all()


def list_campaigns_with_user_roles(db: Session, user_id: int) -> List[dict]:
    """
    Retrieve all campaigns with user role information.

    Returns list of dicts containing campaign data plus wheter the provided user is_admin/is_member flags.
    """
    stmt = select(Campaign).options(joinedload(Campaign.users)).order_by(Campaign.created_at.desc())
    campaigns = db.scalars(stmt).unique().all()

    # Check if user is a global platform admin
    user_is_global_admin = is_global_admin(db, user_id)
    
    if user_is_global_admin:
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
                if campaign_user.is_admin:
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
        is_admin=True,
        is_authorative_reviewer=False,
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

    # Fetch and add embeddings
    # TODO do this in the background without blocking campaign creation, as it can be time consuming
    try:
        logger.info("Creating embeddings")
        start_date, end_date = _identify_imagery_time_range(db, campaign.id)
        logger.info(start_date, end_date)
        embeddings_service.populate_campaign_embeddings(db, campaign.id, start_date, end_date)
    except Exception as e:
        logger.warning("Skipping embeddings for campaign %d: %s", campaign.id, e)

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
            is_admin=False,
            is_authorative_reviewer=False,
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
        .values(is_admin=True)
    )

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="User is not assigned to this campaign")

    db.commit()


def make_authorative_reviewer(db: Session, campaign_id: int, user_id: UUID) -> None:
    """
    Make a campaign user an authorative reviewer.
    """
    result = db.execute(
        update(CampaignUser)
        .where(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user_id,
        )
        .values(is_authorative_reviewer=True)
    )

    if result.rowcount == 0:
        raise HTTPException(
            status_code=404,
            detail="User is not assigned to the campaign",
        )

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
            CampaignUser.is_admin == True,
        )
        .values(is_admin=False)
    )

    if result.rowcount == 0:
        raise HTTPException(
            status_code=404,
            detail="User is not an admin of this campaign or not assigned to the campaign",
        )

    db.commit()

def demote_authorative_reviewer(db: Session, campaign_id: int, user_id: UUID) -> None:
    """
    Demote a campaign authorative reviewer to normal user.
    """
    result = db.execute(
        update(CampaignUser)
        .where(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user_id,
            CampaignUser.is_authorative_reviewer == True,
        )
        .values(is_authorative_reviewer=False)
    )

    if result.rowcount == 0:
        raise HTTPException(
            status_code=404,
            detail="User is not an authorative reviewer of this campaign or not assigned to the campaign",
        )

    db.commit()


def assign_tasks_to_users(db: Session, campaign_id: int, task_assignments: dict[int, list[UUID]]) -> None:
    """
    Assign multiple annotation tasks to different users in bulk.
    Supports multiple users per task for quality assurance.
    """

    # Flatten all user IDs from all tasks
    all_user_ids = []
    for user_list in task_assignments.values():
        all_user_ids.extend(user_list)
    user_ids = list(set(all_user_ids))
    
    # Verify all users are members of the campaign
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

    # Verify all tasks belong to the campaign
    task_ids = list(task_assignments.keys())
    stmt = select(AnnotationTask).where(
        AnnotationTask.id.in_(task_ids), AnnotationTask.campaign_id == campaign_id
    )
    tasks = db.scalars(stmt).all()

    found_task_ids = {task.id for task in tasks}
    missing_task_ids = set(task_ids) - found_task_ids

    if missing_task_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Tasks not found in campaign: {', '.join(str(tid) for tid in missing_task_ids)}",
        )

    # Create or update task assignments (multiple users per task)
    for task_id, assigned_user_ids in task_assignments.items():
        # Get existing assignments for this task
        stmt = select(AnnotationTaskAssignment).where(
            AnnotationTaskAssignment.task_id == task_id
        )
        existing_assignments = db.scalars(stmt).all()
        existing_user_ids = {assignment.user_id for assignment in existing_assignments}
        
        # Create new assignments only for users not already assigned
        for user_id in assigned_user_ids:
            if user_id not in existing_user_ids:
                assignment = AnnotationTaskAssignment(
                    task_id=task_id,
                    user_id=user_id,
                    status="pending"
                )
                db.add(assignment)

    db.commit()


def unassign_user_from_task(db: Session, campaign_id: int, task_id: int, user_id: UUID) -> None:
    """
    Remove a user's assignment from a specific task.
    """
    # Verify task belongs to the campaign
    stmt = select(AnnotationTask).where(
        AnnotationTask.id == task_id,
        AnnotationTask.campaign_id == campaign_id
    )
    task = db.scalar(stmt)
    
    if not task:
        raise HTTPException(
            status_code=404,
            detail=f"Task {task_id} not found in campaign {campaign_id}"
        )
    
    # Delete the assignment
    stmt = delete(AnnotationTaskAssignment).where(
        AnnotationTaskAssignment.task_id == task_id,
        AnnotationTaskAssignment.user_id == user_id
    )
    result = db.execute(stmt)
    
    if result.rowcount == 0:
        raise HTTPException(
            status_code=404,
            detail=f"User {user_id} is not assigned to task {task_id}"
        )
    
    db.commit()


def assign_reviewers_percentage(
    db: Session, 
    campaign_id: int, 
    percentage: float, 
    num_reviewers: int, 
    reviewer_ids: list[UUID]
) -> None:
    """
    Assign reviewers to a percentage of tasks in a campaign.
    
    Args:
        db: Database session
        campaign_id: ID of the campaign
        percentage: Percentage of tasks to assign reviewers to (0-100)
        num_reviewers: Number of reviewers per task
        reviewer_ids: Pool of reviewer user IDs to choose from
    """
    if not 0 < percentage <= 100:
        raise HTTPException(status_code=400, detail="Percentage must be between 0 and 100")
    
    if num_reviewers < 1:
        raise HTTPException(status_code=400, detail="Number of reviewers must be at least 1")
    
    if len(reviewer_ids) < num_reviewers:
        raise HTTPException(
            status_code=400, 
            detail=f"Not enough reviewers in pool. Need at least {num_reviewers}, got {len(reviewer_ids)}"
        )
    
    # Verify all reviewers are members of the campaign
    stmt = select(CampaignUser).where(
        CampaignUser.campaign_id == campaign_id, 
        CampaignUser.user_id.in_(reviewer_ids)
    )
    campaign_users = db.scalars(stmt).all()
    
    found_user_ids = {cu.user_id for cu in campaign_users}
    missing_user_ids = set(reviewer_ids) - found_user_ids
    
    if missing_user_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Reviewers not assigned to campaign: {', '.join(str(uid) for uid in missing_user_ids)}",
        )
    
    # Get all tasks in the campaign
    stmt = select(AnnotationTask).where(AnnotationTask.campaign_id == campaign_id)
    all_tasks = db.scalars(stmt).all()
    
    if not all_tasks:
        raise HTTPException(status_code=404, detail="No tasks found in campaign")
    
    # Calculate number of tasks to assign reviewers to
    num_tasks_to_review = max(1, int(len(all_tasks) * percentage / 100))
    
    # Randomly select tasks
    tasks_to_review = random.sample(all_tasks, num_tasks_to_review)
    
    # Batch fetch existing assignments for all selected tasks to avoid N+1 queries
    task_ids_to_review = [task.id for task in tasks_to_review]
    stmt = select(AnnotationTaskAssignment).where(
        AnnotationTaskAssignment.task_id.in_(task_ids_to_review)
    )
    existing_assignments = db.scalars(stmt).all()
    
    # Build a map of task_id -> set of assigned user_ids
    existing_assignments_map = {}
    for assignment in existing_assignments:
        if assignment.task_id not in existing_assignments_map:
            existing_assignments_map[assignment.task_id] = set()
        existing_assignments_map[assignment.task_id].add(assignment.user_id)
    
    # Assign reviewers to selected tasks
    for task in tasks_to_review:
        existing_user_ids = existing_assignments_map.get(task.id, set())
        
        # Randomly select reviewers from the pool
        selected_reviewers = random.sample(reviewer_ids, min(num_reviewers, len(reviewer_ids)))
        
        # Create assignments only for reviewers not already assigned
        for user_id in selected_reviewers:
            if user_id not in existing_user_ids:
                assignment = AnnotationTaskAssignment(
                    task_id=task.id,
                    user_id=user_id,
                    status="pending"
                )
                db.add(assignment)
    
    db.commit()


def assign_reviewers_fixed(
    db: Session, 
    campaign_id: int, 
    num_tasks: int, 
    num_reviewers: int, 
    reviewer_ids: list[UUID]
) -> None:
    """
    Assign a fixed number of reviewers to a fixed number of tasks.
    
    Args:
        db: Database session
        campaign_id: ID of the campaign
        num_tasks: Number of tasks to assign reviewers to
        num_reviewers: Number of reviewers per task
        reviewer_ids: Pool of reviewer user IDs to choose from
    """
    if num_tasks < 1:
        raise HTTPException(status_code=400, detail="Number of tasks must be at least 1")
    
    if num_reviewers < 1:
        raise HTTPException(status_code=400, detail="Number of reviewers must be at least 1")
    
    if len(reviewer_ids) < num_reviewers:
        raise HTTPException(
            status_code=400, 
            detail=f"Not enough reviewers in pool. Need at least {num_reviewers}, got {len(reviewer_ids)}"
        )
    
    # Verify all reviewers are members of the campaign
    stmt = select(CampaignUser).where(
        CampaignUser.campaign_id == campaign_id, 
        CampaignUser.user_id.in_(reviewer_ids)
    )
    campaign_users = db.scalars(stmt).all()
    
    found_user_ids = {cu.user_id for cu in campaign_users}
    missing_user_ids = set(reviewer_ids) - found_user_ids
    
    if missing_user_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Reviewers not assigned to campaign: {', '.join(str(uid) for uid in missing_user_ids)}",
        )
    
    # Get all tasks in the campaign
    stmt = select(AnnotationTask).where(AnnotationTask.campaign_id == campaign_id)
    all_tasks = db.scalars(stmt).all()
    
    if not all_tasks:
        raise HTTPException(status_code=404, detail="No tasks found in campaign")
    
    if num_tasks > len(all_tasks):
        raise HTTPException(
            status_code=400, 
            detail=f"Requested {num_tasks} tasks but campaign only has {len(all_tasks)} tasks"
        )
    
    # Randomly select tasks
    tasks_to_review = random.sample(all_tasks, num_tasks)
    
    # Batch fetch existing assignments for all selected tasks to avoid N+1 queries
    task_ids_to_review = [task.id for task in tasks_to_review]
    stmt = select(AnnotationTaskAssignment).where(
        AnnotationTaskAssignment.task_id.in_(task_ids_to_review)
    )
    existing_assignments = db.scalars(stmt).all()
    
    # Build a map of task_id -> set of assigned user_ids
    existing_assignments_map = {}
    for assignment in existing_assignments:
        if assignment.task_id not in existing_assignments_map:
            existing_assignments_map[assignment.task_id] = set()
        existing_assignments_map[assignment.task_id].add(assignment.user_id)
    
    # Assign reviewers to selected tasks
    for task in tasks_to_review:
        existing_user_ids = existing_assignments_map.get(task.id, set())
        
        # Randomly select reviewers from the pool
        selected_reviewers = random.sample(reviewer_ids, min(num_reviewers, len(reviewer_ids)))
        
        # Create assignments only for reviewers not already assigned
        for user_id in selected_reviewers:
            if user_id not in existing_user_ids:
                assignment = AnnotationTaskAssignment(
                    task_id=task.id,
                    user_id=user_id,
                    status="pending"
                )
                db.add(assignment)
    
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
    stmt = select(AnnotationTask).where(
        AnnotationTask.id.in_(task_ids),
        AnnotationTask.campaign_id == campaign_id
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


# ============================================================================
# Campaign Statistics
# ============================================================================

def _calculate_krippendorff_alpha(
    annotations_by_task: dict[int, List[tuple[UUID, Optional[int]]]]
) -> Optional[float]:
    """
    Calculate Krippendorff's Alpha for inter-annotator agreement using the krippendorff library.
    
    Args:
        annotations_by_task: Dict mapping task_id to list of (user_id, label_id) tuples
        
    Returns:
        Krippendorff's Alpha value (0-1) or None if not enough data
    """
    # Filter tasks with at least 2 annotations
    multi_annotated_tasks = {
        task_id: annots
        for task_id, annots in annotations_by_task.items()
        if len(annots) >= 2
    }
    
    if not multi_annotated_tasks:
        return None
    
    # Get all unique users and check if we have at least 2 different labels
    all_users = set()
    all_labels = set()
    for annots in multi_annotated_tasks.values():
        for user_id, label_id in annots:
            all_users.add(user_id)
            if label_id is not None:
                all_labels.add(label_id)
    
    if len(all_labels) < 2:
        return None  # Need at least 2 different labels for agreement
    
    # Build reliability data matrix for krippendorff library
    # Format: each row is an annotator, each column is an item (task)
    # Value is the label_id, or np.nan if annotator didn't annotate that task
    users_list = sorted(list(all_users))
    tasks_list = sorted(list(multi_annotated_tasks.keys()))
    
    reliability_data = []
    for user_id in users_list:
        row = []
        for task_id in tasks_list:
            annots = multi_annotated_tasks[task_id]
            user_label = np.nan  # Default to missing
            for u, label in annots:
                if u == user_id and label is not None:
                    user_label = float(label)
                    break
            row.append(user_label)
        reliability_data.append(row)
    
    # Convert to numpy array
    reliability_matrix = np.array(reliability_data)
    
    # Calculate Krippendorff's Alpha using nominal metric
    try:
        alpha = krippendorff.alpha(reliability_matrix, level_of_measurement="nominal")
        return float(alpha) if not np.isnan(alpha) else None
    except Exception:
        return None


def _calculate_pairwise_agreement(
    user1_id: UUID,
    user2_id: UUID,
    annotations_by_task: dict[int, List[tuple[UUID, Optional[int]]]]
) -> tuple[Optional[float], int]:
    """
    Calculate agreement percentage between two specific annotators.
    
    Args:
        user1_id: First annotator's user ID
        user2_id: Second annotator's user ID
        annotations_by_task: Dict mapping task_id to list of (user_id, label_id) tuples
        
    Returns:
        Tuple of (agreement_percentage, shared_tasks_count)
        Agreement is percentage (0-100) or None if no shared tasks
    """
    shared_annotations = []
    
    for task_id, annots in annotations_by_task.items():
        user1_label = None
        user2_label = None
        
        for user_id, label_id in annots:
            if user_id == user1_id:
                user1_label = label_id
            elif user_id == user2_id:
                user2_label = label_id
        
        # Only count if both users annotated this task
        if user1_label is not None and user2_label is not None:
            shared_annotations.append((user1_label, user2_label))
    
    if not shared_annotations:
        return None, 0
    
    # Calculate agreement
    agreements = sum(1 for label1, label2 in shared_annotations if label1 == label2)
    agreement_pct = (agreements / len(shared_annotations)) * 100.0
    
    return agreement_pct, len(shared_annotations)


def get_campaign_statistics(
    campaign_id: int,
    db: Session,
):
    """
    Calculate comprehensive statistics for a campaign.
    
    Args:
        campaign_id: ID of the campaign
        db: Database session
        
    Returns:
        CampaignStatistics object with annotator info and pairwise agreements
    """
    from src.annotation.models import Annotation
    from src.campaigns.schemas import CampaignStatistics, AnnotatorInfo, PairwiseAgreement
    
    # Get campaign
    campaign = db.execute(
        select(Campaign).where(Campaign.id == campaign_id)
    ).scalar_one_or_none()
    
    if not campaign:
        raise HTTPException(status_code=404, detail=f"Campaign {campaign_id} not found")
    
    # Get all annotations for this campaign with relationships
    annotations = db.execute(
        select(Annotation)
        .where(Annotation.campaign_id == campaign_id)
        .options(joinedload(Annotation.annotation_task))
    ).unique().scalars().all()
    
    if not annotations:
        # Return empty statistics
        return CampaignStatistics(
            campaign_id=campaign_id,
            campaign_name=campaign.name,
            total_annotations=0,
            tasks_with_multiple_annotations=0,
            overall_label_distribution={},
            krippendorff_alpha=None,
            annotators=[],
            pairwise_agreements=[]
        )
    
    # Get label mapping
    labels = campaign.settings.labels or {}
    label_id_to_name = {}
    if isinstance(labels, dict):
        for label_id, label_data in labels.items():
            if isinstance(label_data, dict):
                label_id_to_name[int(label_id)] = label_data.get("name", f"Label {label_id}")
            else:
                label_id_to_name[int(label_id)] = str(label_data)
    elif isinstance(labels, list):
        for label_data in labels:
            if isinstance(label_data, dict):
                lid = label_data.get("id")
                lname = label_data.get("name", f"Label {lid}")
                if lid is not None:
                    label_id_to_name[int(lid)] = lname
    
    # Batch fetch users
    user_ids = {ann.created_by_user_id for ann in annotations}
    users = db.execute(
        select(User).where(User.id.in_(user_ids))
    ).scalars().all()
    user_map = {user.id: user for user in users}
    
    # Organize annotations by user and task
    annotations_by_user: dict[UUID, List[Annotation]] = defaultdict(list)
    annotations_by_task: dict[int, List[tuple[UUID, Optional[int]]]] = defaultdict(list)
    
    for ann in annotations:
        annotations_by_user[ann.created_by_user_id].append(ann)
        if ann.annotation_task_id:
            annotations_by_task[ann.annotation_task_id].append(
                (ann.created_by_user_id, ann.label_id)
            )
    
    # Build annotator info list
    annotator_list = []
    user_ids_list = sorted(list(annotations_by_user.keys()))
    
    for user_id in user_ids_list:
        user = user_map.get(user_id)
        if not user:
            continue
        
        user_annots = annotations_by_user[user_id]
        
        # Calculate label distribution for this user
        label_dist = defaultdict(int)
        for ann in user_annots:
            if ann.label_id is not None:
                label_name = label_id_to_name.get(ann.label_id, f"Unknown ({ann.label_id})")
                label_dist[label_name] += 1
        
        annotator_list.append(
            AnnotatorInfo(
                user_id=str(user_id),
                user_email=user.email,
                user_display_name=user.display_name,
                total_annotations=len(user_annots),
                label_distribution=dict(label_dist)
            )
        )
    
    # Sort by total annotations (descending)
    annotator_list.sort(key=lambda x: x.total_annotations, reverse=True)
    
    # Calculate overall label distribution
    overall_label_dist = defaultdict(int)
    for ann in annotations:
        if ann.label_id is not None:
            label_name = label_id_to_name.get(ann.label_id, f"Unknown ({ann.label_id})")
            overall_label_dist[label_name] += 1
    
    # Count tasks with multiple annotations
    tasks_with_multiple = sum(
        1 for annots in annotations_by_task.values() if len(annots) >= 2
    )
    
    # Calculate Krippendorff's Alpha for overall inter-annotator agreement
    krippendorff_alpha = _calculate_krippendorff_alpha(annotations_by_task)
    
    # Calculate pairwise agreements between all annotators
    pairwise_list = []
    for i, user1_id in enumerate(user_ids_list):
        for user2_id in user_ids_list[i+1:]:  # Only calculate upper triangle (avoid duplicates)
            agreement_pct, shared_tasks = _calculate_pairwise_agreement(
                user1_id, user2_id, annotations_by_task
            )
            
            pairwise_list.append(
                PairwiseAgreement(
                    annotator1_id=str(user1_id),
                    annotator2_id=str(user2_id),
                    agreement_percentage=agreement_pct,
                    shared_tasks=shared_tasks
                )
            )
    
    return CampaignStatistics(
        campaign_id=campaign_id,
        campaign_name=campaign.name,
        total_annotations=len(annotations),
        tasks_with_multiple_annotations=tasks_with_multiple,
        overall_label_distribution=dict(overall_label_dist),
        krippendorff_alpha=krippendorff_alpha,
        annotators=annotator_list,
        pairwise_agreements=pairwise_list
    )

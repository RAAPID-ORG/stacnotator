import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from src.annotation.constants import (
    ANNOTATION_TASK_STATUS_DONE,
    ANNOTATION_TASK_STATUS_PENDING,
    ANNOTATION_TASK_STATUS_SKIPPED,
    CLAIM_TTL_MINUTES,
)
from src.annotation.models import (
    Annotation,
    AnnotationGeometry,
    AnnotationTask,
    AnnotationTaskAssignment,
    Embedding,
)
from src.annotation.schemas import (
    AnnotationCreate,
    AnnotationFromTaskCreate,
    AnnotationUpdate,
)
from src.auth.service import is_admin as is_platform_admin
from src.campaigns.models import Campaign, CampaignUser
from src.campaigns.service import is_authoritative_reviewer

logger = logging.getLogger(__name__)


def get_user_assignment_status(task: AnnotationTask, user_id: UUID) -> str:
    """Get a user's assignment status for a task."""
    if task and task.assignments:
        for a in task.assignments:
            if a.user_id == user_id:
                return a.status
    return "pending"


def _is_campaign_admin(db: Session, user_id: UUID, campaign_id: int) -> bool:
    """Check if a user is an admin of the given campaign or a platform admin."""
    campaign_admin = db.execute(
        select(CampaignUser).where(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user_id,
            CampaignUser.is_admin,
        )
    ).scalar_one_or_none()
    return campaign_admin is not None or is_platform_admin(db, user_id)


def validate_label_id(campaign: Campaign, label_id: int) -> None:
    """Raise HTTP 400 if label_id is not a key in the campaign's label set."""
    labels = (campaign.settings.labels if campaign.settings else None) or {}
    if str(label_id) not in labels:
        raise HTTPException(
            status_code=400,
            detail=f"label_id {label_id} is not a label of this campaign",
        )


# ============================================================================
# Task Retrieval
# ============================================================================


def get_annotation_task_by_id(
    db: Session,
    task_id: int,
    campaign_id: int,
) -> AnnotationTask | None:
    """
    Retrieve a single annotation task by ID, ensuring it belongs to the campaign.

    Args:
        db: Database session
        task_id: ID of the task
        campaign_id: ID of the campaign (for validation)

    Returns:
        Annotation task item or None if not found
    """
    stmt = (
        select(AnnotationTask)
        .where(
            AnnotationTask.id == task_id,
            AnnotationTask.campaign_id == campaign_id,
        )
        .options(
            joinedload(AnnotationTask.geometry),
            joinedload(AnnotationTask.assignments).joinedload(AnnotationTaskAssignment.user),
            joinedload(AnnotationTask.annotations).joinedload(Annotation.creator),
        )
    )

    task = db.scalars(stmt).unique().first()
    if task is not None:
        _attach_has_embedding(db, [task])
    return task


def get_annotation_tasks_for_campaign(
    db: Session,
    campaign_id: int,
) -> list[AnnotationTask]:
    """
    Retrieve all annotation tasks for a campaign with eager loading
    to avoid N+1 query problem.

    This loads all related data (geometry, assignments, annotations)
    in a single optimized query.

    Args:
        db: Database session
        campaign_id: ID of the campaign

    Returns:
        List of annotation task items with all relationships loaded
    """
    stmt = (
        select(AnnotationTask)
        .where(AnnotationTask.campaign_id == campaign_id)
        .options(
            joinedload(AnnotationTask.geometry),
            joinedload(AnnotationTask.assignments).joinedload(AnnotationTaskAssignment.user),
            joinedload(AnnotationTask.annotations).joinedload(Annotation.creator),
        )
        .order_by(AnnotationTask.annotation_number)
    )

    tasks = db.scalars(stmt).unique().all()
    _attach_has_embedding(db, tasks)
    return tasks


def _attach_has_embedding(db: Session, tasks: list[AnnotationTask]) -> None:
    """Set `has_embedding` on each task via one lightweight indexed lookup.

    Kept out of the main joinedload chain so it does not multiply the result
    rows; Embedding has its own hnsw index and FK on annotation_task_id.
    """
    if not tasks:
        return
    task_ids = [t.id for t in tasks]
    embedded_ids = set(
        db.execute(
            select(Embedding.annotation_task_id).where(Embedding.annotation_task_id.in_(task_ids))
        ).scalars()
    )
    for task in tasks:
        task.has_embedding = task.id in embedded_ids


def get_annotation_task_id_for_annotation(
    db: Session,
    annotation_id: int,
    campaign_id: int,
) -> int | None:
    """Get the task_id linked to an annotation (if any), before deletion."""
    result = db.execute(
        select(Annotation.annotation_task_id).where(
            Annotation.id == annotation_id,
            Annotation.campaign_id == campaign_id,
        )
    ).scalar_one_or_none()
    return result


# ============================================================================
# Annotation Creation
# ============================================================================


def add_annotation_for_task(
    db: Session,
    annotation_task: AnnotationTask,
    annotation_create: AnnotationFromTaskCreate,
    user_id: UUID,
) -> Annotation | None:
    """
    Create or update annotation for a task item and update task status.

    If annotation exists (same task, same user):
    - Delete it if no new label provided and mark assignment as skipped
    - Update it if new label/comment is provided

    If annotation doesn't exist:
    - Create annotation record if label or comment is provided
    - If from assignment: Update assignment status to 'done' (with label) or 'skipped' (without label)

    Args:
        db: Database session
        annotation_task: Task item being annotated
        annotation_create: Annotation data from user
        user_id: ID of user creating the annotation
    """

    if annotation_create.is_authoritative and not is_authoritative_reviewer(
        db, annotation_task.campaign_id, user_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Only campaign admins or authoritative reviewers can submit authoritative annotations",
        )

    campaign = db.get(Campaign, annotation_task.campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")

    if annotation_create.label_id is not None:
        validate_label_id(campaign, annotation_create.label_id)

    # Check if annotation already exists for this task
    existing_annotation = db.execute(
        select(Annotation).where(
            Annotation.annotation_task_id == annotation_task.id,
            Annotation.created_by_user_id == user_id,
        )
    ).scalar_one_or_none()

    assignment = db.execute(
        select(AnnotationTaskAssignment).where(
            AnnotationTaskAssignment.task_id == annotation_task.id,
            AnnotationTaskAssignment.user_id == user_id,
        )
    ).scalar_one_or_none()

    annotation = None

    if existing_annotation:  # UPDATE
        # If no new label provided, delete existing annotation and mark as skipped
        if annotation_create.label_id is None:
            db.delete(existing_annotation)
            if assignment:
                assignment.status = ANNOTATION_TASK_STATUS_SKIPPED
        else:
            # Update existing annotation with new label/comment
            existing_annotation.label_id = annotation_create.label_id
            existing_annotation.comment = annotation_create.comment
            existing_annotation.created_by_user_id = user_id
            existing_annotation.confidence = annotation_create.confidence
            if annotation_create.is_authoritative is not None:
                existing_annotation.is_authoritative = annotation_create.is_authoritative
            existing_annotation.flagged_for_review = annotation_create.flagged_for_review or False
            existing_annotation.flag_comment = (
                annotation_create.flag_comment if annotation_create.flagged_for_review else None
            )
            if assignment:
                assignment.status = ANNOTATION_TASK_STATUS_DONE
            annotation = existing_annotation
    else:  # CREATE
        # Create new annotation if label or comment provided
        if annotation_create.label_id is not None or annotation_create.comment is not None:
            annotation = Annotation(
                geometry_id=annotation_task.geometry_id,
                label_id=annotation_create.label_id,
                comment=annotation_create.comment,
                annotation_task_id=annotation_task.id,
                campaign_id=annotation_task.campaign_id,
                created_by_user_id=user_id,
                confidence=annotation_create.confidence,
                is_authoritative=annotation_create.is_authoritative or False,
                flagged_for_review=annotation_create.flagged_for_review or False,
                flag_comment=(
                    annotation_create.flag_comment if annotation_create.flagged_for_review else None
                ),
            )
            db.add(annotation)

        # Update assigment status if from assignment
        if assignment:
            assignment.status = (
                ANNOTATION_TASK_STATUS_SKIPPED
                if annotation_create.label_id is None
                else ANNOTATION_TASK_STATUS_DONE
            )

    db.commit()

    if annotation:
        db.refresh(annotation)
        return annotation


def _release_other_soft_claims(
    db: Session, campaign_id: int, user_id: UUID, keep_task_id: int
) -> None:
    """Enforce one active soft claim per user per campaign.

    Drops the caller's other un-worked pending soft claims so that claiming a new task
    moves the claim. Worked tasks (an annotation exists) and explicit admin assignments
    (claimed_at is NULL) are left untouched.
    """
    has_annotation = (
        select(Annotation.id)
        .where(
            Annotation.annotation_task_id == AnnotationTaskAssignment.task_id,
            Annotation.created_by_user_id == user_id,
        )
        .exists()
    )
    others = (
        db.execute(
            select(AnnotationTaskAssignment)
            .join(AnnotationTask, AnnotationTask.id == AnnotationTaskAssignment.task_id)
            .where(
                AnnotationTask.campaign_id == campaign_id,
                AnnotationTaskAssignment.user_id == user_id,
                AnnotationTaskAssignment.task_id != keep_task_id,
                AnnotationTaskAssignment.claimed_at.is_not(None),
                AnnotationTaskAssignment.status == ANNOTATION_TASK_STATUS_PENDING,
                ~has_annotation,
            )
        )
        .scalars()
        .all()
    )
    for assignment in others:
        db.delete(assignment)


def claim_task_for_user(
    db: Session,
    campaign_id: int,
    task_id: int,
    user_id: UUID,
) -> AnnotationTaskAssignment:
    """Atomically soft-claim an unassigned task for a user.

    Idempotent, and guarantees the caller holds exactly one active soft claim in the
    campaign afterwards: any prior soft claim of theirs is released in the same
    transaction. Refreshes the lease if the user already holds this task. Raises 409 if the
    task is already annotated, explicitly assigned, or actively claimed by someone else; a
    stale soft claim by another user is taken over.
    """
    # Row lock serializes concurrent claims on the same task; skip_locked makes a
    # race a clean 409 instead of a block.
    task = db.execute(
        select(AnnotationTask)
        .where(
            AnnotationTask.id == task_id,
            AnnotationTask.campaign_id == campaign_id,
        )
        .with_for_update(skip_locked=True)
    ).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=409, detail="Task is no longer available")

    has_annotation = db.execute(
        select(Annotation.id).where(Annotation.annotation_task_id == task_id).limit(1)
    ).first()
    if has_annotation is not None:
        raise HTTPException(status_code=409, detail="Task has already been annotated")

    assignments = (
        db.execute(
            select(AnnotationTaskAssignment).where(AnnotationTaskAssignment.task_id == task_id)
        )
        .scalars()
        .all()
    )

    mine = next((a for a in assignments if a.user_id == user_id), None)
    if mine is not None:
        mine.claimed_at = func.now()
        result = mine
    else:
        cutoff = datetime.now(UTC) - timedelta(minutes=CLAIM_TTL_MINUTES)
        for assignment in assignments:
            is_stale_claim = (
                assignment.claimed_at is not None
                and assignment.status == ANNOTATION_TASK_STATUS_PENDING
                and assignment.claimed_at <= cutoff
            )
            if not is_stale_claim:
                raise HTTPException(status_code=409, detail="Task is no longer available")
            db.delete(assignment)

        result = AnnotationTaskAssignment(
            task_id=task_id,
            user_id=user_id,
            status=ANNOTATION_TASK_STATUS_PENDING,
            claimed_at=func.now(),
        )
        db.add(result)

    # Move the claim: no separate release call to lose, TTL is the real backstop.
    _release_other_soft_claims(db, campaign_id, user_id, keep_task_id=task_id)
    db.commit()
    db.refresh(result)
    return result


def create_annotation(
    db: Session,
    campaign: Campaign,
    annotation_create: AnnotationCreate,
    user_id: UUID,
) -> Annotation:
    """
    Create a standalone annotation (not linked to a task).

    Creates a new geometry record and annotation for the given campaign.

    Args:
        db: Database session
        campaign: Campaign to create annotation for
        annotation_create: Annotation data including geometry
        user_id: ID of user creating the annotation

    Returns:
        Created annotation record

    Raises:
        HTTPException: If geometry is invalid or creation fails
    """
    if annotation_create.label_id is not None:
        validate_label_id(campaign, annotation_create.label_id)

    try:
        # Create geometry from WKT
        geometry = AnnotationGeometry(geometry=f"SRID=4326;{annotation_create.geometry_wkt}")
        db.add(geometry)
        db.flush()  # Get geometry ID

        # Create annotation
        annotation = Annotation(
            geometry_id=geometry.id,
            label_id=annotation_create.label_id,
            comment=annotation_create.comment,
            campaign_id=campaign.id,
            created_by_user_id=user_id,
            confidence=annotation_create.confidence,
            annotation_task_id=None,  # Standalone annotation
            flagged_for_review=annotation_create.flagged_for_review or False,
            flag_comment=(
                annotation_create.flag_comment if annotation_create.flagged_for_review else None
            ),
            imagery_slice_id=annotation_create.imagery_slice_id,
            imagery_source_name=annotation_create.imagery_source_name,
            imagery_start_date=annotation_create.imagery_start_date,
            imagery_end_date=annotation_create.imagery_end_date,
        )
        db.add(annotation)
        db.commit()
        db.refresh(annotation)

        return annotation

    except Exception as e:
        db.rollback()
        logger.exception("Failed to create annotation")
        raise HTTPException(status_code=400, detail="Failed to create annotation") from e


def update_annotation(
    db: Session,
    annotation_id: int,
    annotation_update: AnnotationUpdate,
    user_id: UUID,
    campaign: Campaign | None = None,
) -> Annotation:
    """
    Update an existing annotation.

    Updates label, comment, and/or geometry. If geometry is updated,
    creates a new geometry record and updates the reference.

    In public campaigns, only the annotation creator can update their annotations.

    Args:
        db: Database session
        annotation_id: ID of annotation to update
        annotation_update: Updated annotation data
        user_id: ID of user updating the annotation
        campaign: Campaign object (used for public campaign ownership check)

    Returns:
        Updated annotation record

    Raises:
        HTTPException: If annotation not found, update fails, or ownership violated
    """
    # Get existing annotation
    annotation = db.execute(
        select(Annotation).where(Annotation.id == annotation_id)
    ).scalar_one_or_none()

    if annotation is None:
        raise HTTPException(status_code=404, detail="Annotation not found")

    # In public campaigns, only the creator or a campaign admin can update annotations
    if (
        campaign
        and campaign.is_public
        and annotation.created_by_user_id != user_id
        and not _is_campaign_admin(db, user_id, campaign.id)
    ):
        raise HTTPException(
            status_code=403,
            detail="You can only edit your own annotations",
        )

    try:
        # Update geometry if provided
        if annotation_update.geometry_wkt is not None:
            new_geometry = AnnotationGeometry(
                geometry=f"SRID=4326;{annotation_update.geometry_wkt}"
            )
            db.add(new_geometry)
            db.flush()  # Get new geometry ID
            annotation.geometry_id = new_geometry.id

            # The imagery snapshot reflects what was viewed during this geometry
            # edit, so it only refreshes alongside a geometry change.
            annotation.imagery_slice_id = annotation_update.imagery_slice_id
            annotation.imagery_source_name = annotation_update.imagery_source_name
            annotation.imagery_start_date = annotation_update.imagery_start_date
            annotation.imagery_end_date = annotation_update.imagery_end_date

        # Update label if provided
        if annotation_update.label_id is not None:
            if campaign is not None:
                validate_label_id(campaign, annotation_update.label_id)
            annotation.label_id = annotation_update.label_id

        # Update comment if provided (allow empty string to clear)
        if annotation_update.comment is not None:
            annotation.comment = annotation_update.comment

        # Update confidence if provided
        if annotation_update.confidence is not None:
            annotation.confidence = annotation_update.confidence

        if annotation_update.flagged_for_review is not None:
            annotation.flagged_for_review = annotation_update.flagged_for_review
            if not annotation_update.flagged_for_review:
                annotation.flag_comment = None
        if annotation_update.flag_comment is not None and annotation.flagged_for_review:
            annotation.flag_comment = annotation_update.flag_comment

        db.commit()
        db.refresh(annotation)

        return annotation

    except Exception as e:
        db.rollback()
        logger.exception("Failed to update annotation")
        raise HTTPException(status_code=400, detail="Failed to update annotation") from e


# ============================================================================
# Annotation Retrieval
# ============================================================================


def get_annotations_for_campaign(
    db: Session,
    campaign_id: int,
) -> list[Annotation]:
    """
    Retrieve all annotations for a specific campaign with eager loading.

    Returns both task-based and standalone annotations for the given campaign.

    Args:
        db: Database session
        campaign_id: ID of campaign to retrieve annotations for

    Returns:
        List of all annotation records for the campaign
    """
    stmt = (
        select(Annotation)
        .where(Annotation.campaign_id == campaign_id)
        .options(
            joinedload(Annotation.geometry),
            joinedload(Annotation.creator),
        )
    )
    annotations = db.scalars(stmt).unique().all()

    return list(annotations)


def delete_annotation(
    db: Session,
    annotation_id: int,
    campaign_id: int,
    user_id: UUID | None = None,
    campaign: Campaign | None = None,
) -> None:
    """
    Delete a specific annotation from a campaign.

    If the annotation is linked to a task item, the task status is updated
    to 'pending' to allow re-annotation.

    In public campaigns, only the annotation creator can delete their annotations.

    Args:
        db: Database session
        annotation_id: ID of annotation to delete
        campaign_id: ID of campaign (used for validation)
        user_id: ID of user requesting deletion (for ownership check)
        campaign: Campaign object (for public campaign ownership check)

    Raises:
        HTTPException: If annotation not found, doesn't belong to campaign, or ownership violated
    """
    # Get annotation and verify it belongs to the campaign
    annotation = db.execute(
        select(Annotation).where(
            Annotation.id == annotation_id,
            Annotation.campaign_id == campaign_id,
        )
    ).scalar_one_or_none()

    if annotation is None:
        raise HTTPException(status_code=404, detail="Annotation not found in this campaign")

    # In public campaigns, only the creator or a campaign admin can delete annotations
    if (
        campaign
        and campaign.is_public
        and user_id
        and annotation.created_by_user_id != user_id
        and not _is_campaign_admin(db, user_id, campaign.id)
    ):
        raise HTTPException(
            status_code=403,
            detail="You can only delete your own annotations",
        )

    try:
        # If linked to a task, reset task status to pending
        if annotation.annotation_task_id is not None:
            assignment = db.execute(
                select(AnnotationTaskAssignment).where(
                    AnnotationTaskAssignment.task_id == annotation.annotation_task_id,
                    AnnotationTaskAssignment.user_id == annotation.created_by_user_id,
                )
            ).scalar_one_or_none()

            if assignment:
                assignment.status = ANNOTATION_TASK_STATUS_PENDING
                db.add(assignment)  # Explicitly add to session to ensure update is tracked

        # Delete the annotation
        db.delete(annotation)
        db.commit()

    except Exception as e:
        db.rollback()
        logger.exception("Failed to delete annotation")
        raise HTTPException(status_code=500, detail="Failed to delete annotation") from e


def delete_annotations_bulk(
    db: Session,
    annotation_ids: list[int],
    campaign: Campaign,
    user_id: UUID,
) -> int:
    """
    Delete multiple annotations from a campaign in one transaction.

    Mirrors `delete_annotation` semantics: in public campaigns, non-admins can
    only delete their own annotations. Task-linked annotations have their
    per-user assignment status reset to 'pending' so the task re-opens.

    Returns the number of annotations actually deleted.
    """
    if not annotation_ids:
        return 0

    annotations = db.scalars(
        select(Annotation).where(
            Annotation.id.in_(annotation_ids),
            Annotation.campaign_id == campaign.id,
        )
    ).all()

    found_ids = {a.id for a in annotations}
    missing = set(annotation_ids) - found_ids
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Annotations not found in campaign: {sorted(missing)}",
        )

    # Public-campaign ownership check applies whenever the requester isn't an admin
    if campaign.is_public and not _is_campaign_admin(db, user_id, campaign.id):
        not_owned = [a.id for a in annotations if a.created_by_user_id != user_id]
        if not_owned:
            raise HTTPException(
                status_code=403,
                detail=f"You can only delete your own annotations: {sorted(not_owned)}",
            )

    try:
        # Reset assignment.status -> pending for any task-linked deletions, in
        # one round trip rather than N.
        task_user_pairs = [
            (a.annotation_task_id, a.created_by_user_id)
            for a in annotations
            if a.annotation_task_id is not None
        ]
        if task_user_pairs:
            task_ids = {tid for tid, _ in task_user_pairs}
            user_ids = {uid for _, uid in task_user_pairs}
            pair_set = set(task_user_pairs)
            assignments = db.scalars(
                select(AnnotationTaskAssignment).where(
                    AnnotationTaskAssignment.task_id.in_(task_ids),
                    AnnotationTaskAssignment.user_id.in_(user_ids),
                )
            ).all()
            for assignment in assignments:
                if (assignment.task_id, assignment.user_id) in pair_set:
                    assignment.status = ANNOTATION_TASK_STATUS_PENDING

        for annotation in annotations:
            db.delete(annotation)

        db.commit()
        return len(annotations)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("Failed to bulk-delete annotations")
        raise HTTPException(status_code=500, detail="Failed to delete annotations") from e

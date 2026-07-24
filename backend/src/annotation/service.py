import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException
from pydantic import TypeAdapter
from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session, joinedload

from src.annotation.constants import (
    ANNOTATION_TASK_STATUS_DONE,
    ANNOTATION_TASK_STATUS_PENDING,
    ANNOTATION_TASK_STATUS_SKIPPED,
    CLAIM_TTL_MINUTES,
)
from src.annotation.forms import FormValidationError, validate_form_values
from src.annotation.geometries import (
    delete_orphan_geometries,
    delete_rows_and_orphan_geometries,
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
from src.annotation.tiles import build_mvt_query
from src.campaigns.form_fields import FormField
from src.campaigns.models import Campaign, CampaignUser
from src.campaigns.policy import (
    build_policy_context,
    context_from_role_map,
    counts_toward_completion,
    get_campaign_role_map,
    get_labelling_policy,
    get_platform_admin_ids,
    is_allowed,
    is_authoritative_reviewer,
    is_platform_admin,
)
from src.campaigns.schemas import LabellingPolicy
from src.config import get_settings

FORM_FIELDS_ADAPTER: TypeAdapter[list[FormField]] = TypeAdapter(list[FormField])

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


def bump_campaign_annotations_version(db: Session, campaign_id: int) -> None:
    """Increment the campaign's annotation version counter.

    Issued in the same transaction as an annotation mutation so the new value
    commits atomically with the change. The counter is the cache-busting key in
    annotation vector-tile URLs; any change invalidates the affected tiles.
    """
    db.execute(
        update(Campaign)
        .where(Campaign.id == campaign_id)
        .values(annotations_version=Campaign.annotations_version + 1)
    )


def validate_label_id(campaign: Campaign, label_id: int) -> None:
    """Raise HTTP 400 if label_id is not a key in the campaign's label set."""
    labels = (campaign.settings.labels if campaign.settings else None) or {}
    if str(label_id) not in labels:
        raise HTTPException(
            status_code=400,
            detail=f"label_id {label_id} is not a label of this campaign",
        )


def campaign_form_fields(campaign: Campaign) -> list[FormField]:
    """Parse a campaign's field definitions, guarding the case where the
    campaign has no settings row at all (not just an empty form_fields)."""
    raw = campaign.settings.form_fields if campaign.settings else []
    return FORM_FIELDS_ADAPTER.validate_python(raw or [])


def validate_annotation_form_values(
    campaign: Campaign, form_values: dict | None, *, enforce_required: bool
) -> dict | None:
    """Validate/normalize submitted form values against the campaign's field
    definitions, raising HTTP 400 on any FormValidationError."""
    fields = campaign_form_fields(campaign)
    try:
        return validate_form_values(fields, form_values, enforce_required=enforce_required)
    except FormValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc


def _require_explore_access(db: Session, campaign: Campaign, user_id: UUID) -> None:
    """Raise HTTP 403 unless the user may do explorative (standalone,
    free-drawn) labelling in this campaign, per the `explore` policy axis."""
    policy = get_labelling_policy(campaign)
    ctx = build_policy_context(db, campaign, user_id)
    if not is_allowed(policy.explore, ctx):
        raise HTTPException(
            status_code=403,
            detail="You are not allowed to create standalone annotations in this campaign",
        )


# ============================================================================
# Task Retrieval
# ============================================================================


def get_annotation_task_by_id(
    db: Session,
    task_id: int,
    campaign: Campaign,
) -> AnnotationTask | None:
    """
    Retrieve a single annotation task by ID, ensuring it belongs to the campaign.

    Args:
        db: Database session
        task_id: ID of the task
        campaign: The campaign the task must belong to (routers pass the
            object resolved by their access dependency).

    Returns:
        Annotation task item or None if not found
    """
    stmt = (
        select(AnnotationTask)
        .where(
            AnnotationTask.id == task_id,
            AnnotationTask.campaign_id == campaign.id,
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
        _attach_counts_toward_completion(db, campaign, [task])
    return task


def get_annotation_tasks_for_campaign(
    db: Session,
    campaign: Campaign,
) -> list[AnnotationTask]:
    """
    Retrieve all annotation tasks for a campaign with eager loading
    to avoid N+1 query problem.

    This loads all related data (geometry, assignments, annotations)
    in a single optimized query.

    Args:
        db: Database session
        campaign: The campaign whose tasks to load.

    Returns:
        List of annotation task items with all relationships loaded
    """
    stmt = (
        select(AnnotationTask)
        .where(AnnotationTask.campaign_id == campaign.id)
        .options(
            joinedload(AnnotationTask.geometry),
            joinedload(AnnotationTask.assignments).joinedload(AnnotationTaskAssignment.user),
            joinedload(AnnotationTask.annotations).joinedload(Annotation.creator),
        )
        .order_by(AnnotationTask.annotation_number)
    )

    tasks = list(db.scalars(stmt).unique().all())
    _attach_has_embedding(db, tasks)
    _attach_counts_toward_completion(db, campaign, tasks)
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


def _counting_context(
    annotation: Annotation,
    policy: LabellingPolicy,
    role_map: dict[UUID, tuple[bool, bool]],
    admin_ids: set[UUID],
    assigned_ids: set[UUID],
) -> bool:
    """Whether one task-linked annotation's label counts toward its task's
    completion, per the campaign's labelling policy."""
    ctx = context_from_role_map(
        annotation.created_by_user_id,
        role_map,
        admin_ids,
        is_assigned=annotation.created_by_user_id in assigned_ids,
    )
    return counts_toward_completion(policy, bool(assigned_ids), ctx)


def _attach_counts_toward_completion(
    db: Session, campaign: Campaign, tasks: list[AnnotationTask]
) -> None:
    """Set `counts_toward_completion` on every annotation of every task, via
    one role-map lookup for the whole campaign instead of a per-annotation
    query. Mirrors `_attach_has_embedding`: the flag is set directly on the
    ORM instance so `AnnotationFromTaskOut` (from_attributes) picks it up
    without an extra fetch.
    """
    if not tasks:
        return
    policy = get_labelling_policy(campaign)
    role_map = get_campaign_role_map(db, campaign.id)
    author_ids = {ann.created_by_user_id for task in tasks for ann in (task.annotations or [])}
    admin_ids = get_platform_admin_ids(db, author_ids)

    for task in tasks:
        assigned_ids = {a.user_id for a in (task.assignments or [])}
        for ann in task.annotations or []:
            ann.counts_toward_completion = _counting_context(
                ann, policy, role_map, admin_ids, assigned_ids
            )


def attach_counts_toward_completion_flat(
    db: Session, campaign: Campaign, annotations: list[Annotation]
) -> None:
    """Same as `_attach_counts_toward_completion` but for a flat annotation
    list where each task-linked annotation carries its own `.annotation_task`
    (with `.assignments` loaded) rather than the nested task-tree shape.
    Used by the plain annotation list/fetch endpoints and by exports
    (annotation/io.py). Standalone annotations are left untouched, so
    `AnnotationFromTaskOut.counts_toward_completion` reads back as its None
    default - "not applicable", not "doesn't count".
    """
    task_linked = [a for a in annotations if a.annotation_task_id is not None and a.annotation_task]
    if not task_linked:
        return
    policy = get_labelling_policy(campaign)
    role_map = get_campaign_role_map(db, campaign.id)
    admin_ids = get_platform_admin_ids(db, {a.created_by_user_id for a in task_linked})

    for ann in task_linked:
        assigned_ids = {a.user_id for a in (ann.annotation_task.assignments or [])}
        ann.counts_toward_completion = _counting_context(
            ann, policy, role_map, admin_ids, assigned_ids
        )


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

    campaign = db.get(Campaign, annotation_task.campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")

    policy = get_labelling_policy(campaign)
    has_assignments = bool(annotation_task.assignments)
    ctx = build_policy_context(db, campaign, user_id, task=annotation_task)
    axis = policy.assigned_tasks if has_assignments else policy.unassigned_tasks
    if not is_allowed(axis, ctx):
        raise HTTPException(
            status_code=403,
            detail=(
                "You are not allowed to annotate assigned tasks in this campaign"
                if has_assignments
                else "You are not allowed to annotate unassigned tasks in this campaign"
            ),
        )

    if annotation_create.is_authoritative and not is_authoritative_reviewer(
        db, annotation_task.campaign_id, user_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Only campaign admins or authoritative reviewers can submit authoritative annotations",
        )

    if annotation_create.label_id is not None:
        validate_label_id(campaign, annotation_create.label_id)

    normalized_form_values = validate_annotation_form_values(
        campaign,
        annotation_create.form_values,
        enforce_required=annotation_create.label_id is not None,
    )

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
            existing_annotation.form_values = normalized_form_values
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
                form_values=normalized_form_values,
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
        annotation.counts_toward_completion = counts_toward_completion(policy, has_assignments, ctx)
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
    _require_explore_access(db, campaign, user_id)

    if annotation_create.label_id is not None:
        validate_label_id(campaign, annotation_create.label_id)

    normalized_form_values = validate_annotation_form_values(
        campaign, annotation_create.form_values, enforce_required=True
    )

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
            form_values=normalized_form_values,
            imagery_slice_id=annotation_create.imagery_slice_id,
            imagery_source_name=annotation_create.imagery_source_name,
            imagery_start_date=annotation_create.imagery_start_date,
            imagery_end_date=annotation_create.imagery_end_date,
        )
        db.add(annotation)
        bump_campaign_annotations_version(db, campaign.id)
        db.commit()
        db.refresh(annotation)

        return annotation

    except Exception as e:
        db.rollback()
        logger.exception("Failed to create annotation")
        raise HTTPException(status_code=400, detail="Failed to create annotation") from e


def create_annotations_bulk(
    db: Session,
    campaign: Campaign,
    annotations_create: list[AnnotationCreate],
    user_id: UUID,
) -> int:
    """
    Create many standalone annotations in a single transaction.

    Used when labelling many vector features at once (e.g. box-selecting features
    from a PMTiles layer): one request and one ``annotations_version`` bump instead
    of one round trip per feature. Returns the number of annotations created.
    """
    if not annotations_create:
        return 0

    _require_explore_access(db, campaign, user_id)

    # Validate the distinct labels once rather than per-annotation.
    for label_id in {a.label_id for a in annotations_create if a.label_id is not None}:
        validate_label_id(campaign, label_id)

    # Parse the campaign's field definitions once and reuse across items,
    # rather than re-parsing on every validate_annotation_form_values call.
    fields = campaign_form_fields(campaign)
    try:
        normalized_form_values = [
            validate_form_values(fields, a.form_values, enforce_required=True)
            for a in annotations_create
        ]
    except FormValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc

    try:
        geometries = [
            AnnotationGeometry(geometry=f"SRID=4326;{a.geometry_wkt}") for a in annotations_create
        ]
        db.add_all(geometries)
        db.flush()  # assign geometry ids

        annotations = [
            Annotation(
                geometry_id=geometry.id,
                label_id=a.label_id,
                comment=a.comment,
                campaign_id=campaign.id,
                created_by_user_id=user_id,
                confidence=a.confidence,
                annotation_task_id=None,  # Standalone annotations
                flagged_for_review=a.flagged_for_review or False,
                flag_comment=a.flag_comment if a.flagged_for_review else None,
                form_values=form_values,
                imagery_slice_id=a.imagery_slice_id,
                imagery_source_name=a.imagery_source_name,
                imagery_start_date=a.imagery_start_date,
                imagery_end_date=a.imagery_end_date,
            )
            for a, geometry, form_values in zip(
                annotations_create, geometries, normalized_form_values, strict=True
            )
        ]
        db.add_all(annotations)
        bump_campaign_annotations_version(db, campaign.id)
        db.commit()
        return len(annotations)

    except Exception as e:
        db.rollback()
        logger.exception("Failed to bulk-create annotations")
        raise HTTPException(status_code=400, detail="Failed to create annotations") from e


def update_annotation(
    db: Session,
    annotation_id: int,
    annotation_update: AnnotationUpdate,
    user_id: UUID,
    campaign: Campaign,
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
    # Scoped to the campaign - without this, an annotation from any campaign
    # platform-wide would be editable through this endpoint, and the policy /
    # ownership checks below would evaluate against the wrong campaign.
    query = select(Annotation).where(
        Annotation.id == annotation_id, Annotation.campaign_id == campaign.id
    )
    annotation = db.execute(query).scalar_one_or_none()

    if annotation is None:
        raise HTTPException(status_code=404, detail="Annotation not found")

    _require_explore_access(db, campaign, user_id)

    # In public campaigns, only the creator or a campaign admin can update annotations
    if (
        campaign.is_public
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
            old_geometry_id = annotation.geometry_id
            new_geometry = AnnotationGeometry(
                geometry=f"SRID=4326;{annotation_update.geometry_wkt}"
            )
            db.add(new_geometry)
            db.flush()  # Get new geometry ID
            annotation.geometry_id = new_geometry.id
            delete_orphan_geometries(db, [old_geometry_id])

            # The imagery snapshot reflects what was viewed during this geometry
            # edit, so it only refreshes alongside a geometry change.
            annotation.imagery_slice_id = annotation_update.imagery_slice_id
            annotation.imagery_source_name = annotation_update.imagery_source_name
            annotation.imagery_start_date = annotation_update.imagery_start_date
            annotation.imagery_end_date = annotation_update.imagery_end_date

        # Update label if provided
        if annotation_update.label_id is not None:
            validate_label_id(campaign, annotation_update.label_id)
            annotation.label_id = annotation_update.label_id

        # Patch semantics like every other field: omitting form_values keeps
        # the stored answers, sending {} clears them (normalizes to None).
        # A label edit revalidates the stored answers too, so labelling an
        # annotation cannot slip past required fields by omitting form_values.
        # Edits that touch neither are left alone: annotations predating a new
        # required field stay editable.
        if annotation_update.form_values is not None or annotation_update.label_id is not None:
            incoming = annotation_update.form_values
            annotation.form_values = validate_annotation_form_values(
                campaign,
                incoming if incoming is not None else annotation.form_values,
                enforce_required=annotation.label_id is not None,
            )

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

        bump_campaign_annotations_version(db, annotation.campaign_id)
        db.commit()
        db.refresh(annotation)

        return annotation

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception("Failed to update annotation")
        raise HTTPException(status_code=400, detail="Failed to update annotation") from e


# ============================================================================
# Annotation Retrieval
# ============================================================================


def get_annotations_for_campaign(
    db: Session,
    campaign: Campaign,
) -> list[Annotation]:
    """
    Retrieve all annotations for a specific campaign with eager loading.

    Returns both task-based and standalone annotations for the given campaign.

    Args:
        db: Database session
        campaign: The campaign to retrieve annotations for - also used to
            compute `counts_toward_completion` on task-linked annotations.

    Returns:
        List of all annotation records for the campaign
    """
    stmt = (
        select(Annotation)
        .where(Annotation.campaign_id == campaign.id)
        .options(
            joinedload(Annotation.geometry),
            joinedload(Annotation.creator),
            joinedload(Annotation.annotation_task).selectinload(AnnotationTask.assignments),
        )
    )
    annotations = list(db.scalars(stmt).unique().all())
    attach_counts_toward_completion_flat(db, campaign, annotations)
    return annotations


def get_annotation_by_id(
    db: Session,
    annotation_id: int,
    campaign: Campaign,
) -> Annotation | None:
    """Fetch one annotation (with geometry + creator) scoped to a campaign.

    Used by the open-mode tiled view to pull a single annotation's full-
    resolution geometry when the user clicks a tile feature to edit it.
    """
    stmt = (
        select(Annotation)
        .where(
            Annotation.id == annotation_id,
            Annotation.campaign_id == campaign.id,
        )
        .options(
            joinedload(Annotation.geometry),
            joinedload(Annotation.creator),
            joinedload(Annotation.annotation_task).selectinload(AnnotationTask.assignments),
        )
    )
    annotation = db.scalars(stmt).unique().first()
    if annotation is not None:
        attach_counts_toward_completion_flat(db, campaign, [annotation])
    return annotation


def render_annotation_tile(
    db: Session,
    campaign_id: int,
    z: int,
    x: int,
    y: int,
) -> bytes:
    """Render one MVT tile of a campaign's annotations as protobuf bytes.

    Returns an empty tile (zero-length bytes) when no geometry falls in the
    tile, which OpenLayers treats as an empty tile. Zoom levels below
    ``ANNOTATION_TILE_MIN_ZOOM`` also return empty without touching the DB, so a
    whole-country view of dense parcels can't trigger a multi-MB, CPU-heavy query.
    """
    if z < get_settings().ANNOTATION_TILE_MIN_ZOOM:
        return b""
    sql, params = build_mvt_query(z=z, x=x, y=y, campaign_id=campaign_id)
    tile = db.execute(text(sql), params).scalar_one()
    return bytes(tile) if tile is not None else b""


def get_annotation_ids_in_bbox(
    db: Session,
    campaign_id: int,
    minx: float,
    miny: float,
    maxx: float,
    maxy: float,
) -> list[int]:
    """Return ids of a campaign's annotations whose geometry intersects a bbox.

    Backs box/multi-select against the tiled display: the geometry never leaves
    the server, only the ids needed to highlight and bulk-delete. The filter
    keeps ``g.geometry`` bare so the GiST index is used.
    """
    sql = text(
        """
        SELECT a.id
        FROM data.annotations a
        JOIN data.annotation_geometries g ON g.id = a.geometry_id
        WHERE a.campaign_id = :campaign_id
          AND g.geometry && ST_MakeEnvelope(:minx, :miny, :maxx, :maxy, 4326)
        """
    )
    rows = db.execute(
        sql,
        {
            "campaign_id": campaign_id,
            "minx": minx,
            "miny": miny,
            "maxx": maxx,
            "maxy": maxy,
        },
    ).scalars()
    return list(rows)


def get_campaign_annotations_extent(
    db: Session,
    campaign_id: int,
) -> tuple[float, float, float, float] | None:
    """Return the bounding box (minx, miny, maxx, maxy) of a campaign's
    annotations, or None when the campaign has none. Used for fit-to-bounds
    without loading every geometry into the client."""
    sql = text(
        """
        SELECT
            ST_XMin(ext), ST_YMin(ext), ST_XMax(ext), ST_YMax(ext)
        FROM (
            SELECT ST_Extent(g.geometry) AS ext
            FROM data.annotations a
            JOIN data.annotation_geometries g ON g.id = a.geometry_id
            WHERE a.campaign_id = :campaign_id
        ) AS e
        """
    )
    row = db.execute(sql, {"campaign_id": campaign_id}).first()
    if row is None or row[0] is None:
        return None
    return (float(row[0]), float(row[1]), float(row[2]), float(row[3]))


def get_annotation_density(
    db: Session,
    campaign_id: int,
    target_cells: int = 48,
) -> list[dict]:
    """Aggregate a campaign's annotation centroids into a coarse grid for the
    minimap distribution overview.

    The grid is sized so the campaign's wider extent spans ~``target_cells``
    cells; each returned cell carries its centre (EPSG:4326) and the count of
    annotations in it. One indexed pass, tiny payload - independent of how many
    annotations exist, so it scales where per-feature dots would not.
    """
    extent = get_campaign_annotations_extent(db, campaign_id)
    if extent is None:
        return []
    minx, miny, maxx, maxy = extent
    span = max(maxx - minx, maxy - miny)
    grid = span / target_cells if span > 0 else 0.01

    sql = text(
        """
        SELECT floor(ST_X(c) / :grid) * :grid + :grid / 2 AS lon,
               floor(ST_Y(c) / :grid) * :grid + :grid / 2 AS lat,
               count(*) AS n
        FROM (
            SELECT ST_Centroid(g.geometry) AS c
            FROM data.annotations a
            JOIN data.annotation_geometries g ON g.id = a.geometry_id
            WHERE a.campaign_id = :campaign_id
        ) AS pts
        GROUP BY 1, 2
        """
    )
    rows = db.execute(sql, {"campaign_id": campaign_id, "grid": grid}).all()
    return [{"lon": float(r[0]), "lat": float(r[1]), "count": int(r[2])} for r in rows]


def delete_annotation(
    db: Session,
    annotation_id: int,
    campaign: Campaign,
    user_id: UUID | None = None,
) -> None:
    """
    Delete a specific annotation from a campaign.

    If the annotation is linked to a task item, the task status is updated
    to 'pending' to allow re-annotation.

    In public campaigns, only the annotation creator can delete their annotations.

    Args:
        db: Database session
        annotation_id: ID of annotation to delete
        campaign: The campaign the annotation must belong to (also used for
            the public campaign ownership check)
        user_id: ID of user requesting deletion (for ownership check)

    Raises:
        HTTPException: If annotation not found, doesn't belong to campaign, or ownership violated
    """
    # Get annotation and verify it belongs to the campaign
    annotation = db.execute(
        select(Annotation).where(
            Annotation.id == annotation_id,
            Annotation.campaign_id == campaign.id,
        )
    ).scalar_one_or_none()

    if annotation is None:
        raise HTTPException(status_code=404, detail="Annotation not found in this campaign")

    # In public campaigns, only the creator or a campaign admin can delete annotations
    if (
        campaign.is_public
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

        delete_rows_and_orphan_geometries(db, [annotation])
        bump_campaign_annotations_version(db, campaign.id)
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

        delete_rows_and_orphan_geometries(db, annotations)

        bump_campaign_annotations_version(db, campaign.id)
        db.commit()
        return len(annotations)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("Failed to bulk-delete annotations")
        raise HTTPException(status_code=500, detail="Failed to delete annotations") from e

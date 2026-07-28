import logging
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session, joinedload

from src.annotation.completion import (
    attach_counts_toward_completion_flat,
    attach_counts_toward_completion_tree,
)
from src.annotation.constants import (
    ANNOTATION_TASK_STATUS_DONE,
    ANNOTATION_TASK_STATUS_PENDING,
    ANNOTATION_TASK_STATUS_SKIPPED,
)
from src.annotation.forms import (
    FormValidationError,
    campaign_form_fields,
    validate_form_values,
)
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
    AnnotationTaskOut,
    AnnotationTaskSubmitResponse,
    AnnotationUpdate,
)
from src.campaigns.models import Campaign, CampaignUser
from src.campaigns.policy import (
    build_policy_context,
    counts_toward_completion,
    get_labelling_policy,
    is_allowed,
    is_authoritative_reviewer,
    is_platform_admin,
)

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
        attach_counts_toward_completion_tree(db, campaign, [task])
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
    attach_counts_toward_completion_tree(db, campaign, tasks)
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


def _flag_comment_for(flagged_for_review: bool | None, flag_comment: str | None) -> str | None:
    """Enforce the flag invariant: `flag_comment` may only survive when
    `flagged_for_review` is true (mirrors the DB CheckConstraint
    `annotations_flag_comment_requires_flag`). The single place this rule is
    expressed in Python - every write path below routes through it.
    """
    return flag_comment if flagged_for_review else None


def annotation_values(
    *,
    label_id: int | None,
    comment: str | None,
    confidence: int | None,
    flagged_for_review: bool | None,
    flag_comment: str | None,
    form_values: dict | None = None,
    is_authoritative: bool | None = None,
) -> dict:
    """Column values shared by every annotation write path (fresh creates and
    the resubmit-in-place update in `add_annotation_for_task`).

    `is_authoritative` is omitted from the result when None rather than
    defaulted to False, so a caller doing a partial update (an already
    existing annotation) can apply this dict via `setattr` in a loop without
    resetting a field the request didn't touch.
    """
    flagged = flagged_for_review or False
    values: dict = {
        "label_id": label_id,
        "comment": comment,
        "confidence": confidence,
        "flagged_for_review": flagged,
        "flag_comment": _flag_comment_for(flagged, flag_comment),
        "form_values": form_values,
    }
    if is_authoritative is not None:
        values["is_authoritative"] = is_authoritative
    return values


def _standalone_annotation(
    geometry_id: int,
    campaign: Campaign,
    user_id: UUID,
    item: AnnotationCreate,
    form_values: dict | None,
) -> Annotation:
    """Build one task-less Annotation row. Shared by `create_annotation` and
    `create_annotations_bulk` so the column list lives in one place even
    though the two callers insert via different DB calls (single vs batch)."""
    return Annotation(
        geometry_id=geometry_id,
        campaign_id=campaign.id,
        created_by_user_id=user_id,
        annotation_task_id=None,  # Standalone annotation
        imagery_slice_id=item.imagery_slice_id,
        imagery_source_name=item.imagery_source_name,
        imagery_start_date=item.imagery_start_date,
        imagery_end_date=item.imagery_end_date,
        **annotation_values(
            label_id=item.label_id,
            comment=item.comment,
            confidence=item.confidence,
            flagged_for_review=item.flagged_for_review,
            flag_comment=item.flag_comment,
            form_values=form_values,
        ),
    )


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
            values = annotation_values(
                label_id=annotation_create.label_id,
                comment=annotation_create.comment,
                confidence=annotation_create.confidence,
                flagged_for_review=annotation_create.flagged_for_review,
                flag_comment=annotation_create.flag_comment,
                form_values=normalized_form_values,
                is_authoritative=annotation_create.is_authoritative,
            )
            for field, value in values.items():
                setattr(existing_annotation, field, value)
            existing_annotation.created_by_user_id = user_id
            if assignment:
                assignment.status = ANNOTATION_TASK_STATUS_DONE
            annotation = existing_annotation
    else:  # CREATE
        # Create new annotation if label or comment provided
        if annotation_create.label_id is not None or annotation_create.comment is not None:
            annotation = Annotation(
                geometry_id=annotation_task.geometry_id,
                annotation_task_id=annotation_task.id,
                campaign_id=annotation_task.campaign_id,
                created_by_user_id=user_id,
                **annotation_values(
                    label_id=annotation_create.label_id,
                    comment=annotation_create.comment,
                    confidence=annotation_create.confidence,
                    flagged_for_review=annotation_create.flagged_for_review,
                    flag_comment=annotation_create.flag_comment,
                    form_values=normalized_form_values,
                    is_authoritative=annotation_create.is_authoritative,
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
        annotation.counts_toward_completion = counts_toward_completion(policy, has_assignments, ctx)
        return annotation


def _get_task_for_annotating(
    db: Session, task_id: int, campaign: Campaign
) -> AnnotationTask | None:
    """Fetch a bare task scoped to the campaign, with just enough loaded
    (assignments) for `add_annotation_for_task`'s policy checks - unlike
    `get_annotation_task_by_id`, this skips the full annotations/geometry
    joinedload tree and the counts/has_embedding attachment, all of which
    would be thrown away by the mutation that follows.
    """
    stmt = (
        select(AnnotationTask)
        .where(
            AnnotationTask.id == task_id,
            AnnotationTask.campaign_id == campaign.id,
        )
        .options(joinedload(AnnotationTask.assignments))
    )
    return db.scalars(stmt).unique().first()


def submit_task_annotation(
    db: Session,
    campaign: Campaign,
    task_id: int,
    annotation_create: AnnotationFromTaskCreate,
    user_id: UUID,
) -> AnnotationTaskSubmitResponse:
    """Submit (or skip) a task annotation and report the task's resulting status.

    Composes `add_annotation_for_task` with a single post-commit fetch of the
    task's full decorated tree, used to compute `task_status` and
    `assignment_status` - the one fetch that matters is the one reflecting
    what was just committed.
    """
    task = _get_task_for_annotating(db, task_id, campaign)
    if task is None:
        raise HTTPException(
            status_code=404,
            detail="Annotation task not found in this campaign",
        )

    annotation = add_annotation_for_task(
        db=db,
        annotation_task=task,
        annotation_create=annotation_create,
        user_id=user_id,
    )

    refreshed_task = get_annotation_task_by_id(db, task_id, campaign)
    task_out = AnnotationTaskOut.model_validate(refreshed_task)
    return AnnotationTaskSubmitResponse(
        annotation=annotation,
        task_status=task_out.task_status,
        assignment_status=get_user_assignment_status(refreshed_task, user_id),
    )


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
        annotation = _standalone_annotation(
            geometry.id, campaign, user_id, annotation_create, normalized_form_values
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
            _standalone_annotation(geometry.id, campaign, user_id, a, form_values)
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
            annotation.flag_comment = _flag_comment_for(
                annotation.flagged_for_review, annotation.flag_comment
            )
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


def delete_annotation_with_status(
    db: Session,
    annotation_id: int,
    campaign: Campaign,
    user_id: UUID,
) -> AnnotationTaskSubmitResponse | None:
    """Delete an annotation and, if it was task-linked, report the task's
    resulting status; otherwise None.

    The task id has to be looked up before the delete (the annotation's FK is
    gone afterwards); the task's decorated tree is then fetched once, after
    the delete has committed, to compute `task_status`/`assignment_status`.
    """
    task_id = get_annotation_task_id_for_annotation(db, annotation_id, campaign.id)

    delete_annotation(db, annotation_id, campaign, user_id)

    if task_id is None:
        return None

    refreshed_task = get_annotation_task_by_id(db, task_id, campaign)
    if refreshed_task is None:
        return None

    task_out = AnnotationTaskOut.model_validate(refreshed_task)
    return AnnotationTaskSubmitResponse(
        annotation=None,
        task_status=task_out.task_status,
        assignment_status=get_user_assignment_status(refreshed_task, user_id),
    )


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

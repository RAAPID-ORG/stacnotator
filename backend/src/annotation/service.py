import logging
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import String, exists, func, select
from sqlalchemy.orm import Session, joinedload

from src.annotation.forms import (
    FormValidationError,
    campaign_form_fields,
    validate_form_values,
)
from src.annotation.models import Annotation
from src.annotation.schemas import (
    AnnotationCreate,
    AnnotationFacetsOut,
    AnnotationListItemOut,
    AnnotationSort,
    AnnotationsPageOut,
    AnnotationUpdate,
    AnnotatorFacet,
    ConfidenceFacet,
    LabelFacet,
    SliceComment,
    TaskAnswerCreate,
    normalize_slice_comments,
)
from src.annotation.sync import bump_campaign_annotations_version, record_annotation_deletions
from src.auth.models import User
from src.campaigns.models import Campaign
from src.campaigns.policy import (
    build_policy_context,
    counts_toward_completion,
    get_labelling_policy,
    is_allowed,
)
from src.geometry import ewkt
from src.tasks.completion import (
    attach_counts_toward_completion,
)
from src.tasks.models import Task
from src.tasks.schemas import TaskOut, TaskStatusOut, TaskSubmitResponse
from src.tasks.service import (
    get_task,
    get_user_assignment_status,
    require_task_access,
    task_for_annotating,
)
from src.tasks.status import (
    resolve_task_outcome,
)

logger = logging.getLogger(__name__)


def _require_own_annotations(
    db: Session,
    annotations: list[Annotation],
    campaign: Campaign,
    user_id: UUID,
    verb: str,
) -> None:
    """Someone else's annotation is theirs unless the campaign says otherwise.

    Its author may always change it. Who else may is the ``modify_others``
    axis of the labelling policy, which defaults to campaign admins: being a
    member is permission to add work, not automatically to undo other
    people's, but a campaign that wants a shared canvas can say so.
    """
    not_owned = [a.id for a in annotations if a.created_by_user_id != user_id]
    if not not_owned:
        return
    policy = get_labelling_policy(campaign)
    if is_allowed(policy.modify_others, build_policy_context(db, campaign, user_id)):
        return
    raise HTTPException(
        status_code=403,
        detail=f"You can only {verb} your own annotations: {sorted(not_owned)}",
    )


def validate_label_id(campaign: Campaign, label_id: int) -> None:
    """Raise HTTP 400 if label_id is not a key in the campaign's label set."""
    if label_id not in campaign.label_names:
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
    slice_comments: list[SliceComment] | None = None,
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
        "slice_comments": normalize_slice_comments(slice_comments),
        "form_values": form_values,
    }
    if is_authoritative is not None:
        values["is_authoritative"] = is_authoritative
    return values


def _validate_origin_tasks(db: Session, campaign: Campaign, items: list[AnnotationCreate]) -> None:
    """Reject origin tasks that are not in this campaign (one query for the batch)."""
    ids = {a.origin_task_id for a in items if a.origin_task_id is not None}
    if not ids:
        return
    found = set(
        db.execute(
            select(Task.id).where(Task.campaign_id == campaign.id, Task.id.in_(ids))
        ).scalars()
    )
    if found != ids:
        raise HTTPException(status_code=400, detail="Origin task not found in this campaign")


def _require_drawing_access(
    db: Session, campaign: Campaign, user_id: UUID, output_task_ids: set[int | None]
) -> None:
    """Raise unless the user may save shapes with these draw-task links, None
    standing for a shape that answers no task. A draw task's shapes need the
    right to work that task; every other shape needs the explore axis."""
    if None in output_task_ids:
        _require_explore_access(db, campaign, user_id)
    task_ids = output_task_ids - {None}
    if not task_ids:
        return
    if campaign.task_output != "draw":
        raise HTTPException(status_code=400, detail="This campaign's tasks take no shapes")
    tasks = (
        db.scalars(
            select(Task)
            .where(Task.campaign_id == campaign.id, Task.id.in_(task_ids))
            .options(joinedload(Task.assignments))
        )
        .unique()
        .all()
    )
    if len(tasks) != len(task_ids):
        raise HTTPException(status_code=400, detail="Task not found in this campaign")
    for task in tasks:
        require_task_access(db, campaign, task, user_id)


def _standalone_annotation(
    campaign: Campaign,
    user_id: UUID,
    item: AnnotationCreate,
    form_values: dict | None,
) -> Annotation:
    return Annotation(
        geometry=ewkt(item.geometry_wkt),
        campaign_id=campaign.id,
        created_by_user_id=user_id,
        annotation_task_id=None,
        origin_task_id=item.origin_task_id,
        output_of_task_id=item.output_of_task_id,
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
            slice_comments=item.slice_comments,
            form_values=form_values,
        ),
    )


def add_annotation_for_task(
    db: Session,
    annotation_task: Task,
    annotation_create: TaskAnswerCreate,
    user_id: UUID,
) -> Annotation:
    """
    Create or update this user's annotation on a task.

    One row per (task, user), created or updated in place. A submission with
    no label is a skip and is stored as a label-less annotation rather than
    left out: it is the only record that the user acted, and what the task's
    status and the annotator's time are read from.

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
    ctx = require_task_access(db, campaign, annotation_task, user_id)

    if annotation_create.is_authoritative and not ctx.is_authoritative:
        raise HTTPException(
            status_code=403,
            detail="Only campaign admins or authoritative reviewers can submit authoritative annotations",
        )

    try:
        outcome = resolve_task_outcome(
            campaign.task_output, annotation_create.label_id, annotation_create.outcome
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if outcome in ("drawn", "none_found"):
        has_shapes = db.scalar(
            select(
                exists().where(
                    Annotation.output_of_task_id == annotation_task.id,
                    Annotation.created_by_user_id == user_id,
                )
            )
        )
        if outcome == "drawn" and not has_shapes:
            raise HTTPException(
                status_code=400,
                detail="Draw at least one shape for this task, or mark it as nothing here",
            )
        if outcome == "none_found" and has_shapes:
            raise HTTPException(
                status_code=400,
                detail="You drew shapes for this task: press Done, or delete them first",
            )

    if annotation_create.label_id is not None:
        validate_label_id(campaign, annotation_create.label_id)

    normalized_form_values = validate_annotation_form_values(
        campaign,
        annotation_create.form_values,
        enforce_required=outcome == "labelled",
    )

    # Check if annotation already exists for this task
    existing_annotation = db.execute(
        select(Annotation).where(
            Annotation.annotation_task_id == annotation_task.id,
            Annotation.created_by_user_id == user_id,
        )
    ).scalar_one_or_none()

    values = annotation_values(
        label_id=annotation_create.label_id,
        comment=annotation_create.comment,
        confidence=annotation_create.confidence,
        flagged_for_review=annotation_create.flagged_for_review,
        flag_comment=annotation_create.flag_comment,
        slice_comments=annotation_create.slice_comments,
        form_values=normalized_form_values,
        is_authoritative=annotation_create.is_authoritative,
    )
    values["outcome"] = outcome

    # A skip takes the same path: its row is the only record that this user
    # acted on the task.
    if existing_annotation:
        for field, value in values.items():
            setattr(existing_annotation, field, value)
        annotation = existing_annotation
    else:
        annotation = Annotation(
            geometry=annotation_task.geometry,
            annotation_task_id=annotation_task.id,
            campaign_id=annotation_task.campaign_id,
            created_by_user_id=user_id,
            **values,
        )
        db.add(annotation)

    if annotation_create.active_ms:
        annotation.active_seconds = (annotation.active_seconds or 0) + round(
            annotation_create.active_ms / 1000
        )

    db.commit()
    db.refresh(annotation)
    annotation.counts_toward_completion = counts_toward_completion(policy, has_assignments, ctx)
    return annotation


def submit_task_annotation(
    db: Session,
    campaign: Campaign,
    task_id: int,
    annotation_create: TaskAnswerCreate,
    user_id: UUID,
) -> TaskSubmitResponse:
    """Submit (or skip) a task annotation and report the task's resulting status.

    Composes `add_annotation_for_task` with a single post-commit fetch of the
    task's full decorated tree, used to compute `task_status` and
    `assignment_status` - the one fetch that matters is the one reflecting
    what was just committed.
    """
    task = task_for_annotating(db, task_id, campaign)
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

    refreshed_task = get_task(db, task_id, campaign)
    if refreshed_task is None:
        raise HTTPException(status_code=404, detail="Annotation task not found in this campaign")
    task_out = TaskOut.model_validate(refreshed_task)
    return TaskSubmitResponse(
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
    """Create one standalone annotation (no task row of its own)."""
    (annotation,) = create_annotations(db, campaign, [annotation_create], user_id)
    db.refresh(annotation)
    return annotation


def create_annotations(
    db: Session,
    campaign: Campaign,
    annotations_create: list[AnnotationCreate],
    user_id: UUID,
) -> list[Annotation]:
    """
    Create standalone annotations in one transaction with one annotations-version
    bump. Labelling many vector features at once goes through here as a single
    request rather than a round trip per feature.
    """
    if not annotations_create:
        return []

    _require_drawing_access(
        db, campaign, user_id, {a.output_of_task_id for a in annotations_create}
    )
    _validate_origin_tasks(db, campaign, annotations_create)
    for label_id in {a.label_id for a in annotations_create}:
        validate_label_id(campaign, label_id)

    fields = campaign_form_fields(campaign)
    try:
        normalized_form_values = [
            validate_form_values(fields, a.form_values, enforce_required=True)
            for a in annotations_create
        ]
    except FormValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc

    try:
        annotations = [
            _standalone_annotation(campaign, user_id, a, form_values)
            for a, form_values in zip(annotations_create, normalized_form_values, strict=True)
        ]
        db.add_all(annotations)
        bump_campaign_annotations_version(db, campaign.id)
        db.commit()
        return annotations

    except Exception as e:
        db.rollback()
        logger.exception("Failed to create annotations")
        raise HTTPException(status_code=400, detail="Failed to create annotations") from e


def update_annotation(
    db: Session,
    annotation_id: int,
    annotation_update: AnnotationUpdate,
    user_id: UUID,
    campaign: Campaign,
) -> Annotation:
    """Apply the fields the update carries. Somebody else's annotation needs the
    campaign's modify_others axis."""
    # Scoped to the campaign - without this, an annotation from any campaign
    # platform-wide would be editable through this endpoint, and the policy /
    # ownership checks below would evaluate against the wrong campaign.
    query = select(Annotation).where(
        Annotation.id == annotation_id, Annotation.campaign_id == campaign.id
    )
    annotation = db.execute(query).scalar_one_or_none()

    if annotation is None:
        raise HTTPException(status_code=404, detail="Annotation not found")

    _require_drawing_access(db, campaign, user_id, {annotation.output_of_task_id})

    _require_own_annotations(db, [annotation], campaign, user_id, "edit")

    try:
        # Update geometry if provided
        if annotation_update.geometry_wkt is not None:
            annotation.geometry = ewkt(annotation_update.geometry_wkt)

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

        # Patch semantics: omitting the list keeps the stored notes, sending one
        # replaces them wholesale (an empty list clears them).
        if annotation_update.slice_comments is not None:
            annotation.slice_comments = normalize_slice_comments(annotation_update.slice_comments)

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


# One page of the annotations table. Bounded because the unbounded version of this
# endpoint measured 10.2s and 70.5 MB on a campaign with 100k annotations, which is one
# worker and one connection held for ten seconds by a single page load.
MAX_ANNOTATION_PAGE = 200

_SORTS = {
    "id-asc": (Annotation.id.asc(),),
    "id-desc": (Annotation.id.desc(),),
    # NULL confidence sorts last either way: "unrated" is not "least confident".
    "confidence-asc": (Annotation.confidence.asc().nulls_last(), Annotation.id.asc()),
    "confidence-desc": (Annotation.confidence.desc().nulls_last(), Annotation.id.asc()),
    "time-asc": (Annotation.created_at.asc(), Annotation.id.asc()),
    "time-desc": (Annotation.created_at.desc(), Annotation.id.asc()),
    "default": (Annotation.id.asc(),),
}


def get_annotation_facets(db: Session, campaign: Campaign) -> AnnotationFacetsOut:
    """Campaign-wide counts for the annotations page's filters, legend and totals.

    Four grouped queries instead of shipping every annotation and counting in the
    browser. Each one is covered by the campaign_id index and returns at most a handful
    of rows, so the cost does not grow with the number of annotations.
    """
    where = Annotation.campaign_id == campaign.id

    total, with_confidence = db.execute(
        select(
            func.count(),
            func.count().filter(Annotation.confidence.isnot(None)),
        ).where(where)
    ).one()

    annotators = db.execute(
        select(
            Annotation.created_by_user_id,
            User.email,
            User.display_name,
            func.count().label("count"),
        )
        .select_from(Annotation)
        .outerjoin(User, User.id == Annotation.created_by_user_id)
        .where(where)
        .group_by(Annotation.created_by_user_id, User.email, User.display_name)
        .order_by(func.count().desc())
    ).all()

    labels = db.execute(
        select(Annotation.label_id, func.count()).where(where).group_by(Annotation.label_id)
    ).all()

    confidences = db.execute(
        select(Annotation.confidence, func.count())
        .where(where)
        .group_by(Annotation.confidence)
        .order_by(Annotation.confidence.asc().nulls_last())
    ).all()

    return AnnotationFacetsOut(
        total=total,
        with_confidence=with_confidence,
        annotators=[
            AnnotatorFacet(user_id=r[0], email=r[1], display_name=r[2], count=r[3])
            for r in annotators
        ],
        labels=[LabelFacet(label_id=r[0], count=r[1]) for r in labels],
        confidences=[ConfidenceFacet(confidence=r[0], count=r[1]) for r in confidences],
    )


def list_annotations_page(
    db: Session,
    campaign: Campaign,
    *,
    limit: int,
    offset: int,
    user_ids: list[UUID] | None = None,
    label_ids: list[int] | None = None,
    confidences: list[int] | None = None,
    flagged_only: bool = False,
    search: str | None = None,
    sort: AnnotationSort = "default",
) -> AnnotationsPageOut:
    """One filtered, ordered page of a campaign's annotations, without geometry.

    Every filter the annotations page offers is applied here rather than in the browser,
    because filtering client-side requires shipping everything first - which is the cost
    this endpoint exists to avoid.
    """
    limit = max(1, min(limit, MAX_ANNOTATION_PAGE))
    offset = max(0, offset)

    conditions = [Annotation.campaign_id == campaign.id]
    if user_ids:
        conditions.append(Annotation.created_by_user_id.in_(user_ids))
    if label_ids:
        conditions.append(Annotation.label_id.in_(label_ids))
    if confidences:
        conditions.append(Annotation.confidence.in_(confidences))
    if flagged_only:
        conditions.append(Annotation.flagged_for_review.is_(True))
    if search:
        # The table's search box matches on annotation id, as a substring.
        conditions.append(func.cast(Annotation.id, String).like(f"%{search}%"))

    total = db.execute(select(func.count()).select_from(Annotation).where(*conditions)).scalar_one()

    centroid = func.ST_Centroid(Annotation.geometry)
    rows = db.execute(
        select(
            Annotation.id,
            Annotation.label_id,
            Annotation.confidence,
            Annotation.flagged_for_review,
            Annotation.flag_comment,
            Annotation.comment,
            Annotation.annotation_task_id,
            Annotation.created_at,
            Annotation.created_by_user_id,
            User.email,
            User.display_name,
            func.ST_Y(centroid),
            func.ST_X(centroid),
            Annotation.form_values,
        )
        .select_from(Annotation)
        .outerjoin(User, User.id == Annotation.created_by_user_id)
        .where(*conditions)
        .order_by(*_SORTS[sort])
        .limit(limit)
        .offset(offset)
    ).all()

    return AnnotationsPageOut(
        items=[
            AnnotationListItemOut(
                id=r[0],
                label_id=r[1],
                confidence=r[2],
                flagged_for_review=r[3],
                flag_comment=r[4],
                comment=r[5],
                annotation_task_id=r[6],
                created_at=r[7],
                created_by_user_id=r[8],
                created_by_user_email=r[9],
                created_by_user_display_name=r[10],
                centroid_lat=r[11],
                centroid_lon=r[12],
                form_values=r[13],
            )
            for r in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


def get_annotation_by_id(
    db: Session,
    annotation_id: int,
    campaign: Campaign,
) -> Annotation | None:
    """Fetch one annotation (with geometry + creator) scoped to a campaign.

    Used by the tiled annotation view to pull a single annotation's full-
    resolution geometry when the user clicks a tile feature to edit it.
    """
    stmt = (
        select(Annotation)
        .where(
            Annotation.id == annotation_id,
            Annotation.campaign_id == campaign.id,
        )
        .options(
            joinedload(Annotation.creator),
            joinedload(Annotation.annotation_task).selectinload(Task.assignments),
        )
    )
    annotation = db.scalars(stmt).unique().first()
    if annotation is not None:
        attach_counts_toward_completion(db, campaign, [annotation])
    return annotation


def delete_annotation_with_status(
    db: Session,
    annotation_id: int,
    campaign: Campaign,
    user_id: UUID,
) -> TaskStatusOut | None:
    """Delete an annotation and, when it was a task's row, report where that
    task now stands; None otherwise."""
    task_id = db.scalar(
        select(Annotation.annotation_task_id).where(
            Annotation.id == annotation_id, Annotation.campaign_id == campaign.id
        )
    )
    delete_annotations(db, [annotation_id], campaign, user_id)
    if task_id is None:
        return None

    task = get_task(db, task_id, campaign)
    if task is None:
        return None
    return TaskStatusOut(
        task_status=TaskOut.model_validate(task).task_status,
        assignment_status=get_user_assignment_status(task, user_id),
    )


def delete_annotations(
    db: Session,
    annotation_ids: list[int],
    campaign: Campaign,
    user_id: UUID,
) -> int:
    """
    Delete annotations of a campaign in one transaction. Somebody else's need
    the campaign's modify_others axis. Deleting a task's row puts its author
    back to pending on that task, since the row was the record of their work.
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

    _require_own_annotations(db, list(annotations), campaign, user_id, "delete")

    try:
        for annotation in annotations:
            db.delete(annotation)
        record_annotation_deletions(db, campaign.id, sorted(found_ids))
        bump_campaign_annotations_version(db, campaign.id)
        db.commit()
        return len(annotations)

    except Exception as e:
        db.rollback()
        logger.exception("Failed to delete annotations")
        raise HTTPException(status_code=500, detail="Failed to delete annotations") from e

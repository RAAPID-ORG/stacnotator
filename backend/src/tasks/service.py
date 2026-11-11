from collections import defaultdict
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

import shapely
from fastapi import HTTPException
from sqlalchemy import Row, func, select, union
from sqlalchemy.orm import Session, aliased, joinedload

from src.annotation import spatial
from src.annotation.constants import CHANGES_OVERLAP, AssignmentStatus, TaskStatus
from src.annotation.models import Annotation
from src.annotation.schemas import AnnotationFromTaskOut
from src.annotation.sync import (
    bump_campaign_annotations_version,
    record_annotation_deletions,
)
from src.auth.models import User
from src.campaigns.models import Campaign
from src.campaigns.policy import (
    PolicyContext,
    build_policy_context,
    get_labelling_policy,
    is_allowed,
)
from src.tasks import assignments, claims
from src.tasks.completion import (
    completion_rule,
)
from src.tasks.models import Task, TaskAssignment
from src.tasks.schemas import TaskAssignmentOut, TaskOut
from src.tasks.status import (
    agreed_answers,
    compute_task_status_value,
    derive_assignment_status,
    task_status_inputs,
)


def get_changed_task_ids(db: Session, campaign_id: int, since: datetime) -> list[int]:
    """Tasks that changed since ``since``, for the task poll: an answer written,
    or anything ``touch_tasks`` stamps on the task itself."""
    after = since - CHANGES_OVERLAP
    answered = select(Annotation.task_id).where(
        Annotation.campaign_id == campaign_id,
        Annotation.task_id.is_not(None),
        Annotation.updated_at >= after,
    )
    touched = select(Task.id).where(Task.campaign_id == campaign_id, Task.changed_at >= after)
    return list(db.scalars(union(answered, touched)))


def require_task_access(
    db: Session, campaign: Campaign, task: Task, user_id: UUID
) -> PolicyContext:
    """Raise HTTP 403 unless the user may work this task, per the assigned or
    unassigned tasks axis. Returns the policy context it checked."""
    policy = get_labelling_policy(campaign)
    has_assignments = bool(task.assignments)
    ctx = build_policy_context(db, campaign, user_id, task=task)
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
    return ctx


@dataclass
class _StatusRow:
    """The columns of a task row that its task's status reads."""

    label_id: int | None
    outcome: str | None
    created_by_user_id: UUID
    is_authoritative: bool
    counts_toward_completion: bool | None


def _status_by_task(
    db: Session, campaign: Campaign, task_ids: Collection[int]
) -> dict[int, tuple[TaskStatus, int | None]]:
    """Each task's status and agreed label, read from plain rows rather than the task
    tree: a map asks for thousands at a time. The decisions are the shared ones."""
    ids = list(task_ids)
    assigned: dict[int, list[Row]] = defaultdict(list)
    for row in db.execute(
        select(TaskAssignment.task_id, TaskAssignment.user_id, TaskAssignment.is_review).where(
            TaskAssignment.task_id.in_(ids)
        )
    ):
        assigned[row.task_id].append(row)
    answers = db.execute(
        select(
            Annotation.task_id,
            Annotation.label_id,
            Annotation.outcome,
            Annotation.created_by_user_id,
            Annotation.is_authoritative,
        ).where(Annotation.task_id.in_(ids))
    ).all()

    counts = completion_rule(db, campaign, {a.created_by_user_id for a in answers})
    rows: dict[int, list[_StatusRow]] = defaultdict(list)
    for a in answers:
        assigned_ids = {r.user_id for r in assigned[a.task_id]}
        rows[a.task_id].append(
            _StatusRow(
                label_id=a.label_id,
                outcome=a.outcome,
                created_by_user_id=a.created_by_user_id,
                is_authoritative=a.is_authoritative,
                counts_toward_completion=counts(a.created_by_user_id, assigned_ids),
            )
        )

    statuses = {}
    for task_id in ids:
        status = compute_task_status_value(*task_status_inputs(assigned[task_id], rows[task_id]))
        agreed = agreed_answers(rows[task_id])
        statuses[task_id] = (status, agreed[0].label_id if agreed else None)
    return statuses


def get_task_density(
    db: Session,
    campaign: Campaign,
    target_cells: int = 48,
    task_set_id: int | None = None,
    bbox: tuple[float, float, float, float] | None = None,
) -> list[dict]:
    """Aggregate a campaign's tasks into a grid, split by status and by the label an
    annotator gave them.

    The campaign maps ask where tasks are and what state they are in, which a grid can
    answer in a payload that grows with cells rather than with tasks. Status is not a
    column - it follows from assignments, counting annotations and reviewer slots - so
    it is derived here with the same function every other read path uses, and the
    grouping happens in Python rather than as a second copy of those rules in SQL.
    """
    grid = spatial.density_grid(campaign.bbox, target_cells, bbox)
    centroids = spatial.task_centroids(db, campaign.id, task_set_id, bbox)
    if not centroids:
        return []

    statuses = _status_by_task(db, campaign, centroids.keys())
    points = [(lon, lat, statuses[task_id]) for task_id, (lon, lat) in centroids.items()]

    return [
        {
            "lon": cell["lon"],
            "lat": cell["lat"],
            "task_status": cell["key"][0],
            "label_id": cell["key"][1],
            "count": cell["count"],
        }
        for cell in spatial.bin_density_cells(points, grid)
    ]


def claim_next_task(
    db: Session,
    campaign: Campaign,
    user_id: UUID,
    task_set_id: int | None = None,
    after_annotation_number: int | None = None,
    *,
    with_email: bool,
) -> TaskOut | None:
    """Claim the next free task and return it as every other task read does, so the
    caller can drop it straight into its list instead of reloading the campaign."""
    claimed = claims.claim_next_task(
        db,
        campaign_id=campaign.id,
        user_id=user_id,
        task_set_id=task_set_id,
        after_annotation_number=after_annotation_number,
    )
    if claimed is None:
        return None
    return read_task(db, campaign, claimed.id, with_email=with_email)


def read_tasks(
    db: Session,
    campaign: Campaign,
    task_ids: Collection[int] | None = None,
    *,
    with_email: bool,
) -> list[TaskOut]:
    """A campaign's tasks as the API returns them, in annotation order; only
    ``task_ids`` when given. Emails only ``with_email`` (platform admins).

    Read as flat rows rather than an ORM tree, since a campaign can hold tens of
    thousands of tasks: Postgres joins in the names and flags, and Python only runs the
    shared status and completion rules over them.
    """
    scope = select(Task.id).where(Task.campaign_id == campaign.id)
    if task_ids is not None:
        scope = scope.where(Task.id.in_(list(task_ids)))

    claimer = aliased(User)
    tasks = db.execute(
        select(
            Task.id,
            Task.annotation_number,
            Task.task_set_id,
            func.ST_AsBinary(Task.geometry).label("wkb"),
            Task.claimed_by_user_id,
            Task.claimed_at,
            claimer.display_name.label("claimed_by_display_name"),
            Task.embedding.is_not(None).label("has_embedding"),
        )
        .outerjoin(claimer, claimer.id == Task.claimed_by_user_id)
        .where(Task.id.in_(scope))
        .order_by(Task.annotation_number)
    ).all()
    if not tasks:
        return []
    # One vectorised pass, identical to the WKT the ORM path produced per row.
    wkts = shapely.to_wkt(shapely.from_wkb([bytes(t.wkb) for t in tasks]), rounding_precision=-1)

    assigned: dict[int, list[Row]] = defaultdict(list)
    for row in db.execute(
        select(
            TaskAssignment.task_id,
            TaskAssignment.user_id,
            TaskAssignment.is_review,
            User.email,
            User.display_name,
        )
        .outerjoin(User, User.id == TaskAssignment.user_id)
        .where(TaskAssignment.task_id.in_(scope))
        .order_by(TaskAssignment.id)
    ):
        assigned[row.task_id].append(row)

    answer_rows = db.execute(
        select(
            Annotation.task_id,
            Annotation.id,
            Annotation.label_id,
            Annotation.outcome,
            Annotation.comment,
            Annotation.created_by_user_id,
            User.email.label("created_by_user_email"),
            User.display_name.label("created_by_user_display_name"),
            Annotation.created_at,
            Annotation.updated_at,
            Annotation.confidence,
            Annotation.is_authoritative,
            Annotation.flagged_for_review,
            Annotation.flag_comment,
            Annotation.imagery_slice_id,
            Annotation.imagery_source_name,
            Annotation.imagery_start_date,
            Annotation.imagery_end_date,
            Annotation.slice_comments,
            Annotation.form_values,
            Annotation.active_seconds,
        )
        .outerjoin(User, User.id == Annotation.created_by_user_id)
        .where(Annotation.task_id.in_(scope))
        .order_by(Annotation.id)
    ).all()

    nearby: dict[int, int] = {
        task_id: count
        for task_id, count in db.execute(
            select(Annotation.origin_task_id, func.count())
            .where(Annotation.origin_task_id.in_(scope))
            .group_by(Annotation.origin_task_id)
        )
    }
    drawn_by: dict[int, list[UUID]] = defaultdict(list)
    for task_id, user_id in db.execute(
        select(Annotation.output_of_task_id, Annotation.created_by_user_id)
        .where(Annotation.output_of_task_id.in_(scope))
        .distinct()
    ):
        drawn_by[task_id].append(user_id)

    counts = completion_rule(db, campaign, {a.created_by_user_id for a in answer_rows})
    assigned_ids = {task_id: {r.user_id for r in rows} for task_id, rows in assigned.items()}
    answers: dict[int, list[AnnotationFromTaskOut]] = defaultdict(list)
    for row in answer_rows:
        fields = row._asdict()
        task_id = fields.pop("task_id")
        if not with_email:
            fields["created_by_user_email"] = None
        fields["counts_toward_completion"] = counts(
            row.created_by_user_id, assigned_ids.get(task_id, set())
        )
        answers[task_id].append(AnnotationFromTaskOut.model_validate(fields))

    out = []
    for task, wkt in zip(tasks, wkts, strict=True):
        assignment_list, annotation_list = task_status_inputs(assigned[task.id], answers[task.id])
        out.append(
            TaskOut(
                id=task.id,
                annotation_number=task.annotation_number,
                task_set_id=task.task_set_id,
                task_status=compute_task_status_value(assignment_list, annotation_list),
                geometry_wkt=wkt,
                assignments=[
                    TaskAssignmentOut(
                        user_id=a.user_id,
                        status=derive_assignment_status(annotation_list, a.user_id),
                        is_review=a.is_review,
                        user_email=a.email if with_email else None,
                        user_display_name=a.display_name,
                    )
                    for a in assigned[task.id]
                ],
                annotations=answers[task.id],
                claimed_by_user_id=task.claimed_by_user_id,
                claimed_at=task.claimed_at,
                claimed_by_display_name=task.claimed_by_display_name,
                has_embedding=task.has_embedding,
                nearby_annotation_count=nearby.get(task.id, 0),
                drawn_by_user_ids=drawn_by[task.id],
            )
        )
    return out


def read_task(db: Session, campaign: Campaign, task_id: int, *, with_email: bool) -> TaskOut | None:
    tasks = read_tasks(db, campaign, [task_id], with_email=with_email)
    return tasks[0] if tasks else None


def assignment_status_of(task: TaskOut, user_id: UUID) -> AssignmentStatus:
    """A user's state on a task, read off their answer whether or not they are assigned."""
    _, annotation_list = task_status_inputs([], task.annotations)
    return derive_assignment_status(annotation_list, user_id)


def task_for_annotating(db: Session, task_id: int, campaign: Campaign) -> Task | None:
    """Fetch a bare task scoped to the campaign, with just enough loaded
    (assignments) for `add_annotation_for_task`'s policy checks - unlike
    `get_task`, this skips the full annotations/geometry
    joinedload tree and the counts/has_embedding attachment, all of which
    would be thrown away by the mutation that follows.
    """
    stmt = (
        select(Task)
        .where(
            Task.id == task_id,
            Task.campaign_id == campaign.id,
        )
        .options(joinedload(Task.assignments))
    )
    return db.scalars(stmt).unique().first()


def delete_tasks(
    db: Session, campaign_id: int, tasks: Sequence[Task], *, delete_annotations: bool
) -> None:
    """Delete tasks and what only made sense on them.

    A task row records one annotator's answer to that task and dies with it. A
    labelled answer is still a labelled place, so unless the admin asks for the
    annotations to go too it stays as a shape of its own; the shapes drawn on a
    draw task stay the same way. Nothing commits here.
    """
    task_ids = [task.id for task in tasks]
    if not task_ids:
        return
    task_rows = db.scalars(select(Annotation).where(Annotation.task_id.in_(task_ids))).all()
    drop = list(task_rows)
    if delete_annotations:
        drop += db.scalars(
            select(Annotation).where(Annotation.output_of_task_id.in_(task_ids))
        ).all()
    else:
        kept = [row for row in task_rows if row.outcome == "labelled"]
        for row in kept:
            row.task_id = None
            row.outcome = None
            # Detaching is nobody's work; an author's last activity reads updated_at.
            row.updated_at = Annotation.updated_at
        drop = [row for row in task_rows if row.outcome is not None]
    if task_rows or drop:
        record_annotation_deletions(db, campaign_id, [row.id for row in drop])
        bump_campaign_annotations_version(db, campaign_id)
    for doomed in (*drop, *tasks):
        db.delete(doomed)


def delete_campaign_tasks(
    db: Session, campaign_id: int, task_ids: list[int], delete_annotations: bool = False
) -> int:
    """Delete tasks of a campaign; see ``delete_tasks`` above for what
    happens to the work done on them."""
    if not task_ids:
        return 0
    assignments.verify_tasks_in_campaign(db, campaign_id, task_ids)
    tasks = db.scalars(
        select(Task).where(Task.id.in_(task_ids), Task.campaign_id == campaign_id)
    ).all()
    delete_tasks(db, campaign_id, tasks, delete_annotations=delete_annotations)
    db.commit()
    return len(tasks)

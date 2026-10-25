from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select, union
from sqlalchemy.orm import Session, defer, joinedload, selectinload

from src.annotation import spatial
from src.annotation.constants import CHANGES_OVERLAP
from src.annotation.models import Annotation
from src.annotation.sync import (
    bump_campaign_annotations_version,
    record_annotation_deletions,
    record_task_deletions,
)
from src.campaigns.models import Campaign
from src.campaigns.policy import (
    PolicyContext,
    build_policy_context,
    get_labelling_policy,
    is_allowed,
)
from src.tasks import assignments, claims
from src.tasks.completion import (
    attach_to_tasks,
)
from src.tasks.models import Task, TaskAssignment
from src.tasks.status import (
    agreed_answers,
    compute_task_status_value,
    derive_assignment_status,
    task_status_inputs,
)


def get_user_assignment_status(task: Task, user_id: UUID) -> str:
    """Get a user's status on a task, derived from what they annotated."""
    _, annotation_list = task_status_inputs([], task.annotations or [])
    return derive_assignment_status(annotation_list, user_id)


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


def _task_tree():
    """What a task is read with. Its answers come without their shapes, which no task
    read shows, and as a second query rather than multiplying the assignment rows."""
    return (
        joinedload(Task.assignments).joinedload(TaskAssignment.user),
        selectinload(Task.annotations).options(
            defer(Annotation.geometry), joinedload(Annotation.creator)
        ),
        joinedload(Task.claimed_by),
    )


def get_task(
    db: Session,
    task_id: int,
    campaign: Campaign,
) -> Task | None:
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
        select(Task)
        .where(
            Task.id == task_id,
            Task.campaign_id == campaign.id,
        )
        .options(*_task_tree())
    )

    task = db.scalars(stmt).unique().first()
    if task is not None:
        _attach_has_embedding(db, [task])
        _attach_linked_annotations(db, [task])
        attach_to_tasks(db, campaign, [task])
    return task


def get_tasks(
    db: Session,
    campaign: Campaign,
    task_ids: Sequence[int] | None = None,
) -> list[Task]:
    """
    Retrieve all annotation tasks for a campaign with eager loading
    to avoid N+1 query problem.

    This loads all related data (geometry, assignments, annotations)
    in a single optimized query.

    Args:
        db: Database session
        campaign: The campaign whose tasks to load.
        task_ids: Load only these tasks instead of all of them.

    Returns:
        List of annotation task items with all relationships loaded
    """
    stmt = (
        select(Task)
        .where(Task.campaign_id == campaign.id)
        .options(*_task_tree())
        .order_by(Task.annotation_number)
    )
    if task_ids is not None:
        stmt = stmt.where(Task.id.in_(task_ids))

    tasks = list(db.scalars(stmt).unique().all())
    _attach_has_embedding(db, tasks)
    _attach_linked_annotations(db, tasks)
    attach_to_tasks(db, campaign, tasks)
    return tasks


def _tasks_for_status(db: Session, campaign: Campaign) -> list[Task]:
    """Tasks carrying only what a status decision needs.

    The full task read also loads geometries, annotators and embedding flags, none of
    which a status costs. Status itself is still decided by the one shared function,
    so this is a narrower query rather than a second copy of the rules.
    """
    tasks = list(
        db.scalars(
            select(Task)
            .where(Task.campaign_id == campaign.id)
            .options(
                selectinload(Task.assignments),
                selectinload(Task.annotations).defer(Annotation.geometry),
            )
        )
        .unique()
        .all()
    )
    attach_to_tasks(db, campaign, tasks)
    return tasks


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

    points = []
    for task in _tasks_for_status(db, campaign):
        point = centroids.get(task.id)
        if point is None:
            continue
        annotations = task.annotations or []
        assignment_list, annotation_list = task_status_inputs(task.assignments or [], annotations)
        status = compute_task_status_value(assignment_list, annotation_list)
        agreed = agreed_answers(annotations)
        points.append((point[0], point[1], (status, agreed[0].label_id if agreed else None)))

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
) -> Task | None:
    """Claim the next free task and return it with the tree the client needs.

    Composes the pick-and-claim with the same decorated fetch every other task
    read goes through, so the caller can drop the task straight into its list
    instead of reloading the campaign to find out what it just got.
    """
    claimed = claims.claim_next_task(
        db,
        campaign_id=campaign.id,
        user_id=user_id,
        task_set_id=task_set_id,
        after_annotation_number=after_annotation_number,
    )
    if claimed is None:
        return None
    return get_task(db, claimed.id, campaign)


def _attach_has_embedding(db: Session, tasks: list[Task]) -> None:
    """Set `has_embedding` on each task via one lightweight indexed lookup.

    The vector itself is deferred on the task, so this asks only whether there is one.
    """
    if not tasks:
        return
    task_ids = [t.id for t in tasks]
    embedded_ids = set(
        db.scalars(select(Task.id).where(Task.id.in_(task_ids), Task.embedding.is_not(None)))
    )
    for task in tasks:
        task.has_embedding = task.id in embedded_ids


def _attach_linked_annotations(db: Session, tasks: list[Task]) -> None:
    """Set `nearby_annotation_count`, the standalone annotations drawn after
    leaving this task for Explore, and `drawn_by_user_ids`, who drew shapes as
    this draw task's answer."""
    if not tasks:
        return
    task_ids = [t.id for t in tasks]
    rows = db.execute(
        select(Annotation.origin_task_id, func.count())
        .where(Annotation.origin_task_id.in_(task_ids))
        .group_by(Annotation.origin_task_id)
    )
    counts = {task_id: count for task_id, count in rows}
    drawn_by: dict[int, list[UUID]] = {}
    for task_id, user_id in db.execute(
        select(Annotation.output_of_task_id, Annotation.created_by_user_id)
        .where(Annotation.output_of_task_id.in_(task_ids))
        .distinct()
    ):
        drawn_by.setdefault(task_id, []).append(user_id)
    for task in tasks:
        task.nearby_annotation_count = counts.get(task.id, 0)
        task.drawn_by_user_ids = drawn_by.get(task.id, [])


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
    record_task_deletions(db, campaign_id, task_ids)
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

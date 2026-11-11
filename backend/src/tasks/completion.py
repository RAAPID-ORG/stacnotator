"""Attach policy-derived `counts_toward_completion` onto loaded annotation rows.

DB-bound but service-independent: shared by the annotation read endpoints
(task lists / single-task fetch) in service.py and by the export path in
export.py, so neither has to depend on the other. Lives outside policy.py
because it touches annotation ORM rows, which policy.py must not import.
"""

from collections.abc import Callable, Collection, Iterable
from uuid import UUID

from sqlalchemy.orm import Session

from src.annotation.models import Annotation
from src.campaigns.models import Campaign
from src.campaigns.policy import (
    counts_toward_completion,
    get_labelling_policy,
    load_standing,
)
from src.tasks.models import Task


def attach_counts_toward_completion(
    db: Session, campaign: Campaign, annotations: Iterable[Annotation]
) -> None:
    """Set `counts_toward_completion` on every task row among ``annotations``, via
    one role-map lookup for the whole campaign instead of a query per row. The
    flag is set on the ORM instance so `AnnotationFromTaskOut` (from_attributes)
    picks it up. Each row reads its task's assignments through `.task`,
    which a task tree loaded from the same session already holds. Standalone
    annotations are left untouched and read back as None: "not applicable", not
    "doesn't count".
    """
    task_rows = [(a, a.task) for a in annotations if a.task is not None]
    if not task_rows:
        return
    counts = completion_rule(db, campaign, {a.created_by_user_id for a, _ in task_rows})
    for ann, task in task_rows:
        ann.counts_toward_completion = counts(
            ann.created_by_user_id, {a.user_id for a in task.assignments}
        )


def completion_rule(
    db: Session, campaign: Campaign, author_ids: Collection[UUID]
) -> Callable[[UUID, set[UUID]], bool]:
    """Whether an author's task row counts toward completion, given who is assigned to
    that task. Loads the authors' standing once, so a caller can ask for many rows."""
    policy = get_labelling_policy(campaign)
    standing = load_standing(db, campaign, author_ids)

    def counts(author_id: UUID, assigned_ids: set[UUID]) -> bool:
        ctx = standing.context(author_id, is_assigned=author_id in assigned_ids)
        return counts_toward_completion(policy, bool(assigned_ids), ctx)

    return counts


def attach_to_tasks(db: Session, campaign: Campaign, tasks: Iterable[Task]) -> None:
    """`attach_counts_toward_completion` over every row of the given tasks."""
    attach_counts_toward_completion(db, campaign, [a for t in tasks for a in t.annotations])

"""Whether a task row counts toward completing its task, from the labelling policy.

DB-bound but service-independent: shared by the task reads in service.py and
summary.py, the annotation replay endpoint and the export path in export.py, so none
has to depend on another. Lives outside policy.py because it touches annotation ORM
rows, which policy.py must not import.
"""

from collections.abc import Callable, Collection, Iterable
from typing import NamedTuple
from uuid import UUID

from sqlalchemy.orm import Session

from src.annotation.models import Annotation
from src.campaigns.models import Campaign
from src.campaigns.policy import (
    counts_toward_completion,
    get_labelling_policy,
    load_standing,
)


def attach_counts_toward_completion(
    db: Session, campaign: Campaign, annotations: Iterable[Annotation]
) -> None:
    """Set `counts_toward_completion` on every task row among ``annotations``, via
    one role-map lookup for the whole campaign instead of a query per row. The
    flag is set on the ORM instance so `AnnotationFromTaskOut` (from_attributes)
    picks it up. Each row reads its task's assignments through `.task`. Standalone
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


class AuthorCompletion(NamedTuple):
    """Whether an author's task row counts, in each situation a task can put them in."""

    on_unassigned_task: bool
    when_assigned: bool
    when_not_assigned: bool


def completion_by_author(
    db: Session, campaign: Campaign, author_ids: Collection[UUID]
) -> dict[UUID, AuthorCompletion]:
    """The rule for each author, for reads that apply it to many rows elsewhere (SQL)."""
    policy = get_labelling_policy(campaign)
    standing = load_standing(db, campaign, author_ids)
    cases = {}
    for author in author_ids:
        assigned = standing.context(author, is_assigned=True)
        not_assigned = standing.context(author, is_assigned=False)
        cases[author] = AuthorCompletion(
            on_unassigned_task=counts_toward_completion(policy, False, not_assigned),
            when_assigned=counts_toward_completion(policy, True, assigned),
            when_not_assigned=counts_toward_completion(policy, True, not_assigned),
        )
    return cases


def completion_rule(
    db: Session, campaign: Campaign, author_ids: Collection[UUID]
) -> Callable[[UUID, set[UUID]], bool]:
    """Whether an author's task row counts toward completion, given who is assigned to
    that task. Loads the authors' standing once, so a caller can ask for many rows."""
    cases = completion_by_author(db, campaign, author_ids)

    def counts(author_id: UUID, assigned_ids: set[UUID]) -> bool:
        case = cases[author_id]
        if not assigned_ids:
            return case.on_unassigned_task
        return case.when_assigned if author_id in assigned_ids else case.when_not_assigned

    return counts

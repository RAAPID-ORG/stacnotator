"""How a task's status follows from its assignments and annotations.

Pure: rows come in through task_status_inputs and nothing here touches the
database, so the one rule every read path uses can be tested on its own.
"""

from collections.abc import Sequence
from typing import Protocol
from uuid import UUID

from src.annotation.constants import (
    ANNOTATION_TASK_STATUS_DONE,
    ANNOTATION_TASK_STATUS_PENDING,
    ANNOTATION_TASK_STATUS_SKIPPED,
    TASK_STATUS_CONFLICTING,
    TASK_STATUS_DONE,
    TASK_STATUS_PARTIAL,
    TASK_STATUS_PENDING,
    TASK_STATUS_SKIPPED,
    AssignmentStatus,
    TaskOutcome,
    TaskStatus,
)


def derive_assignment_status(annotation_list: list[dict], user_id: UUID) -> AssignmentStatus:
    """A user's state on a task, read off their annotation.

    An answer means done, an annotation without one means they looked and
    skipped, and no annotation at all means they have not acted. Stored
    nowhere: the annotation is the record of the work, so there is no second
    copy to keep in step with it.
    """
    for annotation in annotation_list:
        if annotation["created_by_user_id"] == user_id:
            return (
                ANNOTATION_TASK_STATUS_DONE
                if annotation["answer"] is not None
                else ANNOTATION_TASK_STATUS_SKIPPED
            )
    return ANNOTATION_TASK_STATUS_PENDING


def compute_task_status_value(
    assignment_list: list[dict], annotation_list: list[dict]
) -> TaskStatus:
    """Derive a task's status from its assignments and annotations.

    Only counting annotations (`counts_toward_completion` is True; every
    task-linked read path attaches the boolean before this runs) drive
    done/partial/conflicting. An answer is a label, or for a draw task whether
    shapes were drawn (`task_answer`). Review assignments set a required
    review-answer count, satisfiable by a counting answer from any non-primary
    user, not just the assigned reviewer(s).
    """
    counting = [a for a in annotation_list if a["counts_toward_completion"]]
    answered = [a for a in counting if a["answer"] is not None]
    has_authoritative_answer = any(a.get("is_authoritative") for a in answered)

    if has_authoritative_answer:
        # An authoritative reviewer's answer resolves the task on its own,
        # overriding assignment-based aggregation.
        return TASK_STATUS_DONE
    if not assignment_list:
        # Nobody was assigned, so whoever picked it up settles it: an answer
        # completes it, an annotation without one is the skip they left behind.
        if answered:
            return TASK_STATUS_DONE
        return TASK_STATUS_SKIPPED if annotation_list else TASK_STATUS_PENDING

    all_skipped = all(
        derive_assignment_status(annotation_list, a["user_id"]) == ANNOTATION_TASK_STATUS_SKIPPED
        for a in assignment_list
    )
    if all_skipped:
        return TASK_STATUS_SKIPPED

    num_reviewers_required = sum(1 for a in assignment_list if a.get("is_review"))
    if num_reviewers_required:
        primary_ids = {a["user_id"] for a in assignment_list if not a.get("is_review")}
        primary_answers = {
            a["created_by_user_id"]: a["answer"]
            for a in answered
            if a["created_by_user_id"] in primary_ids
        }
        # Anyone else with a counting answer fills a review slot, whether or
        # not they hold an assignment row on this task.
        review_answers = {
            a["created_by_user_id"]: a["answer"]
            for a in answered
            if a["created_by_user_id"] not in primary_ids
        }
        if not primary_answers and not review_answers:
            return TASK_STATUS_PENDING
        if primary_answers.keys() != primary_ids or len(review_answers) < num_reviewers_required:
            return TASK_STATUS_PARTIAL
        answers = set(primary_answers.values()) | set(review_answers.values())
        return TASK_STATUS_DONE if len(answers) == 1 else TASK_STATUS_CONFLICTING

    all_assigned_ids = {a["user_id"] for a in assignment_list}
    answered_ids = {
        a["created_by_user_id"] for a in answered if a["created_by_user_id"] in all_assigned_ids
    }
    if not answered_ids:
        # Nobody answered yet; some may have skipped or still be pending.
        return TASK_STATUS_PENDING
    if answered_ids != all_assigned_ids:
        # Some assignees answered, others didn't (skip or not-yet-acted).
        # Not enough information to call this done or conflicting.
        return TASK_STATUS_PARTIAL
    answers = {a["answer"] for a in answered if a["created_by_user_id"] in answered_ids}
    return TASK_STATUS_DONE if len(answers) == 1 else TASK_STATUS_CONFLICTING


class _AssignmentRow(Protocol):
    user_id: UUID
    is_review: bool


class _AnnotationRow(Protocol):
    label_id: int | None
    outcome: str | None
    created_by_user_id: UUID
    is_authoritative: bool
    counts_toward_completion: bool | None


def task_answer(annotation: _AnnotationRow) -> int | str | None:
    """What one task row answers, comparable across annotators: the label of a
    classify task, whether shapes were drawn for a draw task, None for a skip."""
    if annotation.outcome == "labelled":
        return annotation.label_id
    if annotation.outcome == "skipped":
        return None
    return annotation.outcome


def agreed_answers[R: _AnnotationRow](rows: Sequence[R]) -> list[R] | None:
    """The task rows a task's answer rests on, or None when they disagree.

    An authoritative answer settles the task on its own; otherwise every
    counting answer has a say. Rows the policy does not count never decide
    anything. Empty when nothing has been answered yet.
    """
    counting = [
        row for row in rows if row.counts_toward_completion and task_answer(row) is not None
    ]
    basis = [row for row in counting if row.is_authoritative] or counting
    return basis if len({task_answer(row) for row in basis}) <= 1 else None


def resolve_task_outcome(
    task_output: str, label_id: int | None, outcome: TaskOutcome | None
) -> TaskOutcome:
    """The outcome a task submission stores, or ValueError when it does not fit
    the campaign. A classify submission may leave it out: the label says it."""
    if task_output == "draw":
        if label_id is not None:
            raise ValueError("Draw tasks are answered with shapes, not a label")
        if outcome not in ("drawn", "none_found", "skipped"):
            raise ValueError("Draw tasks take the outcome drawn, none_found or skipped")
        return outcome
    if outcome in ("drawn", "none_found"):
        raise ValueError("This campaign's tasks are answered with a label")
    return "labelled" if label_id is not None else "skipped"


def task_status_inputs(
    assignments: Sequence[_AssignmentRow], annotations: Sequence[_AnnotationRow]
) -> tuple[list[dict], list[dict]]:
    """Convert ORM assignment/annotation rows into the plain-dict shape
    `compute_task_status_value` consumes.

    The single seam between ORM rows and that pure function - shared by
    `TaskOut`'s validator below and the export path
    (annotation/export.py), so neither hand-rolls its own conversion.
    `counts_toward_completion` is an attribute attached at request time
    (tasks/completion.py), not a mapped column; a caller that skipped
    the attach fails here with AttributeError rather than silently counting.
    """
    assignment_list = [{"user_id": a.user_id, "is_review": a.is_review} for a in assignments]
    annotation_list = [
        {
            "answer": task_answer(a),
            "created_by_user_id": a.created_by_user_id,
            "is_authoritative": a.is_authoritative,
            "counts_toward_completion": a.counts_toward_completion,
        }
        for a in annotations
    ]
    return assignment_list, annotation_list

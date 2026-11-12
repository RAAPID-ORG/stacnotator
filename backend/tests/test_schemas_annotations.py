"""Tests for annotation task status computation logic."""

from types import SimpleNamespace
from uuid import uuid4

from src.tasks.status import (
    compute_task_status_value,
)


def _make_assignment(user_id):
    """Admin intent only - a user's status is derived from their annotation."""
    return {"user_id": user_id}


def _make_annotation(user_id, label_id, is_authoritative=False):
    return {
        "answer": label_id,
        "created_by_user_id": user_id,
        "is_authoritative": is_authoritative,
        "counts_toward_completion": True,
    }


def _make_task(assignments, annotations):
    return SimpleNamespace(
        task_status=compute_task_status_value(
            [{"is_review": False, **a} for a in assignments], annotations
        )
    )


class TestTaskStatusComputation:
    def test_no_assignments_no_annotations_is_pending(self):
        task = _make_task(assignments=[], annotations=[])
        assert task.task_status == "pending"

    def test_no_assignments_with_annotation_is_done(self):
        uid = uuid4()
        task = _make_task(
            assignments=[],
            annotations=[_make_annotation(uid, label_id=1)],
        )
        assert task.task_status == "done"

    def test_all_skipped_is_skipped(self):
        u1, u2 = uuid4(), uuid4()
        task = _make_task(
            assignments=[_make_assignment(u1), _make_assignment(u2)],
            annotations=[
                _make_annotation(u1, label_id=None),
                _make_annotation(u2, label_id=None),
            ],
        )
        assert task.task_status == "skipped"

    def test_pending_when_no_completions(self):
        u1 = uuid4()
        task = _make_task(
            assignments=[_make_assignment(u1)],
            annotations=[],
        )
        assert task.task_status == "pending"

    def test_partial_when_some_completed(self):
        u1, u2 = uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1),
                _make_assignment(u2),
            ],
            annotations=[_make_annotation(u1, label_id=1)],
        )
        assert task.task_status == "partial"

    def test_done_when_all_agree(self):
        u1, u2 = uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1),
                _make_assignment(u2),
            ],
            annotations=[
                _make_annotation(u1, label_id=1),
                _make_annotation(u2, label_id=1),
            ],
        )
        assert task.task_status == "done"

    def test_conflicting_when_different_labels(self):
        u1, u2 = uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1),
                _make_assignment(u2),
            ],
            annotations=[
                _make_annotation(u1, label_id=1),
                _make_annotation(u2, label_id=2),
            ],
        )
        assert task.task_status == "conflicting"

    def test_one_label_plus_one_skip_is_partial(self):
        """A skip is not a tie-breaker - the task is not fully resolved
        until every assignee has actually labeled it."""
        u1, u2 = uuid4(), uuid4()
        task = _make_task(
            assignments=[_make_assignment(u1), _make_assignment(u2)],
            annotations=[
                _make_annotation(u1, label_id=1),
                _make_annotation(u2, label_id=None),
            ],
        )
        assert task.task_status == "partial"

    def test_two_labels_one_skip_is_partial(self):
        """Two annotators labeled, one skipped: partial (the skipper could
        have tie-broken a would-be conflict)."""
        u1, u2, u3 = uuid4(), uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1),
                _make_assignment(u2),
                _make_assignment(u3),
            ],
            annotations=[
                _make_annotation(u1, label_id=1),
                _make_annotation(u2, label_id=1),
                _make_annotation(u3, label_id=None),
            ],
        )
        assert task.task_status == "partial"


class TestAuthoritativeOverride:
    """An authoritative reviewer's label resolves a task on its own,
    overriding the assignment-based aggregation."""

    def test_authoritative_resolves_a_conflict_to_done(self):
        """Two assignees disagree, then an authoritative reviewer labels it:
        the task is done (not conflicting)."""
        u1, u2, reviewer = uuid4(), uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1),
                _make_assignment(u2),
            ],
            annotations=[
                _make_annotation(u1, label_id=1),
                _make_annotation(u2, label_id=2),
                _make_annotation(reviewer, label_id=3, is_authoritative=True),
            ],
        )
        assert task.task_status == "done"

    def test_authoritative_resolves_partial_to_done(self):
        """One assignee labeled, one still pending, plus an authoritative
        label -> done (the authoritative label short-circuits aggregation)."""
        u1, u2, reviewer = uuid4(), uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1),
                _make_assignment(u2),
            ],
            annotations=[
                _make_annotation(u1, label_id=1),
                _make_annotation(reviewer, label_id=1, is_authoritative=True),
            ],
        )
        assert task.task_status == "done"

    def test_authoritative_alone_is_done_even_with_pending_assignees(self):
        """Only the authoritative reviewer has acted; assignees untouched."""
        u1, u2, reviewer = uuid4(), uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1),
                _make_assignment(u2),
            ],
            annotations=[
                _make_annotation(reviewer, label_id=2, is_authoritative=True),
            ],
        )
        assert task.task_status == "done"

    def test_without_authoritative_the_same_disagreement_is_conflicting(self):
        """Control: drop the authoritative flag and the task is conflicting,
        confirming it is the flag (not the extra annotation) doing the work."""
        u1, u2, u3 = uuid4(), uuid4(), uuid4()
        task = _make_task(
            assignments=[
                _make_assignment(u1),
                _make_assignment(u2),
                _make_assignment(u3),
            ],
            annotations=[
                _make_annotation(u1, label_id=1),
                _make_annotation(u2, label_id=2),
                _make_annotation(u3, label_id=3),
            ],
        )
        assert task.task_status == "conflicting"


class TestComputeTaskStatusValue:
    """The rule called directly, as the CSV/GeoJSON export does."""

    def test_no_assignments_with_annotation_is_done(self):
        u1 = uuid4()
        assert compute_task_status_value([], [_make_annotation(u1, label_id=1)]) == "done"

    def test_no_assignments_no_annotations_is_pending(self):
        assert compute_task_status_value([], []) == "pending"

    def test_all_skipped_is_skipped(self):
        u1, u2 = uuid4(), uuid4()
        assignments = [_make_assignment(u1), _make_assignment(u2)]
        annotations = [_make_annotation(u1, label_id=None), _make_annotation(u2, label_id=None)]
        assert compute_task_status_value(assignments, annotations) == "skipped"

    def test_partial_when_some_completed(self):
        u1, u2 = uuid4(), uuid4()
        assignments = [_make_assignment(u1), _make_assignment(u2)]
        annotations = [_make_annotation(u1, label_id=1)]
        assert compute_task_status_value(assignments, annotations) == "partial"

    def test_done_when_all_agree(self):
        u1, u2 = uuid4(), uuid4()
        assignments = [_make_assignment(u1), _make_assignment(u2)]
        annotations = [_make_annotation(u1, label_id=1), _make_annotation(u2, label_id=1)]
        assert compute_task_status_value(assignments, annotations) == "done"

    def test_conflicting_when_different_labels(self):
        u1, u2 = uuid4(), uuid4()
        assignments = [_make_assignment(u1), _make_assignment(u2)]
        annotations = [_make_annotation(u1, label_id=1), _make_annotation(u2, label_id=2)]
        assert compute_task_status_value(assignments, annotations) == "conflicting"

    def test_authoritative_overrides_conflict_to_done(self):
        u1, u2, u3 = uuid4(), uuid4(), uuid4()
        assignments = [_make_assignment(u1), _make_assignment(u2)]
        annotations = [
            _make_annotation(u1, label_id=1),
            _make_annotation(u2, label_id=2),
            _make_annotation(u3, label_id=3, is_authoritative=True),
        ]
        assert compute_task_status_value(assignments, annotations) == "done"

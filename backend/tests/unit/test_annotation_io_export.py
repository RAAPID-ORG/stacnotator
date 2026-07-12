"""Unit tests for the pure export-status helpers in annotation/io.py.

These mirror the same policy-aware rule the live task-list/annotate API uses
(`compute_task_status_value` in schemas.py) - exports must not regress to
pre-policy status/conflict semantics just because they take a different,
N+1-avoiding code path over already-loaded ORM objects.

DB-free per repo convention: tasks/annotations are SimpleNamespace stand-ins.
"""

from types import SimpleNamespace
from uuid import uuid4

from src.annotation.constants import TASK_STATUS_CONFLICTING, TASK_STATUS_DONE
from src.annotation.io import _compute_task_status_for_export, _conflicting_task_numbers


def _annotation(
    label_id=None,
    created_by_user_id=None,
    is_authoritative=False,
    counts_toward_completion=None,
    annotation_task=None,
    annotation_number=1,
):
    return SimpleNamespace(
        label_id=label_id,
        created_by_user_id=created_by_user_id or uuid4(),
        is_authoritative=is_authoritative,
        counts_toward_completion=counts_toward_completion,
        annotation_task=annotation_task or SimpleNamespace(annotation_number=annotation_number),
    )


def _task(assignments=None):
    return SimpleNamespace(assignments=assignments or [])


class TestComputeTaskStatusForExport:
    def test_none_task_returns_none(self):
        assert _compute_task_status_for_export(None, []) is None

    def test_conflicting_labels_from_two_assignees_is_conflicting(self):
        user_a, user_b = uuid4(), uuid4()
        task = _task(
            assignments=[
                SimpleNamespace(user_id=user_a, status="done", is_review=False),
                SimpleNamespace(user_id=user_b, status="done", is_review=False),
            ]
        )
        anns = [
            _annotation(label_id=1, created_by_user_id=user_a, counts_toward_completion=True),
            _annotation(label_id=2, created_by_user_id=user_b, counts_toward_completion=True),
        ]

        assert _compute_task_status_for_export(task, anns) == TASK_STATUS_CONFLICTING

    def test_non_counting_extra_label_does_not_manufacture_conflict(self):
        """A member's extra label on an assigned task (allowed by
        assigned_tasks but not counted per complete_assigned) must not turn an
        otherwise-resolved task into a false conflict in the export - this is
        the bug the review flagged: the flags attached at io.py:499 were being
        dropped before reaching compute_task_status_value."""
        assignee = uuid4()
        extra_labeler = uuid4()
        task = _task(
            assignments=[SimpleNamespace(user_id=assignee, status="done", is_review=False)]
        )
        anns = [
            _annotation(label_id=1, created_by_user_id=assignee, counts_toward_completion=True),
            _annotation(
                label_id=2, created_by_user_id=extra_labeler, counts_toward_completion=False
            ),
        ]

        assert _compute_task_status_for_export(task, anns) == TASK_STATUS_DONE

    def test_review_assignment_is_passed_through(self):
        """is_review must reach compute_task_status_value - dropping it would
        silently treat a review slot as an ordinary primary assignee slot."""
        primary = uuid4()
        reviewer = uuid4()
        task = _task(
            assignments=[
                SimpleNamespace(user_id=primary, status="done", is_review=False),
                SimpleNamespace(user_id=reviewer, status="pending", is_review=True),
            ]
        )
        anns = [
            _annotation(label_id=1, created_by_user_id=primary, counts_toward_completion=True),
        ]

        # Review slot unfilled -> partial, not done (would be "done" if the
        # review assignment were dropped, since there'd be only one assignee).
        assert _compute_task_status_for_export(task, anns) == "partial"


class TestConflictingTaskNumbers:
    def test_two_distinct_counting_labels_is_a_conflict(self):
        user_a, user_b = uuid4(), uuid4()
        task = SimpleNamespace(annotation_number=42)
        anns = [
            _annotation(
                label_id=1,
                created_by_user_id=user_a,
                counts_toward_completion=True,
                annotation_task=task,
            ),
            _annotation(
                label_id=2,
                created_by_user_id=user_b,
                counts_toward_completion=True,
                annotation_task=task,
            ),
        ]

        assert _conflicting_task_numbers({1: anns}) == [42]

    def test_non_counting_label_excluded_from_conflict_check(self):
        """Only one of the two differing labels counts - with the non-counting
        one excluded, there's just a single counting label, so no conflict."""
        user_a, user_b = uuid4(), uuid4()
        task = SimpleNamespace(annotation_number=7)
        anns = [
            _annotation(
                label_id=1,
                created_by_user_id=user_a,
                counts_toward_completion=True,
                annotation_task=task,
            ),
            _annotation(
                label_id=2,
                created_by_user_id=user_b,
                counts_toward_completion=False,
                annotation_task=task,
            ),
        ]

        assert _conflicting_task_numbers({1: anns}) == []

    def test_missing_flag_defaults_to_counting(self):
        """counts_toward_completion=None (unset/legacy) still counts, keeping
        pre-policy behavior for callers that never attach the flag."""
        user_a, user_b = uuid4(), uuid4()
        task = SimpleNamespace(annotation_number=9)
        anns = [
            _annotation(label_id=1, created_by_user_id=user_a, annotation_task=task),
            _annotation(label_id=2, created_by_user_id=user_b, annotation_task=task),
        ]

        assert _conflicting_task_numbers({1: anns}) == [9]

    def test_authoritative_label_present_skips_conflict(self):
        user_a, user_b = uuid4(), uuid4()
        task = SimpleNamespace(annotation_number=3)
        anns = [
            _annotation(
                label_id=1,
                created_by_user_id=user_a,
                counts_toward_completion=True,
                is_authoritative=True,
                annotation_task=task,
            ),
            _annotation(
                label_id=2,
                created_by_user_id=user_b,
                counts_toward_completion=True,
                annotation_task=task,
            ),
        ]

        assert _conflicting_task_numbers({1: anns}) == []

"""Unit tests for the pure export core in annotation/export.py.

These exercise the public ``build_export_records`` seam - no DB session - so
the status/conflict logic that used to be reached through private helpers is
now pinned through the records it actually emits. They mirror the same
policy-aware rule the live task-list/annotate API uses
(``compute_task_status_value`` in schemas.py): exports must not regress to
pre-policy status/conflict semantics just because they take a different,
N+1-avoiding code path over already-loaded ORM objects.

DB-free per repo convention: campaign/tasks/annotations are SimpleNamespace
stand-ins.
"""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.annotation.constants import (
    TASK_STATUS_CONFLICTING,
    TASK_STATUS_DONE,
    TASK_STATUS_PARTIAL,
)
from src.annotation.export import build_export_records


def _campaign():
    return SimpleNamespace(settings=SimpleNamespace(labels={}, form_fields=[]))


def _task(*, task_id=1, annotation_number=1, assignments=None):
    return SimpleNamespace(
        id=task_id,
        annotation_number=annotation_number,
        assignments=assignments or [],
        raw_source_data=None,
    )


def _annotation(
    *,
    label_id=None,
    created_by_user_id=None,
    is_authoritative=False,
    counts_toward_completion=None,
    task=None,
):
    return SimpleNamespace(
        id=1,
        source_id=None,
        label_id=label_id,
        created_by_user_id=created_by_user_id or uuid4(),
        is_authoritative=is_authoritative,
        counts_toward_completion=counts_toward_completion,
        comment=None,
        confidence=None,
        flagged_for_review=False,
        flag_comment=None,
        created_at=None,
        form_values=None,
        imagery_source_name=None,
        imagery_start_date=None,
        imagery_end_date=None,
        geometry=None,
        annotation_task=task,
        annotation_task_id=task.id if task else None,
    )


def _records(annotations, *, merge_on_agreement=False):
    records, _canonical, _columns = build_export_records(
        annotations=annotations,
        campaign=_campaign(),
        user_email_map={},
        merge_on_agreement=merge_on_agreement,
        include_geometry_wkt=False,
    )
    return records


class TestTaskStatusInExportRecords:
    """``stacnotator_task_status`` on emitted records reflects the shared
    ``compute_task_status_value`` rule applied over already-loaded objects."""

    def test_standalone_annotation_has_no_task_status(self):
        record = _records([_annotation(label_id=1)])[0]
        assert record.get("stacnotator_task_status") is None

    def test_conflicting_labels_from_two_assignees_is_conflicting(self):
        user_a, user_b = uuid4(), uuid4()
        task = _task(
            assignments=[
                SimpleNamespace(user_id=user_a, status="done", is_review=False),
                SimpleNamespace(user_id=user_b, status="done", is_review=False),
            ]
        )
        anns = [
            _annotation(
                label_id=1, created_by_user_id=user_a, counts_toward_completion=True, task=task
            ),
            _annotation(
                label_id=2, created_by_user_id=user_b, counts_toward_completion=True, task=task
            ),
        ]

        record = _records(anns)[0]
        assert record["stacnotator_task_status"] == TASK_STATUS_CONFLICTING

    def test_non_counting_extra_label_does_not_manufacture_conflict(self):
        """A member's extra label on an assigned task (allowed by
        assigned_tasks but not counted per complete_assigned) must not turn an
        otherwise-resolved task into a false conflict in the export - the
        counts_toward_completion flags must reach compute_task_status_value."""
        assignee = uuid4()
        extra_labeler = uuid4()
        task = _task(
            assignments=[SimpleNamespace(user_id=assignee, status="done", is_review=False)]
        )
        anns = [
            _annotation(
                label_id=1, created_by_user_id=assignee, counts_toward_completion=True, task=task
            ),
            _annotation(
                label_id=2,
                created_by_user_id=extra_labeler,
                counts_toward_completion=False,
                task=task,
            ),
        ]

        record = _records(anns)[0]
        assert record["stacnotator_task_status"] == TASK_STATUS_DONE

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
            _annotation(
                label_id=1, created_by_user_id=primary, counts_toward_completion=True, task=task
            ),
        ]

        # Review slot unfilled -> partial, not done (would be "done" if the
        # review assignment were dropped, since there'd be only one assignee).
        record = _records(anns)[0]
        assert record["stacnotator_task_status"] == TASK_STATUS_PARTIAL


class TestMergeOnAgreementConflictGuard:
    """A merge-on-agreement export rejects tasks with disagreeing counting
    labels, listing the human-readable annotation_number in the 400 detail."""

    def test_two_distinct_counting_labels_is_rejected(self):
        user_a, user_b = uuid4(), uuid4()
        task = _task(annotation_number=42)
        anns = [
            _annotation(
                label_id=1, created_by_user_id=user_a, counts_toward_completion=True, task=task
            ),
            _annotation(
                label_id=2, created_by_user_id=user_b, counts_toward_completion=True, task=task
            ),
        ]

        with pytest.raises(HTTPException) as exc:
            _records(anns, merge_on_agreement=True)
        assert exc.value.status_code == 400
        assert "#42" in exc.value.detail

    def test_non_counting_label_excluded_from_conflict_check(self):
        """Only one of the two differing labels counts - with the non-counting
        one excluded, there's just a single counting label, so no conflict and
        the merge is allowed."""
        user_a, user_b = uuid4(), uuid4()
        task = _task(annotation_number=7)
        anns = [
            _annotation(
                label_id=1, created_by_user_id=user_a, counts_toward_completion=True, task=task
            ),
            _annotation(
                label_id=2, created_by_user_id=user_b, counts_toward_completion=False, task=task
            ),
        ]

        # Does not raise.
        assert _records(anns, merge_on_agreement=True)

    def test_missing_flag_defaults_to_counting(self):
        """counts_toward_completion=None (unset/legacy) still counts, keeping
        pre-policy behavior for callers that never attach the flag."""
        user_a, user_b = uuid4(), uuid4()
        task = _task(annotation_number=9)
        anns = [
            _annotation(label_id=1, created_by_user_id=user_a, task=task),
            _annotation(label_id=2, created_by_user_id=user_b, task=task),
        ]

        with pytest.raises(HTTPException) as exc:
            _records(anns, merge_on_agreement=True)
        assert "#9" in exc.value.detail

    def test_authoritative_label_present_skips_conflict(self):
        user_a, user_b = uuid4(), uuid4()
        task = _task(annotation_number=3)
        anns = [
            _annotation(
                label_id=1,
                created_by_user_id=user_a,
                counts_toward_completion=True,
                is_authoritative=True,
                task=task,
            ),
            _annotation(
                label_id=2, created_by_user_id=user_b, counts_toward_completion=True, task=task
            ),
        ]

        # Authoritative label resolves the task -> no conflict, merge allowed.
        assert _records(anns, merge_on_agreement=True)

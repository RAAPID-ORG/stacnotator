"""Unit tests for annotation Pydantic schema validation of status fields."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from pydantic import ValidationError

from src.annotation.schemas import (
    AnnotationCreate,
    AnnotationFromTaskCreate,
    AnnotationTaskAssignmentOut,
    AnnotationTaskOut,
    AnnotationUpdate,
    compute_task_status_value,
)


def _base_assignment(status: str) -> dict:
    return {
        "user_id": str(uuid4()),
        "status": status,
        "is_review": False,
        "claimed_at": None,
        "user_email": None,
        "user_display_name": None,
    }


def _assignment_row(status: str, *, user_id=None, is_review: bool = False) -> SimpleNamespace:
    """An ORM-shaped `AnnotationTaskAssignment` stand-in: `AnnotationTaskOut`
    is only ever validated from real ORM rows in production, so tests that
    exercise its `compute_task_status` validator build attribute-bearing
    fakes rather than dicts."""
    return SimpleNamespace(
        user_id=user_id or uuid4(), status=status, is_review=is_review, claimed_at=None, user=None
    )


def _annotation_row(
    user_id, label_id, *, is_authoritative: bool = False, counts_toward_completion=None
) -> SimpleNamespace:
    """An ORM-shaped `Annotation` stand-in, matching `_assignment_row`."""
    return SimpleNamespace(
        id=1,
        label_id=label_id,
        created_by_user_id=user_id,
        is_authoritative=is_authoritative,
        comment=None,
        confidence=None,
        flagged_for_review=False,
        flag_comment=None,
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
        updated_at=datetime(2024, 1, 1, tzinfo=UTC),
        counts_toward_completion=counts_toward_completion,
        form_values=None,
        imagery_slice_id=None,
        imagery_source_name=None,
        imagery_start_date=None,
        imagery_end_date=None,
        creator=None,
    )


def _make_task_out_with_computed_status(assignments_data, annotations_data) -> AnnotationTaskOut:
    """Validate an ORM-shaped fake task and let compute_task_status derive
    task_status from it - the only path `AnnotationTaskOut` is built through
    in production (`AnnotationTaskOut.model_validate` on a real
    `AnnotationTask` row)."""
    mock_shape = MagicMock()
    mock_shape.wkt = "POINT (0 0)"
    fake_task = SimpleNamespace(
        id=1,
        annotation_number=1,
        task_set_id=1,
        geometry=SimpleNamespace(id=1, geometry=object()),
        assignments=assignments_data,
        annotations=annotations_data,
        has_embedding=False,
    )
    with patch("src.annotation.schemas.to_shape", return_value=mock_shape):
        return AnnotationTaskOut.model_validate(fake_task)


def test_assignment_status_pending_accepted():
    a = AnnotationTaskAssignmentOut(**_base_assignment("pending"))
    assert a.status == "pending"


def test_assignment_status_done_accepted():
    a = AnnotationTaskAssignmentOut(**_base_assignment("done"))
    assert a.status == "done"


def test_assignment_status_skipped_accepted():
    a = AnnotationTaskAssignmentOut(**_base_assignment("skipped"))
    assert a.status == "skipped"


def test_assignment_status_invalid_rejected():
    with pytest.raises(ValidationError):
        AnnotationTaskAssignmentOut(**_base_assignment("bogus"))


def test_task_status_pending_when_no_assignments():
    obj = _make_task_out_with_computed_status(assignments_data=[], annotations_data=[])
    assert obj.task_status == "pending"


def test_task_status_done_when_no_assignments_but_labeled():
    obj = _make_task_out_with_computed_status(
        assignments_data=[],
        annotations_data=[_annotation_row(uuid4(), label_id=1)],
    )
    assert obj.task_status == "done"


def test_task_status_skipped_when_all_assignments_skipped():
    obj = _make_task_out_with_computed_status(
        assignments_data=[_assignment_row("skipped")],
        annotations_data=[],
    )
    assert obj.task_status == "skipped"


def test_task_status_is_literal_type():
    """task_status field is annotated as Literal; verify type annotation is not plain str."""
    import typing

    hints = typing.get_type_hints(AnnotationTaskOut)
    origin = typing.get_origin(hints["task_status"])
    assert origin is typing.Literal, "task_status must be Literal[...], not plain str"


def test_assignment_status_is_literal_type():
    """status field is annotated as Literal; verify type annotation is not plain str."""
    import typing

    hints = typing.get_type_hints(AnnotationTaskAssignmentOut)
    origin = typing.get_origin(hints["status"])
    assert origin is typing.Literal, "status must be Literal[...], not plain str"


# ============================================================================
# compute_task_status_value: counts_toward_completion filtering
#
# Only annotations the labelling policy marks as counting may resolve
# (done), partially resolve, or conflict a task - "extra" labels from an
# allowed-but-non-counting audience must never move status on their own.
# ============================================================================


def _annotation(user_id, label_id, *, counts=True, is_authoritative=False):
    return {
        "label_id": label_id,
        "created_by_user_id": user_id,
        "is_authoritative": is_authoritative,
        "counts_toward_completion": counts,
    }


def _assignment(user_id, status="pending", is_review=False):
    return {"user_id": user_id, "status": status, "is_review": is_review}


def test_non_counting_label_alone_leaves_task_pending():
    user = uuid4()
    status = compute_task_status_value(
        [_assignment(user)],
        [_annotation(user, label_id=1, counts=False)],
    )
    assert status == "pending"


def test_non_counting_extra_label_does_not_complete_multi_assignee_task():
    """Second assignee's label is allowed (extra) but doesn't count: the task
    stays partial, as if only the first assignee had labeled."""
    counting_user, extra_user = uuid4(), uuid4()
    status = compute_task_status_value(
        [_assignment(counting_user), _assignment(extra_user)],
        [
            _annotation(counting_user, label_id=1, counts=True),
            _annotation(extra_user, label_id=1, counts=False),
        ],
    )
    assert status == "partial"


def test_counting_label_alone_completes_task():
    user = uuid4()
    status = compute_task_status_value(
        [_assignment(user)],
        [_annotation(user, label_id=1, counts=True)],
    )
    assert status == "done"


def test_non_counting_authoritative_label_does_not_auto_complete():
    """The authoritative short-circuit only applies to counting labels - a
    custom policy that excludes 'authoritative' from complete_assigned must
    not let an authoritative label resolve the task anyway."""
    user = uuid4()
    status = compute_task_status_value(
        [_assignment(user)],
        [_annotation(user, label_id=1, counts=False, is_authoritative=True)],
    )
    assert status == "pending"


def test_counting_conflict_unaffected_by_agreeing_non_counting_label():
    """Two counting assignees disagree (conflicting); a third, non-counting
    label that happens to agree with one of them must not resolve it."""
    a, b, extra = uuid4(), uuid4(), uuid4()
    status = compute_task_status_value(
        [_assignment(a), _assignment(b)],
        [
            _annotation(a, label_id=1, counts=True),
            _annotation(b, label_id=2, counts=True),
            _annotation(extra, label_id=1, counts=False),
        ],
    )
    assert status == "conflicting"


def test_missing_counts_toward_completion_key_defaults_to_counting():
    """Callers that don't pass the flag at all (pre-policy shape) keep the
    original behavior: the label counts."""
    user = uuid4()
    status = compute_task_status_value(
        [_assignment(user)],
        [{"label_id": 1, "created_by_user_id": user, "is_authoritative": False}],
    )
    assert status == "done"


def test_none_counts_toward_completion_value_defaults_to_counting():
    user = uuid4()
    status = compute_task_status_value(
        [_assignment(user)],
        [_annotation(user, label_id=1, counts=None)],
    )
    assert status == "done"


# ============================================================================
# compute_task_status_value: review-slot satisfaction by non-assigned users
#
# Spec decision 4: a review assignment sets a required review-label count;
# any counting label from a user other than the primary annotator satisfies
# one slot, even if that user isn't one of the assigned reviewers.
# ============================================================================


def test_drive_by_counting_label_satisfies_review_slot():
    """Primary labels; a user with NO assignment row on the task (not one of
    the assigned reviewers) supplies a counting label - the single required
    review slot is satisfied and the task is done."""
    primary, drive_by = uuid4(), uuid4()
    reviewer = uuid4()
    status = compute_task_status_value(
        [_assignment(primary), _assignment(reviewer, is_review=True)],
        [
            _annotation(primary, label_id=1, counts=True),
            _annotation(drive_by, label_id=1, counts=True),
        ],
    )
    assert status == "done"


def test_drive_by_non_counting_label_does_not_satisfy_review_slot():
    """Same setup, but the drive-by user's label doesn't count - the review
    slot stays unfilled and the task remains partial."""
    primary, drive_by = uuid4(), uuid4()
    reviewer = uuid4()
    status = compute_task_status_value(
        [_assignment(primary), _assignment(reviewer, is_review=True)],
        [
            _annotation(primary, label_id=1, counts=True),
            _annotation(drive_by, label_id=1, counts=False),
        ],
    )
    assert status == "partial"


def test_assigned_reviewer_own_label_still_satisfies_review_slot():
    """Existing flow unchanged: the actually-assigned reviewer's own counting
    label satisfies the slot, exactly as before."""
    primary, reviewer = uuid4(), uuid4()
    status = compute_task_status_value(
        [_assignment(primary), _assignment(reviewer, is_review=True)],
        [
            _annotation(primary, label_id=1, counts=True),
            _annotation(reviewer, label_id=1, counts=True),
        ],
    )
    assert status == "done"


def test_review_slot_requires_primary_label_too():
    """A drive-by reviewer label alone, without the primary annotator having
    labeled, is not enough - the task is partial, not done."""
    primary, drive_by = uuid4(), uuid4()
    reviewer = uuid4()
    status = compute_task_status_value(
        [_assignment(primary), _assignment(reviewer, is_review=True)],
        [_annotation(drive_by, label_id=1, counts=True)],
    )
    assert status == "partial"


def test_two_review_slots_need_two_distinct_counting_labelers():
    """N=2 review requirement: one drive-by counting label is not enough."""
    primary, drive_by = uuid4(), uuid4()
    reviewer_a, reviewer_b = uuid4(), uuid4()
    status = compute_task_status_value(
        [
            _assignment(primary),
            _assignment(reviewer_a, is_review=True),
            _assignment(reviewer_b, is_review=True),
        ],
        [
            _annotation(primary, label_id=1, counts=True),
            _annotation(drive_by, label_id=1, counts=True),
        ],
    )
    assert status == "partial"


def test_two_review_slots_satisfied_by_mixed_assigned_and_drive_by_users():
    """N=2 review requirement met by one assigned reviewer plus one drive-by
    user - identity of the reviewer doesn't matter, only the count."""
    primary, drive_by = uuid4(), uuid4()
    reviewer_a, reviewer_b = uuid4(), uuid4()
    status = compute_task_status_value(
        [
            _assignment(primary),
            _assignment(reviewer_a, is_review=True),
            _assignment(reviewer_b, is_review=True),
        ],
        [
            _annotation(primary, label_id=1, counts=True),
            _annotation(reviewer_a, label_id=1, counts=True),
            _annotation(drive_by, label_id=1, counts=True),
        ],
    )
    assert status == "done"


def test_disagreeing_drive_by_review_label_causes_conflicting():
    """A drive-by counting label that disagrees with the primary's label
    still surfaces as a conflict, once it fills the review slot."""
    primary, drive_by = uuid4(), uuid4()
    reviewer = uuid4()
    status = compute_task_status_value(
        [_assignment(primary), _assignment(reviewer, is_review=True)],
        [
            _annotation(primary, label_id=1, counts=True),
            _annotation(drive_by, label_id=2, counts=True),
        ],
    )
    assert status == "conflicting"


def test_no_review_assignments_drive_by_label_ignored_as_before():
    """No review requirement on the task at all: a drive-by counting label
    from a non-assigned user must not affect status, matching pre-existing
    behavior (only assigned users are compared when there's no review)."""
    primary, drive_by = uuid4(), uuid4()
    status = compute_task_status_value(
        [_assignment(primary)],
        [
            _annotation(primary, label_id=1, counts=True),
            _annotation(drive_by, label_id=2, counts=True),
        ],
    )
    assert status == "done"


def test_annotation_task_out_computes_status_from_counting_flag():
    """End-to-end through the pydantic model_validator (not just the pure
    function): an annotation carrying counts_toward_completion=False must
    not resolve the task, exercising the same code path the API uses when
    serializing AnnotationTaskOut."""
    user = uuid4()
    obj = _make_task_out_with_computed_status(
        assignments_data=[_assignment_row("done")],
        annotations_data=[_annotation_row(user, label_id=1, counts_toward_completion=False)],
    )
    assert obj.task_status == "pending"


def test_annotation_task_out_threads_is_review_through_assignment_rows():
    """End-to-end regression for `task_status_inputs`: is_review must be
    carried from each ORM-shaped assignment row into the dict
    `compute_task_status_value` consumes, or a drive-by reviewer's counting
    label would never satisfy a review slot."""
    primary, drive_by = uuid4(), uuid4()
    reviewer = uuid4()
    obj = _make_task_out_with_computed_status(
        assignments_data=[
            _assignment_row("pending", user_id=primary),
            _assignment_row("pending", user_id=reviewer, is_review=True),
        ],
        annotations_data=[
            _annotation_row(primary, label_id=1, counts_toward_completion=True),
            _annotation_row(drive_by, label_id=1, counts_toward_completion=True),
        ],
    )
    assert obj.task_status == "done"


class TestCommentLengthCaps:
    """comment/flag_comment are capped at 5000 chars on every write schema -
    the DB column stays Text, so the cap lives at the schema boundary."""

    @pytest.mark.parametrize(
        "build",
        [
            lambda text: AnnotationFromTaskCreate(label_id=1, comment=text),
            lambda text: AnnotationFromTaskCreate(label_id=1, comment=None, flag_comment=text),
            lambda text: AnnotationCreate(label_id=1, comment=text, geometry_wkt="POINT (0 0)"),
            lambda text: AnnotationCreate(
                label_id=1, comment=None, geometry_wkt="POINT (0 0)", flag_comment=text
            ),
            lambda text: AnnotationUpdate(
                label_id=1, comment=text, geometry_wkt=None, is_authoritative=None
            ),
            lambda text: AnnotationUpdate(
                label_id=1,
                comment=None,
                geometry_wkt=None,
                is_authoritative=None,
                flag_comment=text,
            ),
        ],
    )
    def test_comment_fields_reject_over_5000(self, build):
        with pytest.raises(ValidationError):
            build("x" * 5001)

    def test_comment_stays_required_on_write_schemas(self):
        # The 5000 cap must not silently turn comment optional (it is
        # required-but-nullable); omitting it entirely still fails.
        with pytest.raises(ValidationError):
            AnnotationFromTaskCreate(label_id=1)
        with pytest.raises(ValidationError):
            AnnotationCreate(label_id=1, geometry_wkt="POINT (0 0)")
        with pytest.raises(ValidationError):
            AnnotationUpdate(label_id=1, geometry_wkt=None, is_authoritative=None)

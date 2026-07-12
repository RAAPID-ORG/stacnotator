"""Unit tests for annotation Pydantic schema validation of status fields."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from pydantic import ValidationError

from src.annotation.schemas import (
    AnnotationTaskAssignmentOut,
    AnnotationTaskOut,
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


def _make_task_out_with_computed_status(assignments_data, annotations_data) -> AnnotationTaskOut:
    """Construct AnnotationTaskOut and let compute_task_status derive task_status from data."""
    mock_shape = MagicMock()
    mock_shape.wkt = "POINT (0 0)"
    with patch("src.annotation.schemas.to_shape", return_value=mock_shape):
        return AnnotationTaskOut(
            id=1,
            annotation_number=1,
            task_set_id=1,
            geometry={"id": 1, "geometry": object()},
            assignments=assignments_data,
            annotations=annotations_data,
        )


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
    annotation = {
        "id": 1,
        "label_id": 1,
        "created_by_user_id": str(uuid4()),
        "is_authoritative": False,
        "comment": None,
        "confidence": None,
        "flagged_for_review": False,
        "flag_comment": None,
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
    }
    obj = _make_task_out_with_computed_status(
        assignments_data=[],
        annotations_data=[annotation],
    )
    assert obj.task_status == "done"


def test_task_status_skipped_when_all_assignments_skipped():
    user_id = str(uuid4())
    assignment = {
        "user_id": user_id,
        "status": "skipped",
        "is_review": False,
        "claimed_at": None,
        "user_email": None,
        "user_display_name": None,
    }
    obj = _make_task_out_with_computed_status(
        assignments_data=[assignment],
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


def _assignment(user_id, status="pending"):
    return {"user_id": user_id, "status": status}


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


def test_annotation_task_out_computes_status_from_counting_flag_via_dict_annotations():
    """End-to-end through the pydantic model_validator (not just the pure
    function): a dict-shaped annotation carrying counts_toward_completion=False
    must not resolve the task, exercising the same code path the API uses
    when serializing AnnotationTaskOut."""
    user = uuid4()
    obj = _make_task_out_with_computed_status(
        assignments_data=[_base_assignment("done")],
        annotations_data=[
            {
                "id": 1,
                "label_id": 1,
                "created_by_user_id": str(user),
                "comment": None,
                "confidence": None,
                "is_authoritative": False,
                "flagged_for_review": False,
                "flag_comment": None,
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2024-01-01T00:00:00Z",
                "counts_toward_completion": False,
            }
        ],
    )
    assert obj.task_status == "pending"

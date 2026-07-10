"""Unit tests for annotation Pydantic schema validation of status fields."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from pydantic import ValidationError

from src.annotation.schemas import AnnotationTaskAssignmentOut, AnnotationTaskOut


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

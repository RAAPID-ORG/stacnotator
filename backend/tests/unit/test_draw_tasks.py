"""Draw tasks: a task finished by the shapes drawn around it instead of a label.

DB-free per repo convention: the pure outcome rules are tested directly, the
service wiring over MagicMock sessions (mirrors test_annotation_form_values_wiring.py).
"""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.annotation.schemas import (
    AnnotationCreate,
    TaskAnswerCreate,
)
from src.annotation.service import add_annotation_for_task, create_annotation
from src.campaigns.schemas import PolicyAudience
from src.tasks.status import (
    compute_task_status_value,
    resolve_task_outcome,
)
from tests.conftest import make_policy

pytestmark = pytest.mark.usefixtures("membership_from_db_mock")


def _answer(user_id, answer):
    return {
        "answer": answer,
        "created_by_user_id": user_id,
        "is_authoritative": False,
        "counts_toward_completion": True,
    }


def _campaign(task_output):
    campaign = MagicMock()
    campaign.id = 1
    campaign.is_public = False
    campaign.task_output = task_output
    campaign.label_names = {1: "Field"}
    campaign.form_fields = []
    campaign.labelling_policy = make_policy(
        explore=PolicyAudience(kinds=["members"]),
        unassigned_tasks=PolicyAudience(kinds=["members"]),
        assigned_tasks=PolicyAudience(kinds=["members"]),
        complete_assigned=PolicyAudience(kinds=["members"]),
    ).model_dump(mode="json")
    return campaign


def _db(campaign, *, has_shapes=False):
    db = MagicMock()
    db.get.return_value = campaign
    db.execute.return_value.scalar_one_or_none.return_value = None
    db.scalars.return_value.first.return_value = SimpleNamespace(
        is_admin=False, is_authoritative_reviewer=False
    )
    db.scalar.return_value = has_shapes
    return db


def _task():
    return SimpleNamespace(id=1, campaign_id=1, geometry="POINT(0 0)", assignments=[])


def test_classify_outcome_follows_the_label():
    assert resolve_task_outcome("classify", 3, None) == "labelled"
    assert resolve_task_outcome("classify", None, None) == "skipped"


@pytest.mark.parametrize(
    ("task_output", "label_id", "outcome"),
    [
        ("draw", None, None),
        ("draw", 1, "drawn"),
        ("draw", None, "labelled"),
        ("classify", None, "drawn"),
    ],
)
def test_outcome_that_does_not_fit_the_campaign_is_rejected(task_output, label_id, outcome):
    with pytest.raises(ValueError):
        resolve_task_outcome(task_output, label_id, outcome)


def test_draw_answers_agree_and_disagree_like_labels():
    a, b = uuid4(), uuid4()
    assignments = [{"user_id": a, "is_review": False}, {"user_id": b, "is_review": False}]

    agreed = [_answer(a, "drawn"), _answer(b, "drawn")]
    disputed = [_answer(a, "drawn"), _answer(b, "none_found")]

    assert compute_task_status_value(assignments, agreed) == "done"
    assert compute_task_status_value(assignments, disputed) == "conflicting"


def test_done_needs_a_shape_of_your_own():
    campaign = _campaign("draw")
    db = _db(campaign, has_shapes=False)

    with pytest.raises(HTTPException) as exc:
        add_annotation_for_task(
            db,
            _task(),
            TaskAnswerCreate(label_id=None, comment=None, outcome="drawn"),
            uuid4(),
        )

    assert exc.value.status_code == 400
    db.add.assert_not_called()


def test_done_is_stored_as_drawn():
    campaign = _campaign("draw")
    db = _db(campaign, has_shapes=True)

    annotation = add_annotation_for_task(
        db, _task(), TaskAnswerCreate(label_id=None, comment=None, outcome="drawn"), uuid4()
    )

    assert annotation.outcome == "drawn"
    assert annotation.label_id is None


def test_shapes_cannot_answer_a_classify_task():
    campaign = _campaign("classify")
    payload = AnnotationCreate(
        label_id=1, comment=None, geometry_wkt="POINT(0 0)", output_of_task_id=1
    )

    with pytest.raises(HTTPException) as exc:
        create_annotation(_db(campaign), campaign, payload, uuid4())

    assert exc.value.status_code == 400


def test_nothing_here_is_refused_once_you_drew():
    campaign = _campaign("draw")
    db = _db(campaign, has_shapes=True)

    with pytest.raises(HTTPException) as exc:
        add_annotation_for_task(
            db,
            _task(),
            TaskAnswerCreate(label_id=None, comment=None, outcome="none_found"),
            uuid4(),
        )

    assert exc.value.status_code == 400

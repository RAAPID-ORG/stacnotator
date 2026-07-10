"""Task-set service guards, tested with mocked sessions (no DB)."""

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from src.campaigns import task_sets
from src.campaigns.models import TaskSet


def make_set(set_id=1, campaign_id=10, name="Default"):
    ts = TaskSet(campaign_id=campaign_id, name=name)
    ts.id = set_id
    return ts


def test_require_task_set_rejects_other_campaigns_set():
    db = MagicMock()
    db.get.return_value = make_set(campaign_id=99)
    with pytest.raises(HTTPException) as exc:
        task_sets.require_task_set(db, campaign_id=10, task_set_id=1)
    assert exc.value.status_code == 404


def test_require_task_set_missing_uses_given_status():
    db = MagicMock()
    db.get.return_value = None
    with pytest.raises(HTTPException) as exc:
        task_sets.require_task_set(db, campaign_id=10, task_set_id=1, status_code=400)
    assert exc.value.status_code == 400


def test_create_task_set_rejects_duplicate_name():
    db = MagicMock()
    db.scalar.return_value = make_set()
    with pytest.raises(HTTPException) as exc:
        task_sets.create_task_set(db, campaign_id=10, name="Default")
    assert exc.value.status_code == 409


def test_delete_task_set_rejects_last_set():
    db = MagicMock()
    db.get.return_value = make_set()
    db.scalar.return_value = 1  # only one set left in the campaign
    with pytest.raises(HTTPException) as exc:
        task_sets.delete_task_set(db, campaign_id=10, task_set_id=1)
    assert exc.value.status_code == 409


def test_delete_task_set_deletes_tasks_then_set():
    db = MagicMock()
    target = make_set()
    db.get.return_value = target
    db.scalar.return_value = 2
    fake_tasks = [MagicMock(), MagicMock()]
    db.scalars.return_value.all.return_value = fake_tasks
    task_sets.delete_task_set(db, campaign_id=10, task_set_id=1)
    deleted = [call.args[0] for call in db.delete.call_args_list]
    assert deleted == fake_tasks + [target]
    db.commit.assert_called_once()


def test_rename_task_set_rejects_duplicate_name():
    db = MagicMock()
    db.get.return_value = make_set(name="A")
    db.scalar.return_value = make_set(set_id=2, name="B")
    with pytest.raises(HTTPException) as exc:
        task_sets.rename_task_set(db, campaign_id=10, task_set_id=1, name="B")
    assert exc.value.status_code == 409

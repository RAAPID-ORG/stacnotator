"""Task-set service guards, tested with mocked sessions (no DB)."""

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src.campaigns import task_sets
from src.campaigns.models import TaskSet
from src.campaigns.schemas import TaskSetCreate


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


def test_move_tasks_rejects_ids_outside_campaign():
    db = MagicMock()
    db.get.return_value = make_set()
    db.scalars.return_value.all.return_value = [1]  # only task 1 found in campaign
    with pytest.raises(HTTPException) as exc:
        task_sets.move_tasks_to_set(db, campaign_id=10, task_set_id=1, task_ids=[1, 2])
    assert exc.value.status_code == 404
    assert "2" in exc.value.detail


def test_move_tasks_empty_list_is_noop():
    db = MagicMock()
    db.get.return_value = make_set()
    assert task_sets.move_tasks_to_set(db, campaign_id=10, task_set_id=1, task_ids=[]) == 0
    db.execute.assert_not_called()


def test_move_tasks_updates_and_commits():
    db = MagicMock()
    db.get.return_value = make_set()
    db.scalars.return_value.all.return_value = [1, 2]
    moved = task_sets.move_tasks_to_set(db, campaign_id=10, task_set_id=1, task_ids=[1, 2])
    assert moved == 2
    db.execute.assert_called_once()
    db.commit.assert_called_once()


def test_move_tasks_reports_distinct_count_for_duplicate_ids():
    db = MagicMock()
    db.get.return_value = make_set()
    db.scalars.return_value.all.return_value = [5]  # only task 5 exists in the campaign
    moved = task_sets.move_tasks_to_set(db, campaign_id=10, task_set_id=1, task_ids=[5, 5])
    assert moved == 1


def test_task_set_create_rejects_blank_name():
    with pytest.raises(ValidationError):
        TaskSetCreate(name="  ")


def test_task_set_create_strips_name():
    assert TaskSetCreate(name=" a ").name == "a"

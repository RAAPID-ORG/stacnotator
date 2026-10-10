from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from seed_dev_data import (
    UKRAINE_BBOX,
    _monthly_slices,
    _seed_tasks,
    _stac_search_query,
    _wait_for_registration,
)
from src.annotation.models import AnnotationTaskAssignment
from src.auth.models import User
from src.campaigns.models import Campaign
from src.imagery.registration import _resolved_search_body


def test_monthly_slices_cover_the_year_without_overlap():
    slices = _monthly_slices(2024)
    assert len(slices) == 12
    assert slices[0].start_date == "2024-01-01"
    assert slices[-1].end_date == "2024-12-31"
    assert slices[1].end_date == "2024-02-29"
    for previous, current in zip(slices, slices[1:], strict=False):
        assert date.fromisoformat(previous.end_date) + timedelta(days=1) == date.fromisoformat(
            current.start_date
        )
    assert _monthly_slices(2025)[1].end_date == "2025-02-28"


def test_seed_search_query_resolves_the_slice_dates():
    query = _stac_search_query()
    bbox = list(UKRAINE_BBOX.values())
    body = _resolved_search_body(query, bbox, _monthly_slices(2024)[0])
    assert body["collections"] == ["sentinel-2-l2a"]
    assert body["filterLang"] == "cql2-json"
    assert body["bbox"] == bbox
    assert body["filter"]["args"][0]["args"][1]["interval"] == [
        "2024-01-01T00:00:00Z",
        "2024-01-31T23:59:59Z",
    ]
    assert body["filter"]["args"][1]["args"][1]["args"][1] == 70
    assert query["filter"]["args"][0]["args"][1]["interval"] == ["{sliceStart}", "{sliceEnd}"]


def test_seed_tasks_uses_the_default_task_set_and_assigns_each_task(sample_user_id):
    db = MagicMock()
    db.execute.return_value.scalar_one.return_value = 8
    db.scalars.return_value = [10, 11]
    campaign = Campaign(id=3)
    user = User(id=sample_user_id)

    with patch("seed_dev_data.create_tasks_from_sampling_strategy") as generate:
        assert _seed_tasks(db, campaign, user) == [10, 11]

    args = generate.call_args.args
    assert args[0] is db
    assert args[1] == 3
    assert args[2].num_samples == 100
    assert args[2].seed == 42
    assert args[3].bounds == tuple(UKRAINE_BBOX.values())
    assert args[4] == 8
    statement, assignments = db.execute.call_args.args
    assert statement.table.name == AnnotationTaskAssignment.__tablename__
    assert assignments == [
        {"task_id": 10, "user_id": sample_user_id},
        {"task_id": 11, "user_id": sample_user_id},
    ]
    db.commit.assert_called_once()


def test_seed_waits_for_registration_to_finish():
    db = MagicMock()
    db.get.side_effect = [
        SimpleNamespace(registration_status="registering", registration_errors=None),
        SimpleNamespace(registration_status="ready", registration_errors=None),
    ]
    with patch("seed_dev_data.time.sleep") as sleep:
        _wait_for_registration(db, 3)
    sleep.assert_called_once_with(1)
    assert db.rollback.call_count == 2


@pytest.mark.parametrize(
    ("status", "exception", "message"),
    [
        ("failed", RuntimeError, "provider unavailable"),
        ("registering", TimeoutError, "timed out"),
    ],
)
def test_seed_does_not_report_success_when_registration_fails(status, exception, message):
    db = MagicMock()
    db.get.return_value = SimpleNamespace(
        registration_status=status,
        registration_errors=[{"error": "provider unavailable"}],
    )
    with pytest.raises(exception, match=message):
        _wait_for_registration(db, 3, timeout=0)

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src.timeseries import service
from src.timeseries.schemas import TimeseriesWindowRenameRequest


def _db(window, taken=None):
    db = MagicMock()
    db.scalar.side_effect = [window, taken]
    return db


def test_rename_changes_the_window_row_alone():
    window = SimpleNamespace(id=3, name="Vegetation")
    db = _db(window)

    service.rename_timeseries_window(7, 3, "Greenness", db)

    assert window.name == "Greenness"
    db.commit.assert_called_once()


@pytest.mark.parametrize(
    ("window", "taken", "status"),
    [(None, None, 404), (SimpleNamespace(id=3, name="Vegetation"), 4, 409)],
)
def test_invalid_rename_does_not_write(window, taken, status):
    db = _db(window, taken)

    with pytest.raises(HTTPException) as error:
        service.rename_timeseries_window(7, 3, "Water", db)

    assert error.value.status_code == status
    assert window is None or window.name == "Vegetation"
    db.commit.assert_not_called()


def test_rename_request_trims_and_rejects_blank_names():
    assert TimeseriesWindowRenameRequest(name=" Greenness ").name == "Greenness"
    with pytest.raises(ValidationError):
        TimeseriesWindowRenameRequest(name="  ")

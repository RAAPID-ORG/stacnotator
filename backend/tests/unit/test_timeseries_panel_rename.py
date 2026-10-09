from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src.canvas.layout import rename_window_in_layout
from src.timeseries import service
from src.timeseries.models import TimeSeries
from src.timeseries.schemas import TimeseriesPanelRenameRequest


def test_rename_preserves_window_position_size_and_hidden_windows():
    layout = [
        {"i": "main", "x": 0, "y": 0, "w": 43, "h": 25},
        {"i": "timeseries:Vegetation", "x": 10, "y": 30, "w": 14, "h": 12},
    ]
    assert rename_window_in_layout(layout, "timeseries:Vegetation", "timeseries:Greenness")
    assert layout[1] == {"i": "timeseries:Greenness", "x": 10, "y": 30, "w": 14, "h": 12}
    assert layout[0]["i"] == "main"
    assert not rename_window_in_layout(layout, "timeseries:Water", "timeseries:Rainfall")
    assert len(layout) == 2


def test_rename_updates_all_matching_series_and_syncs_layouts(monkeypatch):
    series = [
        TimeSeries(window_name="Vegetation"),
        TimeSeries(window_name="Vegetation"),
        TimeSeries(window_name="Water"),
    ]
    db = MagicMock()
    db.execute.return_value.scalars.return_value.all.return_value = series
    sync = MagicMock()
    monkeypatch.setattr(service, "sync_main_layouts", sync)

    service.rename_timeseries_panel(7, "Vegetation", "Greenness", db)

    assert [item.window_name for item in series] == ["Greenness", "Greenness", "Water"]
    sync.assert_called_once()
    assert sync.call_args.args[:2] == (db, 7)
    layout = [{"i": "timeseries:Vegetation", "x": 4, "y": 6, "w": 10, "h": 11}]
    assert sync.call_args.args[2](layout)
    assert layout[0]["i"] == "timeseries:Greenness"
    db.commit.assert_called_once()


@pytest.mark.parametrize(
    ("old_name", "new_name", "status"),
    [("Missing", "Greenness", 404), ("Vegetation", "Water", 409)],
)
def test_invalid_rename_does_not_write(old_name, new_name, status, monkeypatch):
    series = [TimeSeries(window_name="Vegetation"), TimeSeries(window_name="Water")]
    db = MagicMock()
    db.execute.return_value.scalars.return_value.all.return_value = series
    sync = MagicMock()
    monkeypatch.setattr(service, "sync_main_layouts", sync)

    with pytest.raises(HTTPException) as error:
        service.rename_timeseries_panel(7, old_name, new_name, db)

    assert error.value.status_code == status
    assert [item.window_name for item in series] == ["Vegetation", "Water"]
    db.commit.assert_not_called()
    sync.assert_not_called()


def test_rename_request_trims_names():
    request = TimeseriesPanelRenameRequest(old_name=" Vegetation ", new_name=" Greenness ")
    assert request.old_name == "Vegetation"
    assert request.new_name == "Greenness"


@pytest.mark.parametrize("field", ["old_name", "new_name"])
def test_rename_request_rejects_blank_names(field):
    names = {"old_name": "Vegetation", "new_name": "Greenness", field: "  "}
    with pytest.raises(ValidationError):
        TimeseriesPanelRenameRequest(**names)

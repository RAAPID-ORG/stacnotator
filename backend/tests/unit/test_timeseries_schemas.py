import pytest

from src.timeseries.schemas import TimeSeriesCreate
from src.timeseries.windows import DEFAULT_TIMESERIES_WINDOW_NAME


def _make(window_name):
    return TimeSeriesCreate(
        name="ts",
        window_name=window_name,
        start_ym="202401",
        end_ym="202412",
        data_source="MODIS",
        provider="EE",
        ts_type="NDVI",
    )


@pytest.mark.parametrize("value", ["", "   "])
def test_blank_window_name_falls_back_to_default(value):
    # Every series belongs to a named window; a blank name is the default one,
    # never a stray empty-named window.
    assert _make(value).window_name == DEFAULT_TIMESERIES_WINDOW_NAME


def test_window_name_is_trimmed():
    assert _make("  Vegetation  ").window_name == "Vegetation"


def test_window_name_defaults_when_omitted():
    ts = TimeSeriesCreate(
        name="ts",
        start_ym="202401",
        end_ym="202412",
        data_source="MODIS",
        provider="EE",
        ts_type="NDVI",
    )
    assert ts.window_name == DEFAULT_TIMESERIES_WINDOW_NAME

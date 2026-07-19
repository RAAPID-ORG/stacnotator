import pytest

from src.timeseries.schemas import TimeSeriesCreate


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


@pytest.mark.parametrize("value", [None, "", "   "])
def test_blank_window_name_normalizes_to_none(value):
    # Blank/whitespace must land in the default window (NULL), not create a
    # stray empty-named window.
    assert _make(value).window_name is None


def test_window_name_is_trimmed():
    assert _make("  Vegetation  ").window_name == "Vegetation"


def test_window_name_defaults_to_none_when_omitted():
    ts = TimeSeriesCreate(
        name="ts",
        start_ym="202401",
        end_ym="202412",
        data_source="MODIS",
        provider="EE",
        ts_type="NDVI",
    )
    assert ts.window_name is None

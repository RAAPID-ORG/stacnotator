import pytest

from src.timeseries.schemas import TimeSeriesCreate, parse_ym, ym_range_to_dates
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


def test_parse_ym_valid():
    assert parse_ym("202401") == (2024, 1)
    assert parse_ym("199912") == (1999, 12)


@pytest.mark.parametrize("ym", ["", "2024", "2024011", "2024ab", "202400", "202413"])
def test_parse_ym_invalid(ym):
    with pytest.raises(ValueError):
        parse_ym(ym)


def test_ym_range_spans_full_months():
    assert ym_range_to_dates("202401", "202403") == ("2024-01-01", "2024-03-31")
    assert ym_range_to_dates("202304", "202304") == ("2023-04-01", "2023-04-30")


def test_ym_range_handles_leap_february():
    assert ym_range_to_dates("202402", "202402") == ("2024-02-01", "2024-02-29")
    assert ym_range_to_dates("202302", "202302") == ("2023-02-01", "2023-02-28")

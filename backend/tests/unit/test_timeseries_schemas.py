import pytest
from pydantic import ValidationError

from src.timeseries.schemas import (
    TimeSeriesCreate,
    TimeSeriesOut,
    parse_ym,
    timeseries_options,
    ym_range_to_dates,
)
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


def _create(**overrides):
    return TimeSeriesCreate(
        **{
            "name": "ts",
            "start_ym": "202401",
            "end_ym": "202412",
            "data_source": "SENTINEL2",
            "provider": "EE",
            "ts_type": "NDVI",
            **overrides,
        }
    )


class TestSourceAndIndexValidation:
    """A series that names an index its source cannot compute would save fine and
    then fail for every annotator who opened it, so it is refused up front."""

    def test_rejects_an_index_the_source_lacks_the_bands_for(self):
        with pytest.raises(ValidationError, match="NDRE"):
            _create(data_source="MODIS", ts_type="NDRE")

    def test_rejects_an_unknown_index(self):
        with pytest.raises(ValidationError, match="Unknown index"):
            _create(ts_type="NDXX")

    def test_rejects_an_unknown_source(self):
        with pytest.raises(ValidationError, match="Unsupported data source"):
            _create(data_source="SENTINEL3")

    def test_rejects_an_unknown_provider(self):
        with pytest.raises(ValidationError, match="Unsupported provider"):
            _create(provider="STAC")

    def test_accepts_the_indices_a_source_does_carry(self):
        assert _create(data_source="LANDSAT", ts_type="NBR").ts_type == "NBR"
        assert _create(data_source="SENTINEL2", ts_type="NDRE").ts_type == "NDRE"

    def test_stores_canonical_keys(self):
        item = _create(data_source=" landsat ", ts_type=" ndmi ")
        assert (item.data_source, item.ts_type) == ("LANDSAT", "NDMI")


class TestOutputCarriesTheIndexDescription:
    def test_chart_metadata_travels_with_the_series(self):
        out = TimeSeriesOut(
            id=1,
            campaign_id=2,
            name="ts",
            window_name="Time series",
            start_ym="202401",
            end_ym="202412",
            data_source="SENTINEL2",
            provider="EE",
            ts_type="GCVI",
        )
        assert out.index is not None
        assert (out.index.domain_min, out.index.domain_max) == (0.0, 10.0)
        assert out.index.formula == "NIR / Green - 1"

    def test_an_unrecognised_stored_index_lists_instead_of_failing(self):
        out = TimeSeriesOut(
            id=1,
            campaign_id=2,
            name="ts",
            window_name="Time series",
            start_ym="202401",
            end_ym="202412",
            data_source="SENTINEL2",
            provider="EE",
            ts_type="RETIRED",
        )
        assert out.index is None


class TestCreationOptions:
    def test_every_source_advertises_only_indices_it_can_compute(self):
        options = timeseries_options()
        known = {index.key for index in options.indices}
        assert options.sources
        for source in options.sources:
            assert source.index_keys
            assert set(source.index_keys) <= known


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

"""Point extraction: the operator adapter, the frame shaping, and error mapping."""

from unittest.mock import MagicMock

import ee
import pandas as pd
import pytest

from src.timeseries import fetch
from src.timeseries.indices import INDICES_BY_KEY
from src.timeseries.sources import TimeseriesSource


class _FakeBand:
    """Stands in for a single-band ee.Image, implementing the named methods the
    operator adapter is supposed to call. Because it computes real numbers, a
    formula evaluated through the adapter can be checked against the same
    formula evaluated on floats - which is what catches an adapter that maps
    __sub__ to add(), or a formula that reads the wrong band."""

    def __init__(self, value: float, name: str = ""):
        self.value = value
        self.name = name

    @staticmethod
    def _value(other):
        return other.value if isinstance(other, _FakeBand) else other

    def add(self, other):
        return _FakeBand(self.value + self._value(other))

    def subtract(self, other):
        return _FakeBand(self.value - self._value(other))

    def multiply(self, other):
        return _FakeBand(self.value * self._value(other))

    def divide(self, other):
        return _FakeBand(self.value / self._value(other))

    def rename(self, name):
        return _FakeBand(self.value, name)


class _FakeImage:
    def __init__(self, bands: dict[str, float]):
        self.bands = bands

    def select(self, role):
        return _FakeBand(self.bands[role])


BANDS = {
    "green": 0.05,
    "red": 0.04,
    "rededge1": 0.12,
    "nir": 0.40,
    "nir08": 0.42,
    "swir1": 0.20,
    "swir2": 0.10,
}


class TestIndexImage:
    @pytest.mark.parametrize("key", ["NDVI", "EVI2", "GCVI", "NDMI", "NBR", "MNDWI", "NDRE"])
    def test_operator_adapter_reproduces_the_plain_float_result(self, key):
        index = INDICES_BY_KEY[key]
        built = fetch.index_image(_FakeImage(BANDS), index)
        assert built.value == pytest.approx(index.formula(BANDS))

    def test_result_is_named_for_extraction(self):
        assert fetch.index_image(_FakeImage(BANDS), INDICES_BY_KEY["NDVI"]).name == "value"


class TestImageTermReflectedOperators:
    """Only __rmul__ is exercised by today's formulas; the rest are here so a
    future index cannot silently get subtraction or division backwards."""

    def test_scalar_minus_term(self, monkeypatch):
        monkeypatch.setattr(fetch.ee.Image, "constant", _FakeBand)
        assert (1.0 - fetch._ImageTerm(_FakeBand(0.25))).image.value == pytest.approx(0.75)

    def test_scalar_divided_by_term(self, monkeypatch):
        monkeypatch.setattr(fetch.ee.Image, "constant", _FakeBand)
        assert (1.0 / fetch._ImageTerm(_FakeBand(4.0))).image.value == pytest.approx(0.25)


class TestRegionDataToDataframe:
    def test_shapes_columns_and_fills_missing_cloud(self):
        times = [int(pd.Timestamp(t).timestamp() * 1000) for t in ("2024-01-01", "2024-02-01")]
        region_data = [
            ["longitude", "latitude", "time", "value", "cloud"],
            [36.9, -0.9, times[0], 0.42, 1],
            [36.9, -0.9, times[1], 0.55, None],
        ]

        df = fetch._region_data_to_dataframe(region_data)

        assert list(df.columns) == ["time", "values", "cloud"]
        assert df["values"].tolist() == [0.42, 0.55]
        assert df["cloud"].tolist() == [1, 0]
        assert df["cloud"].dtype.kind == "i"
        assert df["time"].iloc[0] == pd.Timestamp("2024-01-01")

    def test_keeps_values_outside_the_old_zero_to_one_clip(self):
        """Water reads negative in NDVI and GCVI runs well above 1; clipping
        these to [0, 1] silently invented data."""
        times = [int(pd.Timestamp(t).timestamp() * 1000) for t in ("2024-01-01", "2024-02-01")]
        region_data = [
            ["longitude", "latitude", "time", "value", "cloud"],
            [0, 0, times[0], -0.31, 0],
            [0, 0, times[1], 7.4, 0],
        ]

        assert fetch._region_data_to_dataframe(region_data)["values"].tolist() == [-0.31, 7.4]

    def test_drops_masked_observations_and_sorts_by_time(self):
        times = [int(pd.Timestamp(t).timestamp() * 1000) for t in ("2024-03-01", "2024-01-01")]
        region_data = [
            ["longitude", "latitude", "time", "value", "cloud"],
            [0, 0, times[0], 0.5, 0],
            [0, 0, times[1], 0.2, 0],
            [0, 0, times[0], None, 0],  # e.g. a Landsat 7 scan-line gap
        ]

        df = fetch._region_data_to_dataframe(region_data)

        assert df["values"].tolist() == [0.2, 0.5]

    def test_no_observations_still_yields_the_expected_columns(self):
        region_data = [["longitude", "latitude", "time", "value", "cloud"]]
        assert list(fetch._region_data_to_dataframe(region_data).columns) == [
            "time",
            "values",
            "cloud",
        ]


def _source_returning(collection, scale_m: int = 250) -> TimeseriesSource:
    """A source whose collection is already built - sources are the seam where
    Earth Engine lives, so swapping one out is all a fetch test needs."""
    return TimeseriesSource(
        key="TEST",
        label="Test",
        roles=frozenset({"nir", "red"}),
        scale_m=scale_m,
        coverage="",
        description="",
        build=lambda start, end, point: collection,
    )


def _fake_collection() -> MagicMock:
    collection = MagicMock()
    collection.map.return_value = collection
    collection.select.return_value = collection
    return collection


@pytest.fixture(autouse=True)
def _stub_point(monkeypatch):
    monkeypatch.setattr(fetch.ee.Geometry, "Point", MagicMock(return_value="point"))


class TestFetchIndexSeries:
    def test_samples_at_the_source_resolution(self):
        collection = _fake_collection()
        collection.getRegion.return_value.getInfo.return_value = [["time", "value", "cloud"]]

        fetch.fetch_index_series(
            _source_returning(collection, scale_m=30),
            INDICES_BY_KEY["NDVI"],
            latitude=1.0,
            longitude=2.0,
            start_date="2024-01-01",
            end_date="2024-02-01",
        )

        collection.select.assert_called_once_with(["value", "cloud"])
        collection.getRegion.assert_called_once_with("point", 30)

    def test_rejects_an_index_the_source_cannot_compute(self):
        with pytest.raises(ValueError, match="NDRE"):
            fetch.fetch_index_series(
                _source_returning(_fake_collection()),
                INDICES_BY_KEY["NDRE"],
                latitude=1.0,
                longitude=2.0,
                start_date="2024-01-01",
                end_date="2024-02-01",
            )

    @pytest.mark.parametrize(
        ("message", "expected"),
        [
            ("quota exceeded: 429 Too Many Requests", fetch.RateLimited),
            ("computation timed out", fetch.UpstreamFailed),
        ],
    )
    def test_maps_earth_engine_failures_to_domain_errors(self, message, expected):
        collection = _fake_collection()
        collection.getRegion.return_value.getInfo.side_effect = ee.EEException(message)

        with pytest.raises(expected):
            fetch.fetch_index_series(
                _source_returning(collection),
                INDICES_BY_KEY["NDVI"],
                latitude=1.0,
                longitude=2.0,
                start_date="2024-01-01",
                end_date="2024-02-01",
            )

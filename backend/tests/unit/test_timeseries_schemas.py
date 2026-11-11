import pytest
from pydantic import ValidationError

from src.timeseries.indices import INDICES_BY_KEY
from src.timeseries.schemas import (
    TimeseriesCreate,
    TimeseriesOut,
    ZonalTimeseriesRequest,
    parse_ym,
    timeseries_options,
    ym_range_to_dates,
)
from src.timeseries.windows import DEFAULT_TIMESERIES_WINDOW_NAME


def _make(window_name):
    return TimeseriesCreate(
        name="ts",
        window_name=window_name,
        start_ym="202401",
        end_ym="202412",
        data_source="MODIS",
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
    ts = TimeseriesCreate(
        name="ts",
        start_ym="202401",
        end_ym="202412",
        data_source="MODIS",
        ts_type="NDVI",
    )
    assert ts.window_name == DEFAULT_TIMESERIES_WINDOW_NAME


def _create(**overrides):
    return TimeseriesCreate(
        **{
            "name": "ts",
            "start_ym": "202401",
            "end_ym": "202412",
            "data_source": "SENTINEL2",
            "ts_type": "NDVI",
            **overrides,
        }
    )


class TestSourceValidation:
    def test_rejects_an_unknown_source(self):
        with pytest.raises(ValidationError, match="Unsupported data source"):
            _create(data_source="SENTINEL3")

    def test_stores_the_canonical_source_key(self):
        assert _create(data_source="LANDSAT").data_source == "LANDSAT"


class TestOutputCarriesTheIndexDescription:
    def test_chart_metadata_travels_with_the_series(self):
        out = TimeseriesOut(
            id=1,
            campaign_id=2,
            name="ts",
            window_id=1,
            window_name="Time series",
            start_ym="202401",
            end_ym="202412",
            data_source="SENTINEL2",
            ts_type="GCVI",
            spectral_index=INDICES_BY_KEY["GCVI"],
        )
        assert out.index is not None
        assert (out.index.domain_min, out.index.domain_max) == (0.0, 10.0)
        assert out.index.formula == "NIR / Green - 1"


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


def test_ym_range_ends_the_day_after_the_end_month():
    """filterDate excludes its end, so the whole last month needs the next month's
    first day."""
    assert ym_range_to_dates("202401", "202403") == ("2024-01-01", "2024-04-01")
    assert ym_range_to_dates("202304", "202304") == ("2023-04-01", "2023-05-01")


def test_ym_range_crosses_into_the_next_year_after_december():
    assert ym_range_to_dates("202301", "202312") == ("2023-01-01", "2024-01-01")


def test_ym_range_keeps_leap_day_of_february():
    assert ym_range_to_dates("202402", "202402") == ("2024-02-01", "2024-03-01")
    assert ym_range_to_dates("202302", "202302") == ("2023-02-01", "2023-03-01")


def _square(x: float, y: float, size: float) -> list[list[float]]:
    return [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]


def _zone(geometry):
    return ZonalTimeseriesRequest.model_validate({"geometry": geometry})


@pytest.mark.parametrize(
    "geometry",
    [
        {"type": "Polygon", "coordinates": [_square(0, 0, 0.01)]},
        {
            "type": "Polygon",
            "coordinates": [_square(0, 0, 0.01), _square(0.002, 0.002, 0.002)],
        },
        {
            "type": "MultiPolygon",
            "coordinates": [[_square(0, 0, 0.01)], [_square(0.02, 0, 0.01)]],
        },
        {"type": "Polygon", "coordinates": [_square(179.99, 89.98, 0.01)]},
    ],
)
def test_zone_accepts_polygons_with_holes_and_parts(geometry):
    assert _zone(geometry).geometry_json() == geometry


@pytest.mark.parametrize(
    ("geometry", "message"),
    [
        ({"type": "Point", "coordinates": [0, 0]}, "tag"),
        ({"type": "Polygon", "coordinates": []}, "at least 1"),
        ({"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [0, 0]]]}, "at least 4"),
        ({"type": "Polygon", "coordinates": [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]]]}, "end"),
        ({"type": "Polygon", "coordinates": [_square(180, 0, 0.01)]}, "within"),
        ({"type": "Polygon", "coordinates": [_square(0, 90, 0.01)]}, "within"),
        (
            {"type": "Polygon", "coordinates": [[[0, 0, 5], [0.01, 0], [0.01, 0.01], [0, 0]]]},
            "at most 2",
        ),
        (
            {
                "type": "Polygon",
                "coordinates": [[[0, 0], [0.01, 0.01], [0.01, 0], [0, 0.01], [0, 0]]],
            },
            "Self-intersection",
        ),
        (
            {"type": "Polygon", "coordinates": [_square(0, 0, 0.01), _square(0.5, 0.5, 0.01)]},
            "not valid",
        ),
        (
            {
                "type": "MultiPolygon",
                "coordinates": [[_square(0, 0, 0.01)], [_square(0.005, 0, 0.01)]],
            },
            "not valid",
        ),
        ({"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [2, 0], [0, 0]]]}, "not valid"),
        ({"type": "Polygon", "coordinates": [_square(0, 0, 0.07)]}, "km2"),
        (
            {
                "type": "Polygon",
                "coordinates": [[[-179, 0], [179, 0], [179, 0.001], [-179, 0.001], [-179, 0]]],
            },
            "longitude",
        ),
        (
            {"type": "MultiPolygon", "coordinates": [[_square(i, 0, 0.001)] for i in range(11)]},
            "11",
        ),
    ],
)
def test_zone_rejects_unusable_geometry(geometry, message):
    with pytest.raises(ValidationError, match=message):
        _zone(geometry)


def test_zone_rejects_non_finite_coordinates():
    ring = _square(0, 0, 0.01)
    ring[1] = [float("nan"), 0]
    with pytest.raises(ValidationError, match="finite"):
        _zone({"type": "Polygon", "coordinates": [ring]})


def test_zone_bounds_vertex_count():
    import math

    ring = [
        [0.01 * math.cos(2 * math.pi * i / 1000), 0.01 * math.sin(2 * math.pi * i / 1000)]
        for i in range(1000)
    ]
    with pytest.raises(ValidationError, match="1001 vertices"):
        _zone({"type": "Polygon", "coordinates": [[*ring, ring[0]]]})


def test_zone_accepts_a_large_field_below_fifty_square_kilometres():
    geometry = {"type": "Polygon", "coordinates": [_square(0, 0, 0.06)]}
    assert _zone(geometry).geometry_json() == geometry


def test_zone_rejects_oppositely_wound_parts_whose_combined_area_exceeds_limit():
    geometry = {
        "type": "MultiPolygon",
        "coordinates": [[_square(0, 0, 0.05)], [list(reversed(_square(0.1, 0, 0.05)))]],
    }
    with pytest.raises(ValidationError, match="km2"):
        _zone(geometry)


@pytest.mark.parametrize("reverse_hole", [False, True])
def test_zone_subtracts_holes_regardless_of_winding(reverse_hole):
    shell = _square(0, 0, 0.07)
    hole = _square(0.01, 0.01, 0.05)
    geometry = {"type": "Polygon", "coordinates": [shell, hole[::-1] if reverse_hole else hole]}
    assert _zone(geometry).geometry_json() == geometry


def test_zone_measures_long_straight_edges_instead_of_shortcutting_over_the_pole():
    geometry = {
        "type": "Polygon",
        "coordinates": [[[-90, 70], [90, 70], [90, 70.001], [-90, 70.001], [-90, 70]]],
    }
    with pytest.raises(ValidationError, match="km2"):
        _zone(geometry)

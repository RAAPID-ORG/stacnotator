"""Polygon series as real Earth Engine expressions.

These build the expression with the genuine SDK against its bundled algorithm
signatures (ee.apitestcase), so an unknown argument name or a missing required
argument fails at construction, and the graph sent to Earth Engine can be read
back. Nothing here reaches Earth Engine itself: what the server computes for these
expressions is not exercised.
"""

import json
from typing import Any

import ee
import pytest
from ee import apitestcase

from src.timeseries import fetch
from src.timeseries.indices import INDICES_BY_KEY
from src.timeseries.sources import SOURCES, indices_for_source, source_for

POLYGON_WITH_HOLE = {
    "type": "Polygon",
    "coordinates": [
        [[36.9, -0.9], [36.91, -0.9], [36.91, -0.89], [36.9, -0.89], [36.9, -0.9]],
        [[36.903, -0.897], [36.906, -0.897], [36.906, -0.894], [36.903, -0.897]],
    ],
}
MULTIPOLYGON = {
    "type": "MultiPolygon",
    "coordinates": [
        [[[36.9, -0.9], [36.91, -0.9], [36.91, -0.89], [36.9, -0.9]]],
        [[[37.0, -1.0], [37.01, -1.0], [37.01, -0.99], [37.0, -1.0]]],
    ],
}


@pytest.fixture(autouse=True)
def earth_engine():
    case = apitestcase.ApiTestCase()
    case.setUp()
    yield
    case.tearDown()


def _invocations(node: Any) -> list[dict]:
    found: list[dict] = []
    if isinstance(node, dict):
        if "functionInvocationValue" in node:
            found.append(node["functionInvocationValue"])
        for value in node.values():
            found += _invocations(value)
    elif isinstance(node, list):
        for value in node:
            found += _invocations(value)
    return found


def _graph(expression: Any) -> list[dict]:
    return _invocations(ee.serializer.encode(expression, is_compound=False, for_cloud_api=True))


def _calls(graph: list[dict], name: str) -> list[dict]:
    # The expanded graph repeats a shared subexpression wherever it is used.
    unique = {
        json.dumps(call["arguments"], sort_keys=True): call["arguments"]
        for call in graph
        if call["functionName"] == name
    }
    return list(unique.values())


def _constant(arg: dict) -> Any:
    return arg["constantValue"]


SOURCE_INDEX_PAIRS = [
    (source.key, index.key) for source in SOURCES for index in indices_for_source(source)
]


@pytest.mark.parametrize(("source_key", "index_key"), SOURCE_INDEX_PAIRS)
def test_every_source_and_index_builds_a_valid_zonal_expression(source_key, index_key):
    source = source_for(source_key)
    graph = _graph(
        fetch.zone_series(
            source, INDICES_BY_KEY[index_key], POLYGON_WITH_HOLE, "2024-01-01", "2024-03-31"
        )
    )

    [reduction] = _calls(graph, "Image.reduceRegion")
    assert _constant(reduction["scale"]) == source.scale_m
    assert _constant(reduction["bestEffort"]) is False
    assert _constant(reduction["maxPixels"]) == fetch._ZONE_MAX_PIXELS
    assert _constant(reduction["tileScale"]) == fetch._ZONE_TILE_SCALE
    assert reduction["reducer"]["functionInvocationValue"]["functionName"] == "Reducer.mean"
    # The projection is read off the mapped image's own band, so each scene is
    # reduced in its own CRS.
    projection = reduction["crs"]["functionInvocationValue"]
    assert projection["functionName"] == "Image.projection"
    selected = projection["arguments"]["image"]["functionInvocationValue"]
    assert selected["functionName"] == "Image.select"
    assert "argumentReference" in selected["arguments"]["input"]

    assert _calls(graph, "Collection.filter")
    assert ["value"] in [_constant(call["properties"]) for call in _calls(graph, "Filter.notNull")]
    [columns] = _calls(graph, "Collection.reduceColumns")
    assert _constant(columns["selectors"]) == ["time", "value", "cloud"]


def test_index_is_computed_per_pixel_before_the_zone_mean():
    graph = _graph(
        fetch.zone_series(
            source_for("SENTINEL2"),
            INDICES_BY_KEY["NDVI"],
            POLYGON_WITH_HOLE,
            "2024-01-01",
            "2024-03-31",
        )
    )

    [reduction] = _calls(graph, "Image.reduceRegion")
    reduced = reduction["image"]["functionInvocationValue"]
    assert reduced["functionName"] == "Image.addBands"
    value = reduced["arguments"]["dstImg"]["functionInvocationValue"]
    assert value["functionName"] == "Image.rename"
    assert _constant(value["arguments"]["names"]) == ["value"]
    assert value["arguments"]["input"]["functionInvocationValue"]["functionName"] == (
        "Image.divide"
    )


def test_clear_band_masks_cloudy_pixels_and_falls_back_only_without_any():
    graph = _graph(
        fetch.zone_series(
            source_for("LANDSAT"), INDICES_BY_KEY["NDVI"], MULTIPOLYGON, "2024-01-01", "2024-03-31"
        )
    )

    [reduction] = _calls(graph, "Image.reduceRegion")
    clear = reduction["image"]["functionInvocationValue"]["arguments"]["srcImg"][
        "functionInvocationValue"
    ]
    assert _constant(clear["arguments"]["names"]) == ["clear"]
    masked = clear["arguments"]["input"]["functionInvocationValue"]
    assert masked["functionName"] == "Image.updateMask"
    mask = masked["arguments"]["mask"]["functionInvocationValue"]
    assert mask["functionName"] == "Image.eq"
    cloud_band = mask["arguments"]["image1"]["functionInvocationValue"]["arguments"]
    assert _constant(cloud_band["bandSelectors"]) == ["cloud"]

    [no_clear] = _calls(graph, "IsEqual")
    # A null right-hand side is the signature's default, so it is left out.
    assert _constant(no_clear.get("right", {"constantValue": None})) is None
    assert _constant(no_clear["left"]["functionInvocationValue"]["arguments"]["key"]) == "clear"

    branches = _calls(graph, "If")
    picks = {
        (
            _constant(b["trueCase"])
            if "constantValue" in b["trueCase"]
            else _constant(b["trueCase"]["functionInvocationValue"]["arguments"]["key"]),
            _constant(b["falseCase"])
            if "constantValue" in b["falseCase"]
            else _constant(b["falseCase"]["functionInvocationValue"]["arguments"]["key"]),
        )
        for b in branches
    }
    assert picks == {("value", "clear"), (1, 0)}


def test_observation_carries_the_acquisition_time():
    graph = _graph(
        fetch.zone_series(
            source_for("MODIS"),
            INDICES_BY_KEY["NDVI"],
            POLYGON_WITH_HOLE,
            "2024-01-01",
            "2024-03-31",
        )
    )
    [feature] = [call for call in _calls(graph, "Feature") if "metadata" in call]
    time = feature["metadata"]["dictionaryValue"]["values"]["time"]["functionInvocationValue"]
    assert time["functionName"] == "Element.get"
    assert _constant(time["arguments"]["property"]) == "system:time_start"


@pytest.mark.parametrize(
    ("geometry", "constructor", "parts"),
    [(POLYGON_WITH_HOLE, "GeometryConstructors.Polygon", 2), (MULTIPOLYGON, None, 2)],
)
def test_geometry_keeps_holes_and_parts_as_planar_shapes(geometry, constructor, parts):
    graph = _graph(
        fetch.zone_series(
            source_for("MODIS"), INDICES_BY_KEY["NDVI"], geometry, "2024-01-01", "2024-03-31"
        )
    )
    name = constructor or "GeometryConstructors.MultiPolygon"
    built = _calls(graph, name)
    assert built
    assert all(_constant(args["geodesic"]) is False for args in built)
    assert len(_constant(built[0]["coordinates"])) == parts
    # The same region bounds the scene search and the reduction.
    assert _calls(graph, "Collection.filter")


def test_rows_come_back_as_the_point_series_frame(monkeypatch):
    times = [1706745600000, 1704067200000]
    sent: list[Any] = []

    def compute_value(expression):
        sent.append(expression)
        return [[times[0], 0.61, 0], [times[1], 0.2, 1]]

    monkeypatch.setattr(ee.data, "computeValue", compute_value)

    df = fetch.fetch_zonal_index_series(
        source_for("SENTINEL2"), INDICES_BY_KEY["NDVI"], MULTIPOLYGON, "2024-01-01", "2024-02-29"
    )

    assert len(sent) == 1
    assert list(df.columns) == ["time", "values", "cloud"]
    assert df["values"].tolist() == [0.2, 0.61]
    assert df["cloud"].tolist() == [1, 0]
    assert df["cloud"].dtype.kind == "i"
    assert str(df["time"].iloc[0].date()) == "2024-01-01"


def test_no_observations_yield_the_expected_columns(monkeypatch):
    monkeypatch.setattr(ee.data, "computeValue", lambda expression: [])
    df = fetch.fetch_zonal_index_series(
        source_for("MODIS"), INDICES_BY_KEY["NDVI"], POLYGON_WITH_HOLE, "2024-01-01", "2024-02-29"
    )
    assert df.empty
    assert list(df.columns) == ["time", "values", "cloud"]


@pytest.mark.parametrize(
    ("message", "expected"),
    [("Quota exceeded", fetch.RateLimited), ("Too many pixels", fetch.UpstreamFailed)],
)
def test_earth_engine_failures_map_to_domain_errors(monkeypatch, message, expected):
    def fail(expression):
        raise ee.EEException(message)

    monkeypatch.setattr(ee.data, "computeValue", fail)
    with pytest.raises(expected):
        fetch.fetch_zonal_index_series(
            source_for("MODIS"),
            INDICES_BY_KEY["NDVI"],
            POLYGON_WITH_HOLE,
            "2024-01-01",
            "2024-02-29",
        )


def test_rejects_an_index_the_source_cannot_compute():
    with pytest.raises(ValueError, match="NDRE"):
        fetch.zone_series(
            source_for("MODIS"),
            INDICES_BY_KEY["NDRE"],
            POLYGON_WITH_HOLE,
            "2024-01-01",
            "2024-02-29",
        )

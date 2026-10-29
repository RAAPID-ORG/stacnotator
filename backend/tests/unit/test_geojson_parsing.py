"""parse_geojson_features: the parser behind every GeoJSON upload."""

import json

import pytest
from fastapi import HTTPException

from src.tasks.ingest import GeoJSONParseError, parse_geojson_features, validated_task_numbers

BARE_POINT = json.dumps({"type": "Point", "coordinates": [20.0, 10.0]}).encode("utf-8")
FEATURE_COLLECTION = json.dumps(
    {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [20.0, 10.0]},
                "properties": {"plot": "a"},
            }
        ],
    }
).encode("utf-8")


def test_a_bare_geometry_is_one_feature_without_properties():
    features = parse_geojson_features(BARE_POINT, max_size=1_000_000)
    assert len(features) == 1
    geom, properties = features[0]
    assert geom.geom_type == "Point"
    assert properties == {}


def test_feature_collection_keeps_properties():
    features = parse_geojson_features(FEATURE_COLLECTION, max_size=1_000_000)
    assert len(features) == 1
    assert features[0][1] == {"plot": "a"}


def test_lines_are_rejected():
    line = json.dumps({"type": "LineString", "coordinates": [[0, 0], [1, 1]]}).encode()
    with pytest.raises(GeoJSONParseError) as exc_info:
        parse_geojson_features(line, max_size=1_000_000)
    assert exc_info.value.status_code == 400


def test_oversized_upload_is_413():
    with pytest.raises(GeoJSONParseError) as exc_info:
        parse_geojson_features(FEATURE_COLLECTION, max_size=10)
    assert exc_info.value.status_code == 413


def _collection(*features: dict) -> bytes:
    return json.dumps({"type": "FeatureCollection", "features": list(features)}).encode("utf-8")


def _point(**extra) -> dict:
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [1, 2]}, **extra}


def test_a_feature_id_is_read_as_the_id_property():
    contents = _collection(_point(id=7, properties={"a": 1}), _point(properties={"id": 8}))
    assert [props["id"] for _, props in parse_geojson_features(contents, 10_000)] == [7, 8]


def test_task_numbers_follow_the_csv_rules():
    assert validated_task_numbers([" 3", "4"]) == [3, 4]
    for bad in (["1", "1"], ["a"], ["1", " "]):
        with pytest.raises(HTTPException) as exc:
            validated_task_numbers(bad)
        assert exc.value.status_code == 400

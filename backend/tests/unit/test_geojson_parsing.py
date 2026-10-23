"""parse_geojson_features: the parser behind every GeoJSON upload."""

import json

import pytest

from src.annotation.ingest import GeoJSONParseError, parse_geojson_features

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

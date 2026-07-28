"""Unit tests for parse_geojson_features - the pure parser shared by both
GeoJSON importers in annotation/ingest.py.

Each importer keeps its own original top-level acceptance set via
`allow_bare_geometry`: the task importer (create_annotation_tasks_from_geojson)
accepts a bare geometry object, the standalone-annotation importer
(create_annotations_from_geojson) does not.
"""

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


def test_bare_geometry_accepted_by_default():
    """Default matches the task importer's original behavior: a bare
    geometry object is wrapped into one feature with empty properties."""
    features = parse_geojson_features(BARE_POINT, max_size=1_000_000)
    assert len(features) == 1
    geom, properties = features[0]
    assert geom.geom_type == "Point"
    assert properties == {}


def test_bare_geometry_rejected_when_disallowed():
    """Matches the standalone-annotation importer's original behavior: a
    bare geometry object (no Feature/FeatureCollection wrapper) is rejected,
    not silently upgraded into a feature."""
    with pytest.raises(GeoJSONParseError) as exc_info:
        parse_geojson_features(BARE_POINT, max_size=1_000_000, allow_bare_geometry=False)
    assert str(exc_info.value) == "Unsupported GeoJSON type"
    assert exc_info.value.status_code == 400


def test_feature_collection_accepted_regardless_of_bare_geometry_flag():
    for allow_bare_geometry in (True, False):
        features = parse_geojson_features(
            FEATURE_COLLECTION, max_size=1_000_000, allow_bare_geometry=allow_bare_geometry
        )
        assert len(features) == 1
        assert features[0][1] == {"plot": "a"}

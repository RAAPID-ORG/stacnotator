"""Tests for sampling design regions (sampling_design/service.py)."""

import asyncio
import io
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile
from shapely.geometry import MultiPolygon, Polygon, box, mapping

from src.sampling_design.service import clip_to_campaign, read_region_file


def _campaign(west, south, east, north):
    return SimpleNamespace(bbox=(west, south, east, north))


class TestClipToCampaign:
    def test_keeps_only_polygonal_parts_of_the_clip(self):
        # A U shape clipped along its inner edge leaves two polygons plus the
        # touching line; the line must not survive, or random sampling
        # silently returns zero points for a GeometryCollection.
        region = Polygon([(0, 0), (1, 0), (1, 1), (2, 1), (2, 0), (3, 0), (3, 2), (0, 2)])
        clipped = clip_to_campaign(region, _campaign(0, 0, 3, 1))
        assert isinstance(clipped, MultiPolygon)
        assert clipped.area == pytest.approx(2)

    def test_touching_edge_only_is_no_overlap(self):
        with pytest.raises(HTTPException) as exc_info:
            clip_to_campaign(box(0, 0, 1, 1), _campaign(1, 0, 2, 1))
        assert exc_info.value.status_code == 400


def _upload(name: str, payload: dict) -> UploadFile:
    return UploadFile(io.BytesIO(json.dumps(payload).encode()), filename=name)


class TestReadRegionFile:
    def test_merges_the_features_of_a_geojson_into_one_region(self):
        features = [
            {"type": "Feature", "geometry": mapping(b), "properties": {}}
            for b in (box(0, 0, 1, 1), box(2, 2, 3, 3))
        ]
        region = asyncio.run(
            read_region_file(
                _upload("r.geojson", {"type": "FeatureCollection", "features": features})
            )
        )
        assert isinstance(region, MultiPolygon)
        assert region.area == pytest.approx(2)

    def test_a_region_of_points_has_no_area_to_sample(self):
        point = {"type": "Point", "coordinates": [1, 1]}
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(read_region_file(_upload("r.geojson", point)))
        assert exc_info.value.status_code == 400

    def test_other_file_types_are_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(read_region_file(_upload("r.kml", {})))
        assert exc_info.value.status_code == 400

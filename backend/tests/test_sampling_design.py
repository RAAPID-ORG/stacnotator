"""Tests for sampling design service (sampling_design/service.py)."""

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from shapely.geometry import MultiPolygon, Point, Polygon, box

from src.sampling_design.service import (
    create_bbox_polygon,
    generate_random_points,
    get_region_geometry,
)


class TestCreateBboxPolygon:
    def test_basic_bbox(self):
        campaign = MagicMock()
        campaign.settings.bbox_west = -10
        campaign.settings.bbox_south = -20
        campaign.settings.bbox_east = 10
        campaign.settings.bbox_north = 20

        polygon = create_bbox_polygon(campaign)
        assert isinstance(polygon, Polygon)
        bounds = polygon.bounds
        assert bounds == (-10, -20, 10, 20)

    def test_missing_settings_raises_400(self):
        campaign = MagicMock()
        campaign.settings = None

        with pytest.raises(HTTPException) as exc_info:
            create_bbox_polygon(campaign)
        assert exc_info.value.status_code == 400

    def test_incomplete_bbox_raises_400(self):
        campaign = MagicMock()
        campaign.settings.bbox_west = -10
        campaign.settings.bbox_south = None
        campaign.settings.bbox_east = 10
        campaign.settings.bbox_north = 20

        with pytest.raises(HTTPException) as exc_info:
            create_bbox_polygon(campaign)
        assert exc_info.value.status_code == 400

    def test_zero_area_bbox(self):
        campaign = MagicMock()
        campaign.settings.bbox_west = 0
        campaign.settings.bbox_south = 0
        campaign.settings.bbox_east = 0
        campaign.settings.bbox_north = 0

        polygon = create_bbox_polygon(campaign)
        assert polygon.area == 0


class TestGetRegionGeometry:
    def _make_gdf(self, geometry):
        import geopandas as gpd

        return gpd.GeoDataFrame(geometry=[geometry], crs="EPSG:4326")

    def test_returns_polygon(self):
        polygon = box(-10, -20, 10, 20)
        gdf = self._make_gdf(polygon)

        result = get_region_geometry(gdf)
        assert isinstance(result, Polygon)
        assert result.bounds == (-10, -20, 10, 20)

    def test_empty_gdf_raises_400(self):
        import geopandas as gpd

        gdf = gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
        with pytest.raises(HTTPException) as exc_info:
            get_region_geometry(gdf)
        assert exc_info.value.status_code == 400

    def test_returns_multipolygon(self):
        multi = MultiPolygon([box(0, 0, 1, 1), box(2, 2, 3, 3)])
        gdf = self._make_gdf(multi)

        result = get_region_geometry(gdf)
        assert isinstance(result, MultiPolygon)


class TestGenerateRandomPoints:
    def test_correct_count(self):
        polygon = box(-10, -20, 10, 20)
        points = generate_random_points(polygon, 50, seed=42)
        assert len(points) == 50

    def test_all_within_boundary(self):
        polygon = box(-10, -20, 10, 20)
        points = generate_random_points(polygon, 100, seed=42)
        for pt in points:
            assert isinstance(pt, Point)
            assert polygon.contains(pt) or polygon.touches(pt)

    def test_deterministic_with_seed(self):
        polygon = box(0, 0, 1, 1)
        points_a = generate_random_points(polygon, 20, seed=123)
        points_b = generate_random_points(polygon, 20, seed=123)
        for a, b in zip(points_a, points_b, strict=True):
            assert a.x == pytest.approx(b.x)
            assert a.y == pytest.approx(b.y)

    def test_different_seeds_give_different_points(self):
        polygon = box(0, 0, 1, 1)
        points_a = generate_random_points(polygon, 20, seed=1)
        points_b = generate_random_points(polygon, 20, seed=2)
        coords_a = [(p.x, p.y) for p in points_a]
        coords_b = [(p.x, p.y) for p in points_b]
        assert coords_a != coords_b

    def test_multipolygon_boundary(self):
        multi = MultiPolygon([box(0, 0, 1, 1), box(10, 10, 11, 11)])
        points = generate_random_points(multi, 30, seed=42)
        assert len(points) == 30
        for pt in points:
            assert multi.contains(pt) or multi.touches(pt)

    def test_single_point(self):
        polygon = box(0, 0, 1, 1)
        points = generate_random_points(polygon, 1, seed=42)
        assert len(points) == 1

"""Tests for sampling design service (sampling_design/service.py)."""

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from shapely.geometry import MultiPolygon, Polygon, box

from src.sampling_design.service import (
    create_bbox_polygon,
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

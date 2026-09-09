"""DB-free tests for the areas-of-interest reader (src/area_estimation/areas.py).

Boundary files are written into pytest's tmp_path as plain GeoJSON, or as a
zipped shapefile built with geopandas, matching what a person would upload.
"""

import json
import zipfile

import geopandas as gpd
import pytest
import shapely
from rasterio.crs import CRS
from shapely.geometry import MultiPolygon, Point, Polygon

from src.area_estimation.areas import read_areas, zones_on_grid
from src.area_estimation.raster import MapError
from src.area_estimation.schemas import MAX_AREAS


def write_geojson(tmp_path, name, features):
    path = tmp_path / name
    collection = {"type": "FeatureCollection", "features": features}
    path.write_text(json.dumps(collection))
    return path


def feature(geometry, properties=None):
    return {
        "type": "Feature",
        "properties": properties or {},
        "geometry": json.loads(shapely.to_geojson(geometry)),
    }


def square(x, y, size=1.0):
    return Polygon([(x, y), (x + size, y), (x + size, y + size), (x, y + size)])


def zip_shapefile(tmp_path, name, gdf, drop_prj=False):
    shp_dir = tmp_path / f"{name}_src"
    shp_dir.mkdir()
    gdf.to_file(shp_dir / "areas.shp", driver="ESRI Shapefile")
    zip_path = tmp_path / name
    with zipfile.ZipFile(zip_path, "w") as archive:
        for member in shp_dir.iterdir():
            if drop_prj and member.suffix == ".prj":
                continue
            archive.write(member, arcname=member.name)
    return zip_path


class TestReadAreasGeoJSON:
    def test_feature_count_is_the_number_of_polygon_parts(self, tmp_path):
        multi = MultiPolygon([square(0, 0), square(10, 10)])
        path = write_geojson(tmp_path, "areas.geojson", [feature(multi, {"name": "Two Parts"})])
        areas, collection = read_areas(path, "areas.geojson")
        assert areas[0].id == "area-1"
        assert areas[0].feature_count == 2
        assert len(collection["features"]) == 1

    def test_missing_name_falls_back_to_area_n(self, tmp_path):
        path = write_geojson(tmp_path, "areas.geojson", [feature(square(0, 0))])
        areas, _ = read_areas(path, "areas.geojson")
        assert areas[0].name == "Area 1"

    def test_no_crs_member_is_treated_as_wgs84(self, tmp_path):
        path = write_geojson(tmp_path, "areas.geojson", [feature(square(33, 1))])
        areas, collection = read_areas(path, "areas.geojson")
        assert len(areas) == 1
        bounds = shapely.geometry.shape(collection["features"][0]["geometry"]).bounds
        assert bounds == pytest.approx((33, 1, 34, 2))

    def test_name_property_is_used_when_present(self, tmp_path):
        path = write_geojson(
            tmp_path, "areas.geojson", [feature(square(0, 0), {"name": "Foothills"})]
        )
        areas, _ = read_areas(path, "areas.geojson")
        assert areas[0].name == "Foothills"

    def test_point_feature_is_not_a_polygon(self, tmp_path):
        path = write_geojson(tmp_path, "areas.geojson", [feature(Point(0, 0))])
        with pytest.raises(MapError, match="not a polygon"):
            read_areas(path, "areas.geojson")

    def test_empty_collection_is_rejected(self, tmp_path):
        path = write_geojson(tmp_path, "areas.geojson", [])
        with pytest.raises(MapError, match="no features"):
            read_areas(path, "areas.geojson")

    def test_overlapping_polygons_are_rejected(self, tmp_path):
        a = square(0, 0, size=2)
        b = square(1, 1, size=2)
        path = write_geojson(
            tmp_path,
            "areas.geojson",
            [feature(a, {"name": "A"}), feature(b, {"name": "B"})],
        )
        with pytest.raises(MapError, match="overlap"):
            read_areas(path, "areas.geojson")

    def test_polygons_touching_only_along_an_edge_are_accepted(self, tmp_path):
        a = square(0, 0)
        b = square(1, 0)
        path = write_geojson(
            tmp_path,
            "areas.geojson",
            [feature(a, {"name": "A"}), feature(b, {"name": "B"})],
        )
        areas, _ = read_areas(path, "areas.geojson")
        assert len(areas) == 2

    def test_invalid_bowtie_polygon_is_made_valid_and_accepted(self, tmp_path):
        bowtie = Polygon([(0, 0), (1, 1), (1, 0), (0, 1), (0, 0)])
        assert not bowtie.is_valid
        path = write_geojson(tmp_path, "areas.geojson", [feature(bowtie)])
        areas, collection = read_areas(path, "areas.geojson")
        assert len(areas) == 1
        stored = shapely.geometry.shape(collection["features"][0]["geometry"])
        assert stored.is_valid
        assert not stored.is_empty

    def test_more_than_max_areas_is_rejected(self, tmp_path):
        features = [feature(square(i * 2, 0), {"name": f"n{i}"}) for i in range(MAX_AREAS + 1)]
        path = write_geojson(tmp_path, "areas.geojson", features)
        with pytest.raises(MapError, match=str(MAX_AREAS)):
            read_areas(path, "areas.geojson")


class TestReadAreasShapefile:
    def test_zip_is_reprojected_to_wgs84(self, tmp_path):
        gdf = gpd.GeoDataFrame(
            {"name": ["Zone"]}, geometry=[square(500000, 1000000, size=1000)], crs="EPSG:32636"
        )
        zip_path = zip_shapefile(tmp_path, "areas.zip", gdf)
        areas, collection = read_areas(zip_path, "areas.zip")
        assert len(areas) == 1
        bounds = shapely.geometry.shape(collection["features"][0]["geometry"]).bounds
        assert all(-180 <= v <= 180 for v in (bounds[0], bounds[2]))
        assert all(-90 <= v <= 90 for v in (bounds[1], bounds[3]))

    def test_zip_without_prj_is_rejected(self, tmp_path):
        gdf = gpd.GeoDataFrame(
            {"name": ["Zone"]}, geometry=[square(500000, 1000000, size=1000)], crs="EPSG:32636"
        )
        zip_path = zip_shapefile(tmp_path, "areas.zip", gdf, drop_prj=True)
        with pytest.raises(MapError, match="coordinate reference system"):
            read_areas(zip_path, "areas.zip")


class TestZonesOnGrid:
    def test_projects_to_the_given_crs_and_keeps_ids(self, tmp_path):
        path = write_geojson(
            tmp_path,
            "areas.geojson",
            [feature(square(33, 1), {"name": "A"}), feature(square(35, 1), {"name": "B"})],
        )
        _, collection = read_areas(path, "areas.geojson")
        grid_wkt = CRS.from_string("EPSG:6933").to_wkt()

        zones = zones_on_grid(collection, grid_wkt)

        assert [zone.id for zone in zones] == ["area-1", "area-2"]
        for zone in zones:
            minx, miny, maxx, maxy = zone.geometry.bounds
            assert abs(maxx - minx) > 1000
            assert abs(maxy - miny) > 1000

    def test_empty_collection_returns_no_zones(self):
        assert zones_on_grid({"type": "FeatureCollection", "features": []}, "EPSG:6933") == []

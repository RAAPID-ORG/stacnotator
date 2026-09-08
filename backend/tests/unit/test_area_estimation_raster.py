"""DB-free tests for the area-estimation raster core (src/area_estimation/raster.py).

Synthetic GeoTIFFs are written into pytest's tmp_path with rasterio and fed
straight through inspect/plan/reproject/stratify, the same way
src/area_estimation/router.py and its worker do.
"""

import numpy as np
import pytest
import rasterio
import shapely
from affine import Affine
from rasterio.transform import from_origin

from src.area_estimation import raster
from src.area_estimation.raster import MapError, Source, Zone
from src.area_estimation.schemas import NODATA, GridSpec, ReportingClass

LAEA = "+proj=laea +lat_0=1 +lon_0=34 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"


def write_raster(tmp_path, name, data, crs, transform, nodata=None, dtype=None):
    path = str(tmp_path / name)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=data.shape[1],
        height=data.shape[0],
        count=1,
        dtype=dtype or data.dtype,
        crs=crs,
        transform=transform,
        nodata=nodata,
    ) as ds:
        ds.write(data, 1)
    return path


def laea_source(tmp_path, name="ea.tif", shape=(40, 50), resolution=10, nodata=None):
    rng = np.random.default_rng(0)
    data = rng.integers(0, 4, shape).astype("uint8")
    transform = from_origin(-5000, 5000, resolution, resolution)
    path = write_raster(tmp_path, name, data, LAEA, transform, nodata=nodata)
    return Source(name=name, location=path), data


class TestInspectSource:
    def test_reads_bands_dtype_and_declared_nodata(self, tmp_path):
        src, _ = laea_source(tmp_path, nodata=0)
        info = raster.inspect_source(src)
        assert len(info.bands) == 1
        assert info.bands[0].dtype == "uint8"
        assert info.bands[0].nodata == 0

    def test_nan_nodata_is_reported_as_none(self, tmp_path):
        data = np.zeros((10, 10), dtype="float32")
        path = write_raster(
            tmp_path, "nan.tif", data, LAEA, from_origin(0, 100, 10, 10), nodata=float("nan")
        )
        info = raster.inspect_source(Source(name="nan.tif", location=path))
        assert info.bands[0].nodata is None

    def test_geographic_source_is_not_equal_area_and_has_no_pixel_area(self, tmp_path):
        data = np.zeros((10, 10), dtype="uint8")
        path = write_raster(
            tmp_path, "geo.tif", data, "EPSG:4326", from_origin(33.0, 1.0, 0.01, 0.01)
        )
        info = raster.inspect_source(Source(name="geo.tif", location=path))
        assert info.is_geographic is True
        assert info.is_equal_area is False
        assert info.pixel_area_m2 is None

    def test_laea_source_is_equal_area_with_exact_pixel_area(self, tmp_path):
        src, _ = laea_source(tmp_path, resolution=10)
        info = raster.inspect_source(src)
        assert info.is_geographic is False
        assert info.is_equal_area is True
        assert info.pixel_area_m2 == pytest.approx(100.0)

    def test_bbox_is_in_wgs84_degrees(self, tmp_path):
        src, _ = laea_source(tmp_path)
        info = raster.inspect_source(src)
        assert -180 <= info.bbox.west < info.bbox.east <= 180
        assert -90 <= info.bbox.south < info.bbox.north <= 90


class TestInspectMap:
    def test_proposed_crs_is_the_map_own_crs_when_already_equal_area(self, tmp_path):
        src, _ = laea_source(tmp_path)
        info = raster.inspect_map([src])
        assert info.is_equal_area is True
        assert info.proposed_crs == info.sources[0].crs

    def test_proposed_crs_is_a_laea_string_for_a_geographic_map(self, tmp_path):
        data = np.zeros((10, 10), dtype="uint8")
        path = write_raster(
            tmp_path, "geo.tif", data, "EPSG:4326", from_origin(33.0, 1.0, 0.01, 0.01)
        )
        info = raster.inspect_map([Source(name="geo.tif", location=path)])
        assert info.is_equal_area is False
        assert info.proposed_crs.startswith("+proj=laea")

    def test_tiles_with_different_band_dtypes_are_rejected(self, tmp_path):
        p8 = write_raster(
            tmp_path, "u8.tif", np.zeros((10, 10), dtype="uint8"), LAEA, from_origin(0, 100, 10, 10)
        )
        p16 = write_raster(
            tmp_path,
            "u16.tif",
            np.zeros((10, 10), dtype="uint16"),
            LAEA,
            from_origin(0, 100, 10, 10),
        )
        with pytest.raises(MapError, match="do not have the same bands"):
            raster.inspect_map(
                [Source(name="u8.tif", location=p8), Source(name="u16.tif", location=p16)]
            )


class TestEqualAreaCrs:
    @pytest.mark.parametrize("bad", ["EPSG:4326", "EPSG:3857", "EPSG:32636", "nonsense"])
    def test_rejects_non_equal_area_or_unrecognised_crs(self, bad):
        with pytest.raises(MapError):
            raster.equal_area_crs(bad)

    @pytest.mark.parametrize("good", ["EPSG:6933", "EPSG:3035", "ESRI:54009", "EPSG:5070", LAEA])
    def test_accepts_metric_equal_area_projections(self, good):
        raster.equal_area_crs(good)


class TestPlanGrid:
    def test_resolution_is_honoured(self, tmp_path):
        src, _ = laea_source(tmp_path)
        grid = raster.plan_grid([src], LAEA, 25.0, 10**9)
        assert grid.resolution_m == 25.0

    def test_derived_resolution_matches_the_source_pixel_size_on_an_identity_reprojection(
        self, tmp_path
    ):
        src, data = laea_source(tmp_path, resolution=10)
        grid = raster.plan_grid([src], LAEA, None, 10**9)
        assert grid.resolution_m == pytest.approx(10.0, rel=1e-6)
        assert (grid.width, grid.height) == (data.shape[1], data.shape[0])

    def test_grid_covers_the_union_of_two_tiles(self, tmp_path):
        a = write_raster(
            tmp_path,
            "a.tif",
            np.zeros((50, 50), dtype="uint8"),
            LAEA,
            Affine(100, 0, 0, 0, -100, 1000),
        )
        b = write_raster(
            tmp_path,
            "b.tif",
            np.zeros((50, 50), dtype="uint8"),
            LAEA,
            Affine(100, 0, 10000, 0, -100, 1000),
        )
        grid = raster.plan_grid(
            [Source(name="a", location=a), Source(name="b", location=b)], LAEA, 100.0, 10**9
        )
        assert (grid.width, grid.height) == (150, 50)
        assert grid.transform[0] == pytest.approx(0.0)
        assert grid.transform[3] == pytest.approx(1000.0)

    def test_max_pixels_exceeded_raises(self, tmp_path):
        src, _ = laea_source(tmp_path, shape=(400, 400), resolution=10)
        with pytest.raises(MapError, match="more than the"):
            raster.plan_grid([src], LAEA, 1.0, 1000)


class TestReprojectIdentity:
    """A source already on the target grid at the same resolution round-trips exactly."""

    def test_identity_roundtrip(self, tmp_path):
        src, data = laea_source(tmp_path, resolution=10, nodata=0)
        grid = raster.plan_grid([src], LAEA, 10.0, 10**9)
        out = str(tmp_path / "reproj.tif")
        progress = []
        census = raster.reproject([src], 1, grid, [], out, progress.append)

        expected = {
            int(v): int(c) for v, c in zip(*np.unique(data, return_counts=True), strict=True)
        }
        assert census.total == expected
        assert census.footprint_pixels == data.size
        assert census.masked_pixels == 0
        assert census.declared_nodata == [0]

        with rasterio.open(out) as ds:
            back = ds.read(1)
        assert np.array_equal(back, data)


class TestZones:
    def test_by_area_counts_match_the_corresponding_array_slices(self, tmp_path):
        src, data = laea_source(tmp_path, resolution=10, nodata=None, shape=(100, 900))
        grid = raster.plan_grid([src], LAEA, 10.0, 10**9)
        # Grid spans x: -5000..4000 (900 * 10); split it into a left and a right
        # rectangle at x = 0. y bounds are generous so both fully contain the grid.
        zones = [
            Zone("left", shapely.box(-5000, -5000, 0, 5000)),
            Zone("right", shapely.box(0, -5000, 4000, 5000)),
        ]
        out = str(tmp_path / "reproj.tif")
        census = raster.reproject([src], 1, grid, zones, out, lambda f: None)

        left_slice = data[:, :500]
        right_slice = data[:, 500:900]
        exp_left = {
            int(v): int(c) for v, c in zip(*np.unique(left_slice, return_counts=True), strict=True)
        }
        exp_right = {
            int(v): int(c) for v, c in zip(*np.unique(right_slice, return_counts=True), strict=True)
        }
        assert census.by_area["left"] == exp_left
        assert census.by_area["right"] == exp_right


class TestTileMerging:
    def test_non_overlapping_tiles_sum(self, tmp_path):
        a = write_raster(
            tmp_path,
            "a.tif",
            np.full((50, 50), 1, dtype="uint8"),
            LAEA,
            Affine(100, 0, 0, 0, -100, 1000),
        )
        b = write_raster(
            tmp_path,
            "b.tif",
            np.full((50, 50), 2, dtype="uint8"),
            LAEA,
            Affine(100, 0, 10000, 0, -100, 1000),
        )
        srcs = [Source(name="a", location=a), Source(name="b", location=b)]
        grid = raster.plan_grid(srcs, LAEA, 100.0, 10**9)
        out = str(tmp_path / "out.tif")
        census = raster.reproject(srcs, 1, grid, [], out, lambda f: None)
        assert census.total == {1: 2500, 2: 2500}

    def test_overlapping_tiles_that_agree_do_not_double_count(self, tmp_path):
        a = write_raster(
            tmp_path,
            "a.tif",
            np.full((50, 50), 1, dtype="uint8"),
            LAEA,
            Affine(100, 0, 0, 0, -100, 1000),
        )
        c = write_raster(
            tmp_path,
            "c.tif",
            np.full((50, 50), 1, dtype="uint8"),
            LAEA,
            Affine(100, 0, 0, 0, -100, 1000),
        )
        srcs = [Source(name="a", location=a), Source(name="c", location=c)]
        grid = raster.plan_grid(srcs, LAEA, 100.0, 10**9)
        out = str(tmp_path / "out.tif")
        census = raster.reproject(srcs, 1, grid, [], out, lambda f: None)
        assert census.total == {1: 2500}

    def test_overlapping_tiles_that_disagree_raise(self, tmp_path):
        a = write_raster(
            tmp_path,
            "a.tif",
            np.full((50, 50), 1, dtype="uint8"),
            LAEA,
            Affine(100, 0, 0, 0, -100, 1000),
        )
        c = write_raster(
            tmp_path,
            "c.tif",
            np.full((50, 50), 2, dtype="uint8"),
            LAEA,
            Affine(100, 0, 0, 0, -100, 1000),
        )
        srcs = [Source(name="a", location=a), Source(name="c", location=c)]
        grid = raster.plan_grid(srcs, LAEA, 100.0, 10**9)
        out = str(tmp_path / "out.tif")
        with pytest.raises(MapError, match="overlap"):
            raster.reproject(srcs, 1, grid, [], out, lambda f: None)


class TestGeographicWarp:
    def test_counts_stay_within_three_percent_after_warping_to_laea(self, tmp_path):
        rng = np.random.default_rng(1)
        data = rng.integers(1, 4, (400, 600)).astype("uint8")
        path = write_raster(
            tmp_path, "geo.tif", data, "EPSG:4326", from_origin(33.5, 1.5, 0.001, 0.001)
        )
        src = Source(name="geo", location=path)
        info = raster.inspect_map([src])
        grid = raster.plan_grid([src], info.proposed_crs, None, 10**9)
        out = str(tmp_path / "out.tif")
        census = raster.reproject([src], 1, grid, [], out, lambda f: None)
        for value in (1, 2, 3):
            source_count = int((data == value).sum())
            ratio = census.total[value] / source_count
            assert 0.97 < ratio < 1.03

    def test_outside_footprint_pixels_read_back_as_nodata(self, tmp_path):
        left = write_raster(
            tmp_path,
            "left.tif",
            np.full((100, 100), 1, dtype="uint8"),
            "EPSG:4326",
            from_origin(33.0, 1.0, 0.001, 0.001),
        )
        right = write_raster(
            tmp_path,
            "right.tif",
            np.full((100, 100), 2, dtype="uint8"),
            "EPSG:4326",
            from_origin(35.0, 1.0, 0.001, 0.001),
        )
        srcs = [Source(name="left", location=left), Source(name="right", location=right)]
        # Plan over both tiles so the grid is far bigger than the one tile we
        # actually reproject, leaving a whole region with no source coverage.
        grid = raster.plan_grid(srcs, LAEA, 200.0, 10**9)
        out = str(tmp_path / "out.tif")
        raster.reproject([Source(name="left", location=left)], 1, grid, [], out, lambda f: None)
        with rasterio.open(out) as ds:
            arr = ds.read(1)
        empty_region = arr[:, -20:]
        assert set(np.unique(empty_region).tolist()) == {NODATA}


class TestValueValidation:
    def test_float32_source_with_integral_values_works(self, tmp_path):
        rng = np.random.default_rng(2)
        data = rng.integers(1, 4, (400, 600)).astype("uint8").astype("float32")
        path = write_raster(
            tmp_path, "f.tif", data, "EPSG:4326", from_origin(33.5, 1.5, 0.001, 0.001)
        )
        grid = raster.plan_grid([Source(name="f", location=path)], LAEA, 100.0, 10**9)
        out = str(tmp_path / "out.tif")
        census = raster.reproject(
            [Source(name="f", location=path)], 1, grid, [], out, lambda f: None
        )
        assert census.masked_pixels == 0

    def test_nan_pixels_are_masked_not_counted(self, tmp_path):
        # Warp the same source with and without a NaN patch, onto the same grid:
        # any difference in the counts can only come from the patch being masked.
        rng = np.random.default_rng(2)
        clean = rng.integers(1, 4, (400, 600)).astype("uint8").astype("float32")
        with_nan = clean.copy()
        with_nan[:50, :50] = np.nan
        origin = from_origin(33.5, 1.5, 0.001, 0.001)
        clean_path = write_raster(tmp_path, "clean.tif", clean, "EPSG:4326", origin)
        nan_path = write_raster(
            tmp_path, "nan.tif", with_nan, "EPSG:4326", origin, nodata=float("nan")
        )
        grid = raster.plan_grid([Source(name="clean", location=clean_path)], LAEA, 100.0, 10**9)
        out = str(tmp_path / "out.tif")

        clean_census = raster.reproject(
            [Source(name="clean", location=clean_path)], 1, grid, [], out, lambda f: None
        )
        nan_census = raster.reproject(
            [Source(name="nan", location=nan_path)], 1, grid, [], out, lambda f: None
        )

        assert clean_census.masked_pixels == 0
        assert nan_census.masked_pixels > 0
        for value in (1, 2, 3):
            assert nan_census.total.get(value, 0) <= clean_census.total.get(value, 0)
        assert sum(nan_census.total.values()) < sum(clean_census.total.values())

    def test_non_integer_float_value_raises(self, tmp_path):
        data = np.full((20, 20), 1.5, dtype="float32")
        path = write_raster(
            tmp_path, "f.tif", data, "EPSG:4326", from_origin(33.5, 1.5, 0.001, 0.001)
        )
        grid = raster.plan_grid([Source(name="f", location=path)], LAEA, 100.0, 10**9)
        out = str(tmp_path / "out.tif")
        with pytest.raises(MapError, match="non-integer"):
            raster.reproject([Source(name="f", location=path)], 1, grid, [], out, lambda f: None)

    def test_declared_nodata_masks_those_pixels(self, tmp_path):
        rng = np.random.default_rng(3)
        data = rng.integers(1, 4, (100, 100)).astype("int16")
        data[:10, :] = -1
        path = write_raster(
            tmp_path, "i.tif", data, "EPSG:4326", from_origin(33.5, 1.5, 0.001, 0.001), nodata=-1
        )
        grid = raster.plan_grid([Source(name="i", location=path)], LAEA, 100.0, 10**9)
        out = str(tmp_path / "out.tif")
        census = raster.reproject(
            [Source(name="i", location=path)], 1, grid, [], out, lambda f: None
        )
        assert census.masked_pixels > 0

    def test_negative_value_with_no_declared_nodata_raises(self, tmp_path):
        rng = np.random.default_rng(3)
        data = rng.integers(1, 4, (100, 100)).astype("int16")
        data[:10, :] = -1
        path = write_raster(
            tmp_path, "i2.tif", data, "EPSG:4326", from_origin(33.5, 1.5, 0.001, 0.001)
        )
        grid = raster.plan_grid([Source(name="i2", location=path)], LAEA, 100.0, 10**9)
        out = str(tmp_path / "out.tif")
        with pytest.raises(MapError, match=r"0\.\.65534"):
            raster.reproject([Source(name="i2", location=path)], 1, grid, [], out, lambda f: None)

    def test_value_above_max_raises(self, tmp_path):
        data = np.full((20, 20), 70000, dtype="uint32")
        path = write_raster(tmp_path, "big.tif", data, LAEA, from_origin(0, 100, 10, 10))
        grid = raster.plan_grid([Source(name="big", location=path)], LAEA, 10.0, 10**9)
        out = str(tmp_path / "out.tif")
        with pytest.raises(MapError, match=r"0\.\.65534"):
            raster.reproject([Source(name="big", location=path)], 1, grid, [], out, lambda f: None)


class TestBandIndex:
    def test_band_beyond_the_file_bands_raises(self, tmp_path):
        data = np.zeros((20, 20), dtype="uint8")
        path = write_raster(tmp_path, "one.tif", data, LAEA, from_origin(0, 100, 10, 10))
        grid = raster.plan_grid([Source(name="one", location=path)], LAEA, 10.0, 10**9)
        out = str(tmp_path / "out.tif")
        with pytest.raises(MapError, match="no band 2"):
            raster.reproject([Source(name="one", location=path)], 2, grid, [], out, lambda f: None)


def _grid_spec(tmp_path, width, height, resolution=10.0):
    wkt = raster.equal_area_crs(LAEA).to_wkt()
    transform = Affine(resolution, 0, 0, 0, -resolution, resolution * height)
    return (
        wkt,
        transform,
        GridSpec(
            crs=wkt,
            resolution_m=resolution,
            width=width,
            height=height,
            transform=transform.to_gdal(),
        ),
    )


class TestStratify:
    def test_classes_fold_into_1_based_codes_in_order(self, tmp_path):
        wkt, transform, grid = _grid_spec(tmp_path, width=4, height=1)
        strata_src = np.array([[1, 2, 3, NODATA]], dtype="uint16")
        src_path = write_raster(
            tmp_path, "strata_src.tif", strata_src, wkt, transform, nodata=NODATA
        )
        classes = [ReportingClass(id="crop", values=[1, 2]), ReportingClass(id="other", values=[3])]
        out = str(tmp_path / "strata.tif")

        census = raster.stratify(src_path, classes, [], grid, [], out, lambda f: None)

        assert census.codes == {"crop": 1, "other": 2}
        assert census.total == {"crop": 2, "other": 1}
        assert census.nodata_pixels == 0
        with rasterio.open(out) as ds:
            written = ds.read(1)
        assert np.array_equal((written == 1), np.isin(strata_src, [1, 2]))
        assert np.array_equal((written == 2), strata_src == 3)

    def test_nodata_values_are_counted_and_do_not_need_a_class(self, tmp_path):
        wkt, transform, grid = _grid_spec(tmp_path, width=4, height=1)
        strata_src = np.array([[1, 2, 3, 0]], dtype="uint16")
        src_path = write_raster(
            tmp_path, "strata_src.tif", strata_src, wkt, transform, nodata=NODATA
        )
        classes = [ReportingClass(id="crop", values=[1, 2]), ReportingClass(id="other", values=[3])]
        out = str(tmp_path / "strata.tif")

        census = raster.stratify(src_path, classes, [0], grid, [], out, lambda f: None)

        assert census.nodata_pixels == 1

    def test_total_and_by_area_equal_the_regrouped_raw_census(self, tmp_path):
        src, data = laea_source(tmp_path, resolution=10, nodata=0)
        grid = raster.plan_grid([src], LAEA, 10.0, 10**9)
        zones = [
            Zone("a", shapely.box(-5000, 0, 0, 5000)),
            Zone("b", shapely.box(0, 0, 4000, 5000)),
        ]
        reproj_out = str(tmp_path / "reproj.tif")
        raw = raster.reproject([src], 1, grid, zones, reproj_out, lambda f: None)

        classes = [ReportingClass(id="crop", values=[1, 2]), ReportingClass(id="other", values=[3])]
        strata_out = str(tmp_path / "strata.tif")
        census = raster.stratify(reproj_out, classes, [0], grid, zones, strata_out, lambda f: None)

        assert census.total == {
            "crop": raw.total.get(1, 0) + raw.total.get(2, 0),
            "other": raw.total.get(3, 0),
        }
        assert census.nodata_pixels == raw.total.get(0, 0)
        assert census.by_area["a"] == {
            "crop": raw.by_area["a"].get(1, 0) + raw.by_area["a"].get(2, 0),
            "other": raw.by_area["a"].get(3, 0),
        }

    def test_value_without_class_or_nodata_raises_and_lists_it(self, tmp_path):
        wkt, transform, grid = _grid_spec(tmp_path, width=4, height=1)
        strata_src = np.array([[1, 2, 9, NODATA]], dtype="uint16")
        src_path = write_raster(
            tmp_path, "strata_bad.tif", strata_src, wkt, transform, nodata=NODATA
        )
        classes = [ReportingClass(id="crop", values=[1, 2]), ReportingClass(id="other", values=[3])]
        out = str(tmp_path / "strata.tif")

        with pytest.raises(MapError, match="9"):
            raster.stratify(src_path, classes, [], grid, [], out, lambda f: None)

    def test_grid_mismatched_with_the_reprojected_file_raises(self, tmp_path):
        wkt, transform, grid = _grid_spec(tmp_path, width=4, height=1)
        strata_src = np.array([[1, 2, 3, NODATA]], dtype="uint16")
        src_path = write_raster(
            tmp_path, "strata_src.tif", strata_src, wkt, transform, nodata=NODATA
        )
        classes = [ReportingClass(id="crop", values=[1, 2]), ReportingClass(id="other", values=[3])]
        out = str(tmp_path / "strata.tif")
        mismatched = grid.model_copy(update={"width": grid.width + 1})

        with pytest.raises(MapError, match="does not match its grid"):
            raster.stratify(src_path, classes, [], mismatched, [], out, lambda f: None)


class TestProgress:
    def test_reproject_progress_reaches_one_and_is_non_decreasing(self, tmp_path):
        a = write_raster(
            tmp_path,
            "a.tif",
            np.full((50, 50), 1, dtype="uint8"),
            LAEA,
            Affine(10, 0, 0, 0, -10, 500),
        )
        b = write_raster(
            tmp_path,
            "b.tif",
            np.full((50, 50), 2, dtype="uint8"),
            LAEA,
            Affine(10, 0, 25000, 0, -10, 500),
        )
        srcs = [Source(name="a", location=a), Source(name="b", location=b)]
        grid = raster.plan_grid(srcs, LAEA, 10.0, 10**9)
        out = str(tmp_path / "out.tif")
        progress: list[float] = []

        raster.reproject(srcs, 1, grid, [], out, progress.append)

        assert len(progress) > 1
        assert progress[-1] == 1.0
        assert all(progress[i] <= progress[i + 1] for i in range(len(progress) - 1))

    def test_stratify_progress_reaches_one(self, tmp_path):
        wkt, transform, grid = _grid_spec(tmp_path, width=4, height=1)
        strata_src = np.array([[1, 2, 3, NODATA]], dtype="uint16")
        src_path = write_raster(
            tmp_path, "strata_src.tif", strata_src, wkt, transform, nodata=NODATA
        )
        classes = [ReportingClass(id="crop", values=[1, 2]), ReportingClass(id="other", values=[3])]
        out = str(tmp_path / "strata.tif")
        progress: list[float] = []

        raster.stratify(src_path, classes, [], grid, [], out, progress.append)

        assert progress[-1] == 1.0
        assert all(progress[i] <= progress[i + 1] for i in range(len(progress) - 1))

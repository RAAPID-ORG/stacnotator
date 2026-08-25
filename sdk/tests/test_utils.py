import json

import numpy as np
import pytest
import rasterio
from pyogrio import raw
from rasterio.transform import from_bounds
from rio_cogeo.cogeo import cog_validate

from stacnotator.utils import array_to_cog, merge_to_cog, to_cog, to_pmtiles


def write_tif(path, data, bounds, crs="EPSG:4326"):
    height, width = data.shape
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=width,
        height=height,
        count=1,
        dtype=data.dtype,
        crs=crs,
        transform=from_bounds(*bounds, width, height),
    ) as dst:
        dst.write(data, 1)
    return path


def test_to_cog_produces_valid_cog_with_same_data(tmp_path):
    data = np.arange(64 * 64, dtype="uint16").reshape(64, 64)
    src = write_tif(tmp_path / "plain.tif", data, (0, 0, 1, 1))

    dst = to_cog(src)

    assert dst == tmp_path / "plain.cog.tif"
    valid, errors, _warnings = cog_validate(dst, quiet=True)
    assert valid, errors
    with rasterio.open(dst) as cog:
        assert (cog.read(1) == data).all()


def test_to_cog_explicit_destination(tmp_path):
    data = np.zeros((32, 32), dtype="uint8")
    src = write_tif(tmp_path / "plain.tif", data, (0, 0, 1, 1))

    dst = to_cog(src, tmp_path / "out.tif")

    assert dst == tmp_path / "out.tif"
    assert cog_validate(dst, quiet=True)[0]


def test_array_to_cog_writes_a_georeferenced_valid_cog(tmp_path):
    data = np.arange(64 * 32, dtype="uint8").reshape(32, 64)

    dst = array_to_cog(data, (10.0, 40.0, 12.0, 41.0), tmp_path / "predictions.cog.tif")

    valid, errors, _warnings = cog_validate(dst, quiet=True)
    assert valid, errors
    with rasterio.open(dst) as cog:
        assert cog.count == 1
        assert cog.crs.to_string() == "EPSG:4326"
        assert cog.bounds == (10.0, 40.0, 12.0, 41.0)
        assert (cog.read(1) == data).all()


def test_array_to_cog_multiband_and_nodata(tmp_path):
    data = np.random.default_rng(42).random((3, 16, 16)).astype("float32")

    dst = array_to_cog(data, (0, 0, 1, 1), tmp_path / "probs.tif", nodata=-1.0)

    with rasterio.open(dst) as cog:
        assert cog.count == 3
        assert cog.nodata == -1.0
        assert (cog.read() == data).all()


def test_array_to_cog_rejects_wrong_dimensions(tmp_path):
    with pytest.raises(ValueError, match="2D.*or 3D"):
        array_to_cog(np.zeros(8, dtype="uint8"), (0, 0, 1, 1), tmp_path / "out.tif")


def test_array_to_cog_rejects_inverted_bounds(tmp_path):
    data = np.zeros((8, 8), dtype="uint8")

    with pytest.raises(ValueError, match="west, south, east, north"):
        array_to_cog(data, (1, 0, 0, 1), tmp_path / "out.tif")


def test_merge_to_cog_mosaics_a_chip_grid(tmp_path):
    chips = tmp_path / "chips"
    chips.mkdir()
    values = {}
    for i, (x, y) in enumerate([(0, 0), (1, 0), (0, 1), (1, 1)]):
        data = np.full((64, 64), i + 1, dtype="uint8")
        bounds = (x, y, x + 1, y + 1)
        write_tif(chips / f"chip_{x}_{y}.tif", data, bounds)
        values[(x, y)] = i + 1

    dst = merge_to_cog(chips, tmp_path / "merged.tif")

    valid, errors, _warnings = cog_validate(dst, quiet=True)
    assert valid, errors
    with rasterio.open(dst) as cog:
        assert cog.bounds == (0.0, 0.0, 2.0, 2.0)
        assert cog.width == 128 and cog.height == 128
        merged = cog.read(1)
    # rows are north-up: chip (0,1) is top-left, chip (1,0) is bottom-right
    assert merged[0, 0] == values[(0, 1)]
    assert merged[127, 127] == values[(1, 0)]
    assert merged[127, 0] == values[(0, 0)]
    assert merged[0, 127] == values[(1, 1)]


def test_merge_to_cog_accepts_explicit_paths(tmp_path):
    a = write_tif(tmp_path / "a.tif", np.ones((16, 16), dtype="uint8"), (0, 0, 1, 1))
    b = write_tif(tmp_path / "b.tif", np.ones((16, 16), dtype="uint8"), (1, 0, 2, 1))

    dst = merge_to_cog([a, b], tmp_path / "merged.tif")

    with rasterio.open(dst) as cog:
        assert cog.bounds == (0.0, 0.0, 2.0, 1.0)


def test_merge_to_cog_rejects_mixed_crs(tmp_path):
    a = write_tif(tmp_path / "a.tif", np.ones((16, 16), dtype="uint8"), (0, 0, 1, 1))
    b = write_tif(
        tmp_path / "b.tif", np.ones((16, 16), dtype="uint8"), (0, 0, 100, 100), crs="EPSG:3857"
    )

    with pytest.raises(ValueError, match="CRS"):
        merge_to_cog([a, b], tmp_path / "merged.tif")


def test_merge_to_cog_rejects_empty_folder(tmp_path):
    empty = tmp_path / "chips"
    empty.mkdir()

    with pytest.raises(ValueError, match="[Nn]o GeoTIFF"):
        merge_to_cog(empty, tmp_path / "merged.tif")


def geojson_polygons(path):
    features = [
        {
            "type": "Feature",
            "properties": {"name": f"field-{i}", "kind": "crop"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[i, 0.0], [i + 0.9, 0.0], [i + 0.9, 0.9], [i, 0.9], [i, 0.0]]],
            },
        }
        for i in range(3)
    ]
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    return path


def test_to_pmtiles_produces_readable_pmtiles(tmp_path):
    src = geojson_polygons(tmp_path / "fields.geojson")

    dst = to_pmtiles(src)

    assert dst == tmp_path / "fields.pmtiles"
    assert dst.read_bytes()[:7] == b"PMTiles"


def test_to_pmtiles_explicit_destination_and_layer(tmp_path):
    src = geojson_polygons(tmp_path / "fields.geojson")

    dst = to_pmtiles(src, tmp_path / "out.pmtiles", layer="fields")

    assert dst == tmp_path / "out.pmtiles"
    assert dst.read_bytes()[:7] == b"PMTiles"


FEATURE = {
    "type": "Feature",
    "properties": {"crop": "maize"},
    "geometry": {
        "type": "Polygon",
        "coordinates": [[[30.0, 50.0], [30.1, 50.0], [30.1, 50.1], [30.0, 50.1], [30.0, 50.0]]],
    },
}


def test_to_pmtiles_from_a_feature_collection(tmp_path):
    dst = to_pmtiles(
        {"type": "FeatureCollection", "features": [FEATURE]}, tmp_path / "fields.pmtiles"
    )

    assert dst.read_bytes()[:7] == b"PMTiles"


def test_to_pmtiles_from_a_list_of_features(tmp_path):
    dst = to_pmtiles([FEATURE, FEATURE], tmp_path / "fields.pmtiles")

    assert dst.read_bytes()[:7] == b"PMTiles"


def test_to_pmtiles_from_geo_interface(tmp_path):
    """What a GeoDataFrame or a shapely geometry offers, without the dependency."""

    class Frame:
        __geo_interface__ = {"type": "FeatureCollection", "features": [FEATURE]}

    dst = to_pmtiles(Frame(), tmp_path / "fields.pmtiles")

    assert dst.read_bytes()[:7] == b"PMTiles"


def test_to_pmtiles_from_features_needs_a_destination():
    with pytest.raises(ValueError, match="dst is required"):
        to_pmtiles({"type": "FeatureCollection", "features": [FEATURE]})


def test_to_pmtiles_reprojects_a_source_in_another_crs(tmp_path):
    """Tiles are Web Mercator by definition, so a UTM source has to be moved -
    silently writing its metres as mercator metres lands it in another country."""
    src = tmp_path / "utm.geojson"
    src.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::32636"}},
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"n": 1},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [
                                [
                                    [500000, 5540000],
                                    [510000, 5540000],
                                    [510000, 5550000],
                                    [500000, 5550000],
                                    [500000, 5540000],
                                ]
                            ],
                        },
                    }
                ],
            }
        )
    )

    meta, _index, _geometry, _fields = raw.read(to_pmtiles(src))

    assert meta["crs"] == "EPSG:3857"


def test_to_pmtiles_refuses_a_source_without_a_crs(tmp_path):
    src = tmp_path / "nocrs.fgb"
    meta, _index, geometry, fields = raw.read(geojson_polygons(tmp_path / "in.geojson"))
    raw.write(
        src,
        geometry,
        fields,
        fields=meta["fields"],
        driver="FlatGeobuf",
        geometry_type=meta["geometry_type"],
        crs=None,
    )

    with pytest.raises(ValueError, match="declares no CRS"):
        to_pmtiles(src)

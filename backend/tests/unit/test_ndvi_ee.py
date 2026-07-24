from unittest.mock import MagicMock

import ee
import pandas as pd
import pytest

from src.timeseries import ndvi_ee


def _fake_collection() -> MagicMock:
    """A chainable stand-in for ee.ImageCollection: every builder method
    returns the same mock so fluent chains resolve without a real EE call."""
    collection = MagicMock()
    collection.filterDate.return_value = collection
    collection.filterBounds.return_value = collection
    collection.map.return_value = collection
    collection.select.return_value = collection
    return collection


class TestRegionDataToDataframe:
    def test_shapes_columns_clips_ndvi_and_fills_missing_cloud(self):
        times = [
            int(pd.Timestamp("2024-01-01").timestamp() * 1000),
            int(pd.Timestamp("2024-02-01").timestamp() * 1000),
            int(pd.Timestamp("2024-03-01").timestamp() * 1000),
        ]
        region_data = [
            ["longitude", "latitude", "time", "NDVI", "cloud"],
            [36.9, -0.9, times[0], 1.5, 1],  # above valid range, clipped to 1.0
            [36.9, -0.9, times[1], -0.2, 0],  # below valid range, clipped to 0.0
            [36.9, -0.9, times[2], 0.42, None],  # missing cloud, filled to 0
        ]

        df = ndvi_ee._region_data_to_dataframe(region_data)

        assert list(df.columns) == ["time", "values", "cloud"]
        assert df["values"].tolist() == [1.0, 0.0, 0.42]
        assert df["cloud"].tolist() == [1, 0, 0]
        assert df["cloud"].dtype.kind == "i"
        assert df["time"].iloc[0] == pd.Timestamp("2024-01-01")


class TestDsConfigsSelection:
    def test_registers_exactly_the_supported_sources(self):
        assert set(ndvi_ee.ds_configs) == {"MODIS", "SENTINEL2"}

    def test_modis_uses_its_own_cloud_mask_and_skips_cloudscore_link(self):
        config = ndvi_ee.ds_configs["MODIS"]
        assert config["collection_id"] == "MODIS/061/MOD09Q1"
        assert config["cloudmask_callable"] is ndvi_ee.add_modis_cloud_mask
        assert config["link_cloudscore"] is False

    def test_sentinel2_links_cloudscore_and_uses_its_own_cloud_mask(self):
        config = ndvi_ee.ds_configs["SENTINEL2"]
        assert config["collection_id"] == "COPERNICUS/S2_SR_HARMONIZED"
        assert config["cloudmask_callable"] is ndvi_ee.add_s2_cloud_mask
        assert config["link_cloudscore"] is True

    def test_unknown_source_raises_before_touching_ee(self):
        with pytest.raises(ValueError, match="not recognized"):
            ndvi_ee.fetch_ndvi(
                "LANDSAT",
                latitude=1.0,
                longitude=2.0,
                start_date="2024-01-01",
                end_date="2024-02-01",
            )


class TestFetchNdvi:
    def test_selects_the_configured_collection_and_scale(self, monkeypatch):
        collection = _fake_collection()
        image_collection = MagicMock(return_value=collection)
        collection.getRegion.return_value.getInfo.return_value = [["time", "NDVI", "cloud"]]
        monkeypatch.setattr(ndvi_ee.ee, "ImageCollection", image_collection)
        monkeypatch.setattr(ndvi_ee.ee.Geometry, "Point", MagicMock(return_value="point"))

        ndvi_ee.fetch_ndvi(
            "modis", latitude=1.0, longitude=2.0, start_date="2024-01-01", end_date="2024-02-01"
        )

        image_collection.assert_called_once_with("MODIS/061/MOD09Q1")
        collection.getRegion.assert_called_once_with("point", 250)

    def test_sentinel2_links_cloudscore_before_mapping_ndvi(self, monkeypatch):
        collection = _fake_collection()
        collection.getRegion.return_value.getInfo.return_value = [["time", "NDVI", "cloud"]]
        monkeypatch.setattr(ndvi_ee.ee, "ImageCollection", MagicMock(return_value=collection))
        monkeypatch.setattr(ndvi_ee.ee.Geometry, "Point", MagicMock(return_value="point"))
        link_cloudscore_plus = MagicMock(return_value=collection)
        monkeypatch.setattr(ndvi_ee, "_link_cloudscore_plus", link_cloudscore_plus)

        ndvi_ee.fetch_ndvi(
            "SENTINEL2", latitude=1.0, longitude=2.0, start_date="2024-01-01", end_date="2024-02-01"
        )

        link_cloudscore_plus.assert_called_once_with(collection)

    def test_maps_a_429_error_to_rate_limited(self, monkeypatch):
        collection = _fake_collection()
        collection.getRegion.return_value.getInfo.side_effect = ee.EEException(
            "quota exceeded: 429 Too Many Requests"
        )
        monkeypatch.setattr(ndvi_ee.ee, "ImageCollection", MagicMock(return_value=collection))
        monkeypatch.setattr(ndvi_ee.ee.Geometry, "Point", MagicMock(return_value="point"))

        with pytest.raises(ndvi_ee.RateLimited):
            ndvi_ee.fetch_ndvi(
                "MODIS", latitude=1.0, longitude=2.0, start_date="2024-01-01", end_date="2024-02-01"
            )

    def test_maps_any_other_ee_error_to_upstream_failed(self, monkeypatch):
        collection = _fake_collection()
        collection.getRegion.return_value.getInfo.side_effect = ee.EEException(
            "computation timed out"
        )
        monkeypatch.setattr(ndvi_ee.ee, "ImageCollection", MagicMock(return_value=collection))
        monkeypatch.setattr(ndvi_ee.ee.Geometry, "Point", MagicMock(return_value="point"))

        with pytest.raises(ndvi_ee.UpstreamFailed):
            ndvi_ee.fetch_ndvi(
                "MODIS", latitude=1.0, longitude=2.0, start_date="2024-01-01", end_date="2024-02-01"
            )

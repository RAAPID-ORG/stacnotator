import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src.imagery.models import ImageryCollection, ImageryGenerationSeries, ImagerySource
from src.imagery.schemas import (
    ImageryGenerationConfigV1,
    ImageryGenerationSeriesCreate,
    ImagerySourceCreate,
)
from src.imagery.service import _reconcile_generation_series
from src.planet.schemas import PlanetScenesGenerationConfigV1


def generation_config(**overrides):
    value = {
        "version": 1,
        "catalog_url": "https://example.test/stac",
        "stac_collection_id": "sentinel-2",
        "collection_title": "Sentinel-2",
        "is_mpc": False,
        "has_cloud_cover": True,
        "start_date": "2025-01",
        "end_date": "2025-12",
        "collection_period_interval": 1,
        "collection_period_unit": "months",
        "slice_period_interval": 1,
        "slice_period_unit": "weeks",
        "cover_mode": "nth",
        "cover_slice_nth": 1,
        "max_cloud_cover": 90,
        "item_sort": "date_desc",
        "cover_max_cloud_cover": 90,
        "cover_item_sort": "date_desc",
        "visualizations": [
            {
                "name": "RGB",
                "viz_params": {"assets": ["red", "green", "blue"]},
            }
        ],
    }
    value.update(overrides)
    return value


def source_payload(*, series_id=None):
    return ImagerySourceCreate.model_validate(
        {
            "id": 7,
            "name": "Source",
            "visualizations": [{"name": "RGB"}],
            "generation_series": [
                {"key": "series-a", "id": series_id, "config": generation_config()}
            ],
            "collections": [
                {
                    "name": "January",
                    "generation_series_key": "series-a",
                    "slices": [{"start_date": "2025-01-01", "end_date": "2025-01-31"}],
                }
            ],
        }
    )


class FakeSession:
    def __init__(self):
        self.next_id = 100
        self.added = []

    def add(self, value):
        if value.id is None:
            value.id = self.next_id
            self.next_id += 1
        self.added.append(value)

    def flush(self):
        pass


def test_generation_config_is_versioned_typed_and_strict():
    assert ImageryGenerationConfigV1.model_validate(generation_config()).version == 1

    with pytest.raises(ValidationError):
        ImageryGenerationConfigV1.model_validate(generation_config(version=2))
    with pytest.raises(ValidationError):
        ImageryGenerationConfigV1.model_validate(generation_config(accidental_field=True))


def test_source_requires_series_keys_to_be_valid_and_referenced():
    source_payload()

    value = source_payload().model_dump()
    value["collections"][0]["generation_series_key"] = "missing"
    with pytest.raises(ValidationError, match="unknown generation series keys"):
        ImagerySourceCreate.model_validate(value)

    value = source_payload().model_dump()
    value["collections"][0]["generation_series_key"] = None
    with pytest.raises(ValidationError, match="unreferenced generation series keys"):
        ImagerySourceCreate.model_validate(value)


def test_persistence_creates_one_config_owner_and_resolves_collection_key():
    db = FakeSession()
    source = ImagerySource(id=7, campaign_id=3, name="Source", generation_series=[])

    by_key, stale, _ = _reconcile_generation_series(db, source, source_payload())

    assert by_key == {"series-a": 100}
    assert stale == []
    assert len(db.added) == 1
    assert isinstance(db.added[0], ImageryGenerationSeries)
    assert db.added[0].config["collection_title"] == "Sentinel-2"


def test_persistence_rejects_a_series_id_from_another_source():
    source = ImagerySource(id=7, campaign_id=3, name="Source", generation_series=[])

    with pytest.raises(HTTPException, match="does not belong to source 7"):
        _reconcile_generation_series(FakeSession(), source, source_payload(series_id=999))


def test_persistence_updates_kept_series_and_returns_stale_series_for_deletion():
    kept = ImageryGenerationSeries(id=10, source_id=7, config=generation_config())
    stale = ImageryGenerationSeries(
        id=11,
        source_id=7,
        config=generation_config(collection_title="Old series"),
    )
    source = ImagerySource(
        id=7,
        campaign_id=3,
        name="Source",
        generation_series=[kept, stale],
    )
    payload = source_payload(series_id=10)
    payload.generation_series[0].config.collection_title = "Updated series"

    by_key, stale_series, _ = _reconcile_generation_series(FakeSession(), source, payload)

    assert by_key == {"series-a": 10}
    assert kept.config["collection_title"] == "Updated series"
    assert stale_series == [stale]


def test_collection_model_only_references_the_series():
    columns = ImageryGenerationSeries.__table__.columns

    assert set(columns.keys()) == {"id", "source_id", "config"}
    collection_columns = set(ImageryCollection.__table__.columns.keys())
    assert "generation_series_id" in collection_columns
    assert "generation_config" not in collection_columns


class TestGenerationConfigKinds:
    """The config column now holds two shapes; neither may swallow the other."""

    def _series(self, config):
        return ImageryGenerationSeriesCreate(key="k", config=config)

    def test_a_config_saved_before_planet_scenes_existed_still_parses_as_stac(self):
        series = self._series(generation_config())

        assert isinstance(series.config, ImageryGenerationConfigV1)
        assert series.config.kind == "stac"

    def test_a_planet_scene_config_is_not_mistaken_for_a_stac_one(self):
        series = self._series(
            {
                "kind": "planet_scenes",
                "aoi": {"type": "Point", "coordinates": [0, 0]},
                "start_date": "2024-01-01",
                "end_date": "2024-01-31",
                "collection_period_interval": 1,
                "collection_period_unit": "months",
                "slice_period_interval": 1,
                "slice_period_unit": "days",
                "whole_window_cover": True,
            }
        )

        assert isinstance(series.config, PlanetScenesGenerationConfigV1)
        assert series.config.item_types == ["PSScene"]

    def test_a_config_matching_neither_shape_is_rejected(self):
        with pytest.raises(ValidationError):
            self._series({"kind": "planet_scenes", "start_date": "2024-01-01"})


PLANET_CONFIG = {
    "kind": "planet_scenes",
    "aoi": {"type": "Point", "coordinates": [0, 0]},
    "start_date": "2024-01-01",
    "end_date": "2024-01-31",
    "collection_period_interval": 1,
    "collection_period_unit": "months",
    "slice_period_interval": 1,
    "slice_period_unit": "days",
    "whole_window_cover": True,
}


def planet_payload(*, series_id=None, **config_overrides):
    return ImagerySourceCreate.model_validate(
        {
            "id": 7,
            "name": "PlanetScope",
            "visualizations": [{"name": "Visual"}],
            "generation_series": [
                {
                    "key": "series-a",
                    "id": series_id,
                    "config": {**PLANET_CONFIG, **config_overrides},
                }
            ],
            "collections": [
                {
                    "name": "January",
                    "generation_series_key": "series-a",
                    "slices": [{"start_date": "2024-01-05", "end_date": "2024-01-05"}],
                }
            ],
        }
    )


class TestPlanetSeriesNeedRegistering:
    """Minting spends Planet quota, so only a config that actually changed pays for it."""

    def test_a_new_planet_series_is_handed_to_registration(self):
        source = ImagerySource(id=7, campaign_id=3, name="PlanetScope", generation_series=[])

        _, _, pending = _reconcile_generation_series(FakeSession(), source, planet_payload())

        assert len(pending) == 1
        assert pending[0].source_id == 7
        assert pending[0].visualization_name == "Visual"
        assert pending[0].config.start_date == "2024-01-01"

    def test_saving_an_unchanged_planet_series_mints_nothing(self):
        series = ImageryGenerationSeries(
            id=10,
            source_id=7,
            config=PlanetScenesGenerationConfigV1.model_validate(PLANET_CONFIG).model_dump(
                mode="json"
            ),
        )
        source = ImagerySource(id=7, campaign_id=3, name="PlanetScope", generation_series=[series])

        _, _, pending = _reconcile_generation_series(
            FakeSession(), source, planet_payload(series_id=10)
        )

        assert pending == []

    def test_a_changed_search_re_mints_the_series(self):
        series = ImageryGenerationSeries(
            id=10,
            source_id=7,
            config=PlanetScenesGenerationConfigV1.model_validate(PLANET_CONFIG).model_dump(
                mode="json"
            ),
        )
        source = ImagerySource(id=7, campaign_id=3, name="PlanetScope", generation_series=[series])

        _, _, pending = _reconcile_generation_series(
            FakeSession(), source, planet_payload(series_id=10, max_cloud_cover=20)
        )

        assert [spec.config.max_cloud_cover for spec in pending] == [20]

    def test_an_unchanged_stac_series_is_not_a_registration_of_its_own(self):
        series = ImageryGenerationSeries(id=10, source_id=7, config=generation_config())
        source = ImagerySource(id=7, campaign_id=3, name="Source", generation_series=[series])

        _, _, pending = _reconcile_generation_series(
            FakeSession(), source, source_payload(series_id=10)
        )

        assert pending == []

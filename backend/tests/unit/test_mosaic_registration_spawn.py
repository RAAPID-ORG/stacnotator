"""Tests for RegistrationSpec and spawn_background_mosaic_registration's wiring
into the background-run protocol (src/background.py, covered in
test_background_runs.py). Mirrors test_collection_refresh_spawn.py.
"""

from unittest.mock import MagicMock

import pytest

from src.imagery import registration
from src.imagery.registration import RegistrationSpec
from src.imagery.schemas import CollectionStacConfigCreate


@pytest.fixture()
def spawn(monkeypatch):
    spawn = MagicMock()
    monkeypatch.setattr(registration.background, "spawn_status_run", spawn)
    return spawn


def _make_spec(collection_id: int = 7) -> RegistrationSpec:
    return RegistrationSpec(
        collection_id=collection_id,
        collection_name="Sentinel-2",
        stac_config=CollectionStacConfigCreate(),
        has_dedicated_cover=True,
        cover_slice_index=0,
        source_viz_names=["true_color"],
    )


class TestRegistrationSpec:
    def test_is_frozen(self):
        spec = _make_spec()
        with pytest.raises(AttributeError):
            spec.collection_id = 99


class TestSpawnBackgroundMosaicRegistration:
    def test_spawns_the_registration_status_run(self, spawn):
        registration.spawn_background_mosaic_registration(
            campaign_id=1, pending_registrations=[_make_spec()], bbox=[0, 0, 1, 1]
        )

        spawn.assert_called_once()
        args, kwargs = spawn.call_args
        assert args == (1, registration.REGISTRATION_RUN)
        assert kwargs["name"] == "mosaic registration"

    def test_work_passes_specs_straight_through_without_db_lookup(self, spawn, monkeypatch):
        register = MagicMock(return_value=[])
        monkeypatch.setattr(registration, "_register_all_stac_browser_collections", register)

        specs = [_make_spec()]
        registration.spawn_background_mosaic_registration(
            campaign_id=1, pending_registrations=specs, bbox=[0, 0, 1, 1]
        )
        db = MagicMock()
        assert spawn.call_args.kwargs["work"](db) == []

        register.assert_called_once_with(db, specs, [0, 0, 1, 1], 1)
        db.get.assert_not_called()

    def test_sanitizer_prefixes_the_domain(self, spawn):
        registration.spawn_background_mosaic_registration(
            campaign_id=1, pending_registrations=[_make_spec()], bbox=[0, 0, 1, 1]
        )

        sanitized = spawn.call_args.kwargs["sanitize_error"](ValueError("Unknown tiler 'bogus'"))
        assert sanitized == "Mosaic registration: Unknown tiler 'bogus'"

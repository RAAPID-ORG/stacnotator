"""Tests for spawn_background_collection_refresh's wiring into the
background-run protocol (src/background.py, covered in test_background_runs.py).
Mirrors test_mosaic_registration_spawn.py.
"""

from unittest.mock import MagicMock

import pytest

from src.imagery import registration


@pytest.fixture()
def spawn(monkeypatch):
    spawn = MagicMock()
    monkeypatch.setattr(registration.background, "spawn_status_run", spawn)
    return spawn


class TestSpawnBackgroundCollectionRefresh:
    def test_spawns_the_registration_status_run(self, spawn):
        registration.spawn_background_collection_refresh(
            campaign_id=1, collection_id=7, bbox=[0, 0, 1, 1]
        )

        spawn.assert_called_once()
        args, kwargs = spawn.call_args
        assert args == (1, registration.REGISTRATION_RUN)
        assert kwargs["name"] == "collection 7 refresh"

    def test_work_refreshes_the_collection(self, spawn, monkeypatch):
        refresh = MagicMock()
        monkeypatch.setattr(registration, "refresh_collection_imagery", refresh)

        registration.spawn_background_collection_refresh(
            campaign_id=1, collection_id=7, bbox=[0, 0, 1, 1]
        )
        db = MagicMock()
        spawn.call_args.kwargs["work"](db)

        refresh.assert_called_once_with(db, 7, 1, [0, 0, 1, 1])

    def test_sanitizer_prefixes_the_domain(self, spawn):
        registration.spawn_background_collection_refresh(
            campaign_id=1, collection_id=7, bbox=[0, 0, 1, 1]
        )

        sanitized = spawn.call_args.kwargs["sanitize_error"](RuntimeError("tiler down"))
        assert sanitized == "Collection refresh: tiler down"


class TestSpawnBackgroundSourceRefresh:
    def test_runs_every_collection_in_one_status_run(self, spawn, monkeypatch):
        refresh = MagicMock()
        monkeypatch.setattr(registration, "refresh_collection_imagery", refresh)

        registration.spawn_background_source_refresh(
            campaign_id=1, collection_ids=[7, 8], bbox=[0, 0, 1, 1]
        )

        spawn.assert_called_once()
        args, kwargs = spawn.call_args
        assert args == (1, registration.REGISTRATION_RUN)
        assert kwargs["name"] == "source refresh (2 collections)"

        db = MagicMock()
        kwargs["work"](db)
        assert [call.args for call in refresh.call_args_list] == [
            (db, 7, 1, [0, 0, 1, 1]),
            (db, 8, 1, [0, 0, 1, 1]),
        ]

    def test_sanitizer_prefixes_the_domain(self, spawn):
        registration.spawn_background_source_refresh(
            campaign_id=1, collection_ids=[7], bbox=[0, 0, 1, 1]
        )

        sanitized = spawn.call_args.kwargs["sanitize_error"](RuntimeError("tiler down"))
        assert sanitized == "Source refresh: tiler down"

"""Tests for RegistrationSpec and spawn_background_mosaic_registration's
status-transition protocol.

Stubs threading.Thread to run the target inline (no real thread) and stubs
SessionLocal/_register_all_stac_browser_collections so the transitions can be
asserted without a database. Mirrors test_collection_refresh_spawn.py.
"""

from unittest.mock import MagicMock

import pytest

from src.imagery import registration
from src.imagery.registration import RegistrationSpec
from src.imagery.schemas import CollectionStacConfigCreate


class _InlineThread:
    """Stand-in for threading.Thread that runs the target synchronously."""

    def __init__(self, target, daemon=True):
        self._target = target

    def start(self):
        self._target()


@pytest.fixture(autouse=True)
def _run_thread_inline(monkeypatch):
    monkeypatch.setattr(registration.threading, "Thread", _InlineThread)


def _make_session():
    return MagicMock()


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
    def test_passes_specs_straight_through_without_db_lookup(self, monkeypatch):
        db = _make_session()
        monkeypatch.setattr(registration, "SessionLocal", lambda: db)
        register = MagicMock(return_value=[])
        monkeypatch.setattr(registration, "_register_all_stac_browser_collections", register)
        monkeypatch.setattr(registration, "finish_registration", MagicMock())

        specs = [_make_spec()]
        registration.spawn_background_mosaic_registration(
            campaign_id=1, pending_registrations=specs, bbox=[0, 0, 1, 1]
        )

        register.assert_called_once_with(db, specs, [0, 0, 1, 1], 1)
        db.get.assert_not_called()

    def test_success_finishes_registration_status_ready_with_no_errors(self, monkeypatch):
        db = _make_session()
        monkeypatch.setattr(registration, "SessionLocal", lambda: db)
        monkeypatch.setattr(
            registration, "_register_all_stac_browser_collections", lambda *a, **k: []
        )
        finish_registration = MagicMock()
        monkeypatch.setattr(registration, "finish_registration", finish_registration)

        registration.spawn_background_mosaic_registration(
            campaign_id=1, pending_registrations=[_make_spec()], bbox=[0, 0, 1, 1]
        )

        finish_registration.assert_called_once_with(
            db,
            1,
            status_field="registration_status",
            status="ready",
            errors=[],
        )
        db.commit.assert_called()
        db.close.assert_called()

    def test_failure_calls_finish_registration_with_prefixed_sanitized_error(self, monkeypatch):
        db = _make_session()
        monkeypatch.setattr(registration, "SessionLocal", lambda: db)

        def _raise(*a, **k):
            raise ValueError("Unknown tiler 'bogus'")

        monkeypatch.setattr(registration, "_register_all_stac_browser_collections", _raise)
        finish_registration = MagicMock()
        monkeypatch.setattr(registration, "finish_registration", finish_registration)

        registration.spawn_background_mosaic_registration(
            campaign_id=1, pending_registrations=[_make_spec()], bbox=[0, 0, 1, 1]
        )

        finish_registration.assert_called_once_with(
            db,
            1,
            status_field="registration_status",
            status="failed",
            errors=[{"error": "Mosaic registration: Unknown tiler 'bogus'"}],
        )
        db.commit.assert_called()
        db.close.assert_called()

    def test_failure_rolls_back_poisoned_session_before_finish_registration(self, monkeypatch):
        """A DB error mid-registration leaves the session's transaction invalid;
        finish_registration's own db.flush() would raise PendingRollbackError
        unless the session is rolled back first."""
        db = _make_session()
        calls: list[str] = []
        db.rollback.side_effect = lambda: calls.append("rollback")
        monkeypatch.setattr(registration, "SessionLocal", lambda: db)

        def _raise(*a, **k):
            raise ValueError("boom")

        monkeypatch.setattr(registration, "_register_all_stac_browser_collections", _raise)
        finish_registration = MagicMock(
            side_effect=lambda *a, **k: calls.append("finish_registration")
        )
        monkeypatch.setattr(registration, "finish_registration", finish_registration)

        registration.spawn_background_mosaic_registration(
            campaign_id=1, pending_registrations=[_make_spec()], bbox=[0, 0, 1, 1]
        )

        assert calls == ["rollback", "finish_registration"]

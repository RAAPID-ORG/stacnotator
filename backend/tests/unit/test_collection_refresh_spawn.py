"""Tests for spawn_background_collection_refresh's status-transition protocol.

Stubs threading.Thread to run the target inline (no real thread) and stubs
SessionLocal/refresh_collection_imagery so the transitions can be asserted
without a database. Mirrors test_embeddings_spawn.py: the failure path calls
imagery.registration.finish_registration (a Core UPDATE) rather than mutating
the campaign object directly, so those tests assert on how it was called;
finish_registration itself is covered against a real database in
test_finish_registration.py.
"""

from unittest.mock import MagicMock

import pytest

from src.imagery import registration


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


class TestSpawnBackgroundCollectionRefresh:
    def test_success_finishes_registration_status_ready_with_no_errors(self, monkeypatch):
        db = _make_session()
        monkeypatch.setattr(registration, "SessionLocal", lambda: db)
        monkeypatch.setattr(registration, "refresh_collection_imagery", lambda *a, **k: {})
        finish_registration = MagicMock()
        monkeypatch.setattr(registration, "finish_registration", finish_registration)

        registration.spawn_background_collection_refresh(
            campaign_id=1, collection_id=7, bbox=[0, 0, 1, 1]
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
            raise RuntimeError("tiler exploded")

        monkeypatch.setattr(registration, "refresh_collection_imagery", _raise)
        finish_registration = MagicMock()
        monkeypatch.setattr(registration, "finish_registration", finish_registration)

        registration.spawn_background_collection_refresh(
            campaign_id=1, collection_id=7, bbox=[0, 0, 1, 1]
        )

        finish_registration.assert_called_once_with(
            db,
            1,
            status_field="registration_status",
            status="failed",
            errors=[{"error": "Collection refresh: tiler exploded"}],
        )
        db.commit.assert_called()
        db.close.assert_called()

    def test_failure_rolls_back_poisoned_session_before_finish_registration(self, monkeypatch):
        """A DB error mid-refresh leaves the session's transaction invalid;
        finish_registration's own db.flush() would raise PendingRollbackError
        unless the session is rolled back first."""
        db = _make_session()
        calls: list[str] = []
        db.rollback.side_effect = lambda: calls.append("rollback")
        monkeypatch.setattr(registration, "SessionLocal", lambda: db)

        def _raise(*a, **k):
            raise RuntimeError("tiler exploded")

        monkeypatch.setattr(registration, "refresh_collection_imagery", _raise)
        finish_registration = MagicMock(
            side_effect=lambda *a, **k: calls.append("finish_registration")
        )
        monkeypatch.setattr(registration, "finish_registration", finish_registration)

        registration.spawn_background_collection_refresh(
            campaign_id=1, collection_id=7, bbox=[0, 0, 1, 1]
        )

        assert calls == ["rollback", "finish_registration"]

    def test_failure_when_finish_registration_itself_raises_still_closes_session(self, monkeypatch):
        """The commit-of-last-resort in the except block can itself fail (e.g. DB
        down); the session must still be closed rather than leaked."""
        db = _make_session()
        db.commit.side_effect = RuntimeError("db down")
        monkeypatch.setattr(registration, "SessionLocal", lambda: db)

        def _raise(*a, **k):
            raise RuntimeError("tiler exploded")

        monkeypatch.setattr(registration, "refresh_collection_imagery", _raise)

        registration.spawn_background_collection_refresh(
            campaign_id=1, collection_id=7, bbox=[0, 0, 1, 1]
        )

        db.close.assert_called()

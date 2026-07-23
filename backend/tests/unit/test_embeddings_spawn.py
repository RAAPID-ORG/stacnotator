"""Tests for spawn_background_embedding_computation's status-transition protocol.

Stubs threading.Thread to run the target inline (no real thread) and stubs
SessionLocal/populate_campaign_embeddings so the transitions can be asserted
against a plain campaign stand-in without a database. The failure path calls
imagery.registration.finish_registration (a Core UPDATE) rather than mutating
the campaign object directly, so those tests assert on how it was called
instead of on campaign attributes; finish_registration itself is covered
against a real database in test_finish_registration.py.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from src.annotation import embeddings_service


class _InlineThread:
    """Stand-in for threading.Thread that runs the target synchronously."""

    def __init__(self, target, daemon=True):
        self._target = target

    def start(self):
        self._target()


@pytest.fixture(autouse=True)
def _run_thread_inline(monkeypatch):
    monkeypatch.setattr(embeddings_service.threading, "Thread", _InlineThread)


def _make_campaign():
    # Caller is expected to have already committed "registering" before spawning.
    return SimpleNamespace(embedding_status="registering", registration_errors=None)


def _make_session(campaign):
    db = MagicMock()
    db.get.return_value = campaign
    return db


class TestSpawnBackgroundEmbeddingComputation:
    def test_success_transitions_registering_to_ready(self, monkeypatch):
        campaign = _make_campaign()
        db = _make_session(campaign)
        monkeypatch.setattr(embeddings_service, "SessionLocal", lambda: db)
        monkeypatch.setattr(embeddings_service, "populate_campaign_embeddings", lambda *a, **k: {})

        embeddings_service.spawn_background_embedding_computation(campaign_id=1, year=2023)

        assert campaign.embedding_status == "ready"
        assert campaign.registration_errors is None
        db.commit.assert_called()
        db.close.assert_called()

    def test_failure_calls_finish_registration_with_prefixed_sanitized_error(self, monkeypatch):
        campaign = _make_campaign()
        db = _make_session(campaign)
        monkeypatch.setattr(embeddings_service, "SessionLocal", lambda: db)
        finish_registration = MagicMock()
        monkeypatch.setattr(embeddings_service, "finish_registration", finish_registration)

        def _raise(*a, **k):
            raise RuntimeError("GEE exploded")

        monkeypatch.setattr(embeddings_service, "populate_campaign_embeddings", _raise)

        embeddings_service.spawn_background_embedding_computation(campaign_id=1, year=2023)

        finish_registration.assert_called_once_with(
            db,
            1,
            status_field="embedding_status",
            status="failed",
            errors=[{"error": "Embeddings: GEE exploded"}],
        )
        db.commit.assert_called()
        db.close.assert_called()

    def test_failure_does_not_read_modify_write_registration_errors(self, monkeypatch):
        """The failure path must go through finish_registration's atomic append,
        never through a read-then-write of campaign.registration_errors - that
        read-modify-write is exactly what let concurrent threads clobber each
        other's errors."""
        campaign = _make_campaign()
        campaign.registration_errors = [{"error": "prior mosaic failure"}]
        db = _make_session(campaign)
        monkeypatch.setattr(embeddings_service, "SessionLocal", lambda: db)
        finish_registration = MagicMock()
        monkeypatch.setattr(embeddings_service, "finish_registration", finish_registration)

        def _raise(*a, **k):
            raise RuntimeError("boom")

        monkeypatch.setattr(embeddings_service, "populate_campaign_embeddings", _raise)

        embeddings_service.spawn_background_embedding_computation(campaign_id=1, year=2023)

        finish_registration.assert_called_once_with(
            db,
            1,
            status_field="embedding_status",
            status="failed",
            errors=[{"error": "Embeddings: boom"}],
        )
        # Only finish_registration's own UPDATE writes registration_errors; this
        # path must never have touched the ORM attribute directly.
        assert campaign.registration_errors == [{"error": "prior mosaic failure"}]

    def test_missing_campaign_does_not_raise(self, monkeypatch):
        db = MagicMock()
        db.get.return_value = None
        monkeypatch.setattr(embeddings_service, "SessionLocal", lambda: db)
        monkeypatch.setattr(embeddings_service, "populate_campaign_embeddings", lambda *a, **k: {})

        # Should not raise even though there is no campaign row to update.
        embeddings_service.spawn_background_embedding_computation(campaign_id=1, year=2023)

        db.close.assert_called()

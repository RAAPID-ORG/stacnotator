"""Tests for spawn_background_embedding_computation's status-transition protocol.

Stubs threading.Thread to run the target inline (no real thread) and stubs
SessionLocal/populate_campaign_embeddings so the transitions can be asserted
against a plain campaign stand-in without a database.
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

    def test_failure_transitions_registering_to_failed_with_sanitized_error(self, monkeypatch):
        campaign = _make_campaign()
        db = _make_session(campaign)
        monkeypatch.setattr(embeddings_service, "SessionLocal", lambda: db)

        def _raise(*a, **k):
            raise RuntimeError("GEE exploded")

        monkeypatch.setattr(embeddings_service, "populate_campaign_embeddings", _raise)

        embeddings_service.spawn_background_embedding_computation(campaign_id=1, year=2023)

        assert campaign.embedding_status == "failed"
        assert campaign.registration_errors == [{"error": "GEE exploded"}]
        db.close.assert_called()

    def test_failure_appends_to_existing_errors(self, monkeypatch):
        campaign = _make_campaign()
        campaign.registration_errors = [{"error": "prior mosaic failure"}]
        db = _make_session(campaign)
        monkeypatch.setattr(embeddings_service, "SessionLocal", lambda: db)

        def _raise(*a, **k):
            raise RuntimeError("boom")

        monkeypatch.setattr(embeddings_service, "populate_campaign_embeddings", _raise)

        embeddings_service.spawn_background_embedding_computation(campaign_id=1, year=2023)

        assert campaign.embedding_status == "failed"
        assert campaign.registration_errors == [
            {"error": "prior mosaic failure"},
            {"error": "boom"},
        ]

    def test_missing_campaign_does_not_raise(self, monkeypatch):
        db = MagicMock()
        db.get.return_value = None
        monkeypatch.setattr(embeddings_service, "SessionLocal", lambda: db)
        monkeypatch.setattr(embeddings_service, "populate_campaign_embeddings", lambda *a, **k: {})

        # Should not raise even though there is no campaign row to update.
        embeddings_service.spawn_background_embedding_computation(campaign_id=1, year=2023)

        db.close.assert_called()

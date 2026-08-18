"""Tests for spawn_background_embedding_computation's wiring into the
background-run protocol (src/background.py, covered in test_background_runs.py).

The spawn hands the protocol a work callable and an error sanitizer; these
tests capture that call and exercise both, DB-free.
"""

from datetime import datetime
from unittest.mock import MagicMock

import pytest

from src.annotation import embeddings_service


@pytest.fixture()
def spawn(monkeypatch):
    spawn = MagicMock()
    monkeypatch.setattr(embeddings_service.background, "spawn_status_run", spawn)
    return spawn


def test_spawns_the_embedding_status_run(spawn):
    embeddings_service.spawn_background_embedding_computation(campaign_id=1, year=2023)

    spawn.assert_called_once()
    args, kwargs = spawn.call_args
    assert args == (1, embeddings_service.EMBEDDING_RUN)
    assert kwargs["name"] == "embedding computation"


def test_work_populates_the_year_range_when_earth_engine_is_ready(spawn, monkeypatch):
    monkeypatch.setattr(embeddings_service, "ensure_earth_engine", lambda: True)
    populate = MagicMock()
    monkeypatch.setattr(embeddings_service, "populate_campaign_embeddings", populate)

    embeddings_service.spawn_background_embedding_computation(campaign_id=1, year=2023)
    db = MagicMock()
    spawn.call_args.kwargs["work"](db)

    populate.assert_called_once_with(db, 1, datetime(2023, 1, 1), datetime(2023, 12, 31))


def test_work_fails_clearly_when_earth_engine_is_unavailable(spawn, monkeypatch):
    monkeypatch.setattr(embeddings_service, "ensure_earth_engine", lambda: False)

    embeddings_service.spawn_background_embedding_computation(campaign_id=1, year=2023)

    with pytest.raises(RuntimeError, match="Earth Engine is unavailable"):
        spawn.call_args.kwargs["work"](MagicMock())


def test_sanitizer_prefixes_the_domain(spawn):
    embeddings_service.spawn_background_embedding_computation(campaign_id=1, year=2023)

    sanitized = spawn.call_args.kwargs["sanitize_error"](RuntimeError("GEE exploded"))
    assert sanitized == "Embeddings: GEE exploded"

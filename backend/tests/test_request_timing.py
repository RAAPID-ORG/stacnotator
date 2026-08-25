import logging

from fastapi.testclient import TestClient

from src import main
from src.main import app


def test_response_carries_server_timing_header():
    response = TestClient(app).get("/healthz")

    assert response.status_code == 200
    assert float(response.headers["X-Response-Time-ms"]) >= 0
    assert response.headers["X-Request-ID"]


def test_slow_request_is_logged_with_its_breakdown_and_inflight_count(monkeypatch, caplog):
    """A slow request always carries the full breakdown, whether or not per-request
    timing logging is on - the tail is exactly where the attribution is needed."""
    monkeypatch.setattr(main.settings, "SLOW_REQUEST_MS", 0.0)
    monkeypatch.setattr(main.settings, "LOG_REQUEST_TIMING", False)

    with caplog.at_level(logging.WARNING, logger="src.main"):
        TestClient(app).get("/healthz")

    message = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("perf |"))
    assert "/healthz" in message
    assert "inflight=0" in message
    assert "q=0" in message

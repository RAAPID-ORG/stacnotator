import logging

from fastapi.testclient import TestClient

from src import main
from src.main import app


def test_response_carries_server_timing_header():
    response = TestClient(app).get("/healthz")

    assert response.status_code == 200
    assert float(response.headers["X-Response-Time-ms"]) >= 0
    assert response.headers["X-Request-ID"]


def test_slow_request_is_logged_with_inflight_count(monkeypatch, caplog):
    monkeypatch.setattr(main.settings, "SLOW_REQUEST_MS", 0.0)

    with caplog.at_level(logging.WARNING, logger="src.main"):
        TestClient(app).get("/healthz")

    record = next(r for r in caplog.records if r.message.startswith("Slow request"))
    assert "/healthz" in record.getMessage()
    assert "inflight=0" in record.getMessage()

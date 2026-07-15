"""The proxy must not hold a DB connection across the upstream tile fetch."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from src.imagery import proxy_router
from src.imagery.proxy_router import require_tile_access
from src.main import app

CAMPAIGN_ID = 3
BASEMAP_ID = 7


@pytest.fixture()
def events(monkeypatch):
    """Record DB-session and upstream-fetch events in the order they happen."""
    log: list[str] = []

    class FakeSession:
        def get(self, model, pk):
            log.append("db")
            return SimpleNamespace(
                id=pk,
                campaign_id=CAMPAIGN_ID,
                url="https://p/{z}/{x}/{y}?k={api_key}",
                encrypted_api_key="enc",
            )

        def close(self):
            log.append("close")

    async def fake_get(url):
        log.append("fetch")
        return SimpleNamespace(
            content=b"tile", headers={"content-type": "image/png"}, raise_for_status=lambda: None
        )

    monkeypatch.setattr(proxy_router, "SessionLocal", FakeSession)
    monkeypatch.setattr(proxy_router, "decrypt", lambda _: "KEY")
    monkeypatch.setattr(proxy_router._client, "get", fake_get)
    app.dependency_overrides[require_tile_access] = lambda: None
    yield log
    app.dependency_overrides.clear()


def test_session_closes_before_the_upstream_fetch(events):
    """Holding the session across the fetch pins a pooled connection for the whole
    upstream round-trip while doing no DB work - that is what drained the pool."""
    client = TestClient(app)

    resp = client.get(
        f"/api/{CAMPAIGN_ID}/imagery/basemaps/{BASEMAP_ID}/tiles/5/1/2",
    )

    assert resp.status_code == 200
    assert events == ["db", "close", "fetch"]

"""Set-key endpoints + tile proxy, via TestClient with mocked DB/httpx (no real PG/network)."""

import base64
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from src import crypto
from src.auth.dependencies import require_approved_user
from src.campaigns.dependencies import require_campaign_admin
from src.database import get_db
from src.imagery import proxy_router
from src.imagery.models import Basemap
from src.imagery.router import bearer
from src.main import app
from src.tiling import tiler_token

CAMPAIGN_ID = 7
_VALID_KEY = base64.b64encode(b"k" * 32).decode()


@pytest.fixture()
def crypto_key(monkeypatch):
    """Point the crypto module at a fixed AES-256 key for deterministic encrypt/decrypt."""
    monkeypatch.setattr(
        crypto, "get_settings", lambda: SimpleNamespace(APIKEY_ENCRYPTION_SECRET=_VALID_KEY)
    )


@pytest.fixture()
def client():
    return TestClient(app)


def _override_admin_auth(db):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_approved_user] = lambda: SimpleNamespace(id="u1")
    app.dependency_overrides[require_campaign_admin] = lambda: SimpleNamespace(id=CAMPAIGN_ID)
    app.dependency_overrides[bearer] = lambda: None


def teardown_function():
    app.dependency_overrides.clear()


# --- set-key endpoint -----------------------------------------------------------


def test_set_basemap_key_stores_ciphertext(client, crypto_key):
    basemap = Basemap(id=3, campaign_id=CAMPAIGN_ID, name="planet", url="x")
    db = MagicMock()
    db.get.return_value = basemap
    _override_admin_auth(db)

    resp = client.put(f"/api/{CAMPAIGN_ID}/imagery/basemaps/3/key", json={"value": "planet-secret"})

    assert resp.status_code == 200
    assert resp.json() == {"has_api_key": True}
    # Stored value is ciphertext, not the plaintext key, and round-trips.
    assert basemap.encrypted_api_key != "planet-secret"
    assert crypto.decrypt(basemap.encrypted_api_key) == "planet-secret"
    assert "planet-secret" not in resp.text


def test_set_basemap_key_404_on_wrong_campaign(client, crypto_key):
    basemap = Basemap(id=3, campaign_id=999, name="planet", url="x")
    db = MagicMock()
    db.get.return_value = basemap
    _override_admin_auth(db)

    resp = client.put(f"/api/{CAMPAIGN_ID}/imagery/basemaps/3/key", json={"value": "v"})
    assert resp.status_code == 404


# --- tile proxy auth ------------------------------------------------------------


def _tile_url(z=1, x=0, y=0):
    return f"/api/{CAMPAIGN_ID}/imagery/basemaps/3/tiles/{z}/{x}/{y}"


def test_proxy_rejects_missing_cookie(client):
    resp = client.get(_tile_url())
    assert resp.status_code == 401


def test_proxy_rejects_wrong_campaign_token(client):
    token = tiler_token.mint("u1", [999])  # not CAMPAIGN_ID
    resp = client.get(_tile_url(), cookies={"tiler_token": token})
    assert resp.status_code == 403


def test_proxy_404_when_key_not_configured(client, monkeypatch):
    basemap = Basemap(id=3, campaign_id=CAMPAIGN_ID, name="p", url="https://e/{z}/{x}/{y}")
    db = MagicMock()
    db.get.return_value = basemap  # encrypted_api_key is None
    monkeypatch.setattr(proxy_router, "SessionLocal", lambda: db)
    token = tiler_token.mint("u1", [CAMPAIGN_ID])
    resp = client.get(_tile_url(), cookies={"tiler_token": token})
    assert resp.status_code == 404


def test_proxy_fetches_and_returns_tile(client, crypto_key, monkeypatch):
    basemap = Basemap(
        id=3,
        campaign_id=CAMPAIGN_ID,
        name="p",
        url="https://e/{z}/{x}/{y}.png?api_key={api_key}",
    )
    basemap.encrypted_api_key = crypto.encrypt("planet-secret")
    db = MagicMock()
    db.get.return_value = basemap
    monkeypatch.setattr(proxy_router, "SessionLocal", lambda: db)

    captured = {}

    class FakeResp:
        content = b"PNGDATA"
        headers = {"content-type": "image/png"}

        def raise_for_status(self):
            pass

    async def fake_get(url):
        captured["url"] = url
        return FakeResp()

    monkeypatch.setattr(proxy_router._client, "get", fake_get)

    token = tiler_token.mint("u1", [CAMPAIGN_ID])
    resp = client.get(_tile_url(z=2, x=1, y=1), cookies={"tiler_token": token})

    assert resp.status_code == 200
    assert resp.content == b"PNGDATA"
    assert resp.headers["cache-control"] == "public, max-age=86400"
    # The key was attached server-side to the upstream URL with coords substituted.
    assert captured["url"] == "https://e/2/1/1.png?api_key=planet-secret"

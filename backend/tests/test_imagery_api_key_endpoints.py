"""Set-key endpoints + tile proxy, via TestClient with mocked DB/httpx (no real PG/network)."""

import base64
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from src import crypto
from src.auth.dependencies import require_authenticated_user
from src.campaigns.dependencies import require_campaign_admin
from src.database import get_db
from src.imagery import proxy_router
from src.imagery.models import Basemap
from src.imagery.router import bearer
from src.main import app
from src.organizations.models import OrganizationApiKey
from src.tilers import tokens as tiler_token

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


def _campaign_with_keys(keys):
    return SimpleNamespace(
        id=CAMPAIGN_ID,
        project=SimpleNamespace(organization=SimpleNamespace(api_keys=keys)),
    )


def _override_admin_auth(db, campaign=None):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_authenticated_user] = lambda: SimpleNamespace(id="u1")
    app.dependency_overrides[require_campaign_admin] = lambda: (
        campaign or SimpleNamespace(id=CAMPAIGN_ID)
    )
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
    assert resp.json() == {"has_api_key": True, "organization_api_key_id": None}
    # Stored value is ciphertext, not the plaintext key, and round-trips.
    assert basemap.encrypted_api_key != "planet-secret"
    assert crypto.decrypt(basemap.encrypted_api_key) == "planet-secret"
    assert "planet-secret" not in resp.text


def test_set_basemap_key_can_point_at_an_organization_key(client, crypto_key):
    """Choosing a shared key drops any literal one, so only one of the two ever
    applies."""
    basemap = Basemap(id=3, campaign_id=CAMPAIGN_ID, name="planet", url="x")
    basemap.encrypted_api_key = crypto.encrypt("old-literal-key")
    db = MagicMock()
    db.get.return_value = basemap
    _override_admin_auth(db, campaign=_campaign_with_keys([SimpleNamespace(id=11, name="Planet")]))

    resp = client.put(
        f"/api/{CAMPAIGN_ID}/imagery/basemaps/3/key", json={"organization_api_key_id": 11}
    )

    assert resp.status_code == 200
    assert resp.json() == {"has_api_key": True, "organization_api_key_id": 11}
    assert basemap.encrypted_api_key is None
    assert basemap.organization_api_key_id == 11


def test_set_basemap_key_rejects_a_key_from_another_organization(client, crypto_key):
    basemap = Basemap(id=3, campaign_id=CAMPAIGN_ID, name="planet", url="x")
    db = MagicMock()
    db.get.return_value = basemap
    _override_admin_auth(db, campaign=_campaign_with_keys([]))

    resp = client.put(
        f"/api/{CAMPAIGN_ID}/imagery/basemaps/3/key", json={"organization_api_key_id": 11}
    )
    assert resp.status_code == 404


def test_set_basemap_key_needs_exactly_one_of_the_two(client, crypto_key):
    _override_admin_auth(MagicMock())
    resp = client.put(f"/api/{CAMPAIGN_ID}/imagery/basemaps/3/key", json={})
    assert resp.status_code == 422


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


class FakeResp:
    content = b"PNGDATA"
    headers = {"content-type": "image/png"}

    def raise_for_status(self):
        pass


def _stub_upstream(monkeypatch) -> dict:
    """Record the URL the proxy would fetch, and never leave the process."""
    captured: dict[str, str] = {}

    async def fake_get(url):
        # str(): the proxy hands httpx its own parsed URL, which is the point - the
        # host it checked is the host it connects to.
        captured["url"] = str(url)
        return FakeResp()

    monkeypatch.setattr(proxy_router._client, "get", fake_get)
    return captured


def _serve(monkeypatch, basemap: Basemap) -> dict:
    db = MagicMock()
    db.get.return_value = basemap
    monkeypatch.setattr(proxy_router, "SessionLocal", lambda: db)
    return _stub_upstream(monkeypatch)


def _keyed_basemap(url: str = "https://tiles.example.com/{z}/{x}/{y}.png?api_key={api_key}"):
    return Basemap(id=3, campaign_id=CAMPAIGN_ID, name="p", url=url)


def _get_tile(client) -> object:
    return client.get(
        _tile_url(z=2, x=1, y=1), cookies={"tiler_token": tiler_token.mint("u1", [CAMPAIGN_ID])}
    )


def test_proxy_fetches_and_returns_tile(client, crypto_key, monkeypatch):
    basemap = _keyed_basemap("https://e/{z}/{x}/{y}.png?api_key={api_key}")
    basemap.encrypted_api_key = crypto.encrypt("planet-secret")
    captured = _serve(monkeypatch, basemap)

    resp = _get_tile(client)

    assert resp.status_code == 200
    assert resp.content == b"PNGDATA"
    assert resp.headers["cache-control"] == "public, max-age=86400"
    # The key was attached server-side to the upstream URL with coords substituted.
    assert captured["url"] == "https://e/2/1/1.png?api_key=planet-secret"


def test_proxy_uses_the_organization_key_when_the_layer_points_at_one(
    client, crypto_key, monkeypatch
):
    basemap = _keyed_basemap()
    basemap.organization_api_key = OrganizationApiKey(
        id=11, encrypted_key=crypto.encrypt("shared-secret"), allowed_tile_host="tiles.example.com"
    )
    captured = _serve(monkeypatch, basemap)

    resp = _get_tile(client)

    assert resp.status_code == 200
    assert captured["url"] == "https://tiles.example.com/2/1/1.png?api_key=shared-secret"


class TestSharedKeysGoWhereTheyAreBound:
    """A campaign admin writes the tile URL; the organization owns the shared key.
    The host on the key is what keeps the first from being a way to read the second."""

    def test_a_shared_key_is_not_sent_to_a_host_it_is_not_bound_to(
        self, client, crypto_key, monkeypatch
    ):
        basemap = _keyed_basemap("https://attacker.test/{z}/{x}/{y}.png?k={api_key}")
        basemap.organization_api_key = OrganizationApiKey(
            id=11,
            encrypted_key=crypto.encrypt("shared-secret"),
            allowed_tile_host="tiles.example.com",
        )
        captured = _serve(monkeypatch, basemap)

        resp = _get_tile(client)

        assert resp.status_code == 502
        assert "tiles.example.com" in resp.json()["detail"]
        assert captured == {}, "the key must not leave the process at all"

    def test_a_shared_key_reaches_its_hosts_subdomains(self, client, crypto_key, monkeypatch):
        """Providers shard tiles across subdomains, so binding the parent is what an
        admin can reasonably be asked for."""
        basemap = _keyed_basemap("https://a.tiles.example.com/{z}/{x}/{y}.png?api_key={api_key}")
        basemap.organization_api_key = OrganizationApiKey(
            id=11,
            encrypted_key=crypto.encrypt("shared-secret"),
            allowed_tile_host="tiles.example.com",
        )
        captured = _serve(monkeypatch, basemap)

        assert _get_tile(client).status_code == 200
        assert captured["url"].startswith("https://a.tiles.example.com/2/1/1.png")

    def test_a_lookalike_host_is_not_a_subdomain(self, client, crypto_key, monkeypatch):
        basemap = _keyed_basemap("https://nottiles.example.com/{z}/{x}/{y}.png?api_key={api_key}")
        basemap.organization_api_key = OrganizationApiKey(
            id=11,
            encrypted_key=crypto.encrypt("shared-secret"),
            allowed_tile_host="tiles.example.com",
        )
        _serve(monkeypatch, basemap)

        assert _get_tile(client).status_code == 502

    def test_a_shared_key_with_no_host_bound_serves_nothing(self, client, crypto_key, monkeypatch):
        """Keys stored before hosts existed. Refusing them is the safe direction:
        an admin gives the key a host and it works again."""
        basemap = _keyed_basemap()
        basemap.organization_api_key = OrganizationApiKey(
            id=11, encrypted_key=crypto.encrypt("shared-secret"), allowed_tile_host=None
        )
        captured = _serve(monkeypatch, basemap)

        assert _get_tile(client).status_code == 404
        assert captured == {}

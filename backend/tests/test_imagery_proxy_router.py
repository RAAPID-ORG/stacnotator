"""What the tile proxy does around the upstream fetch: who it serves, DB handling,
and what it lets back out to the browser."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from src import net_guard
from src.imagery import proxy_router
from src.imagery.models import ProviderKey
from src.imagery.proxy_router import (
    require_tile_access,
    require_visualizer_tile_access,
)
from src.layers import LayerOwner
from src.main import app
from src.tilers import tokens

CAMPAIGN_ID = 3
BASEMAP_ID = 7
TILE_PATH = f"/api/{CAMPAIGN_ID}/imagery/basemaps/{BASEMAP_ID}/tiles/5/1/2"


def _serve_basemap(monkeypatch, url: str, log: list[str]) -> None:
    """One basemap row with a decryptable key, no database."""

    class FakeSession:
        def get(self, model, pk):
            log.append("db")
            return SimpleNamespace(
                id=pk,
                campaign_id=CAMPAIGN_ID,
                owner=LayerOwner(campaign_id=CAMPAIGN_ID),
                url=url,
                provider_key=ProviderKey("enc", None),
            )

        def close(self):
            log.append("close")

    monkeypatch.setattr(proxy_router, "SessionLocal", FakeSession)
    monkeypatch.setattr(proxy_router, "decrypt", lambda _: "KEY")
    app.dependency_overrides[require_tile_access] = lambda: None


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


@pytest.fixture()
def upstream(monkeypatch):
    """A stubbed provider. Set ``content_type`` to change what it claims to return;
    ``log`` records the DB/fetch ordering the request produced."""
    stub = SimpleNamespace(content_type="image/png", log=[])

    async def fake_get(url):
        stub.log.append("fetch")
        return SimpleNamespace(
            content=b"tile",
            headers={"content-type": stub.content_type},
            raise_for_status=lambda: None,
        )

    _serve_basemap(monkeypatch, "https://p/{z}/{x}/{y}?k={api_key}", stub.log)
    monkeypatch.setattr(proxy_router._client, "get", fake_get)
    return stub


def test_session_closes_before_the_upstream_fetch(upstream):
    """Holding the session across the fetch pins a pooled connection for the whole
    upstream round-trip while doing no DB work - that is what drained the pool."""
    resp = TestClient(app).get(TILE_PATH)

    assert resp.status_code == 200
    assert upstream.log == ["db", "close", "fetch"]


def test_an_image_content_type_is_passed_through(upstream):
    upstream.content_type = "image/webp"
    assert TestClient(app).get(TILE_PATH).headers["content-type"] == "image/webp"


def test_a_non_image_content_type_is_not_echoed(upstream):
    """The body is whatever the upstream chose; served as HTML from our origin it
    would run as our origin."""
    upstream.content_type = "text/html"

    resp = TestClient(app).get(TILE_PATH)

    assert resp.headers["content-type"] == "application/octet-stream"
    assert resp.headers["x-content-type-options"] == "nosniff"


def test_an_internal_basemap_url_is_never_fetched(monkeypatch):
    """A campaign admin owns this URL, so the proxy is an SSRF hole without the guard.
    Nothing is stubbed here - the real guarded client has to refuse the connection."""
    _serve_basemap(monkeypatch, "http://169.254.169.254/latest/meta-data/{z}{x}{y}", [])

    resp = TestClient(app).get(TILE_PATH)

    assert resp.status_code == 502
    assert net_guard.BLOCKED_HOST in resp.json()["detail"]


class TestWhoTheProxyServes:
    """A visualizer's tile session holds the scopes of the campaigns it links from -
    the tiler has no finer unit to check against - so the proxy, where a provider key
    is actually spent, has to be the thing that keeps a shared link off the rest of
    those campaigns."""

    LINKED_CAMPAIGN = 42
    VISUALIZER = 3

    def _request(self, **claims):
        return SimpleNamespace(cookies={"tiler_token": tokens.mint(**claims)})

    def _visualizer_session(self):
        return self._request(
            sub=f"visualizer:{self.VISUALIZER}",
            campaigns=[str(self.LINKED_CAMPAIGN), f"visualizer:{self.VISUALIZER}"],
            visualizer_id=self.VISUALIZER,
        )

    def test_a_visualizer_session_reads_the_visualizers_own_route(self):
        require_visualizer_tile_access(self._visualizer_session(), visualizer_id=self.VISUALIZER)

    def test_a_visualizer_session_cannot_read_the_campaign_it_links_from(self):
        with pytest.raises(HTTPException) as exc:
            require_tile_access(self._visualizer_session(), campaign_id=self.LINKED_CAMPAIGN)

        assert exc.value.status_code == 403

    def test_a_visualizer_session_cannot_read_another_visualizer(self):
        with pytest.raises(HTTPException) as exc:
            require_visualizer_tile_access(self._visualizer_session(), visualizer_id=99)

        assert exc.value.status_code == 403

    def test_a_users_session_still_reads_their_campaigns(self):
        request = self._request(sub="user", campaigns=[str(self.LINKED_CAMPAIGN)])

        require_tile_access(request, campaign_id=self.LINKED_CAMPAIGN)


class TestServes:
    OWNER = LayerOwner(visualizer_id=3)

    def _source(self, owner):
        return SimpleNamespace(id=8, owner=owner)

    def test_a_visualizer_serves_its_own_imagery_without_a_lookup(self):
        db = MagicMock()

        assert proxy_router._serves(db, self._source(self.OWNER), self.OWNER)
        db.scalar.assert_not_called()

    def test_a_visualizer_serves_a_source_it_links(self):
        db = MagicMock()
        db.scalar.return_value = 1

        assert proxy_router._serves(db, self._source(LayerOwner(campaign_id=42)), self.OWNER)

    def test_a_visualizer_does_not_serve_the_rest_of_that_campaign(self):
        db = MagicMock()
        db.scalar.return_value = None

        assert not proxy_router._serves(db, self._source(LayerOwner(campaign_id=42)), self.OWNER)

    def test_a_campaigns_route_serves_only_its_own(self):
        owner = LayerOwner(campaign_id=42)

        assert proxy_router._serves(MagicMock(), self._source(owner), owner)
        assert not proxy_router._serves(MagicMock(), self._source(LayerOwner(campaign_id=7)), owner)

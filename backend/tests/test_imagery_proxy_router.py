"""What the tile proxy does around the upstream fetch: who it serves, DB handling,
and what it lets back out to the browser."""

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from src import main, net_guard
from src.config import get_settings
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
TILE_PATH = f"/api/campaigns/{CAMPAIGN_ID}/imagery/basemaps/{BASEMAP_ID}/tiles/5/1/2"


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
    stub = SimpleNamespace(content_type="image/png", content=b"tile", log=[])

    async def fake_get(url):
        stub.log.append("fetch")
        return SimpleNamespace(
            content=stub.content,
            headers={"content-type": stub.content_type},
            raise_for_status=lambda: None,
        )

    _serve_basemap(monkeypatch, "https://p/{z}/{x}/{y}?k={api_key}", stub.log)
    monkeypatch.setattr(proxy_router, "_fetch", fake_get)
    return stub


def test_session_closes_before_the_upstream_fetch(upstream):
    """Holding the session across the fetch pins a pooled connection for the whole
    upstream round-trip while doing no DB work - that is what drained the pool."""
    resp = TestClient(app).get(TILE_PATH)

    assert resp.status_code == 200
    assert upstream.log == ["db", "close", "fetch"]


@pytest.mark.parametrize(
    ("content_type", "expected"),
    [
        ("image/webp", "image/webp"),
        ("image/jpeg", "image/jpeg"),
        ("IMAGE/PNG; charset=UTF-8", "image/png"),
    ],
)
def test_a_raster_content_type_is_passed_through(upstream, content_type, expected):
    upstream.content_type = content_type
    resp = TestClient(app).get(TILE_PATH)

    assert resp.headers["content-type"] == expected
    assert resp.headers["content-security-policy"] == "sandbox; default-src 'none'"


@pytest.mark.parametrize("content_type", ["image/svg+xml", "IMAGE/SVG+XML; charset=UTF-8"])
def test_active_image_content_is_not_served_on_the_api_origin(upstream, content_type):
    upstream.content_type = content_type
    upstream.content = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

    resp = TestClient(app).get(TILE_PATH)

    assert resp.headers["content-type"] == "application/octet-stream"
    assert resp.headers["content-security-policy"] == "sandbox; default-src 'none'"
    assert resp.headers["x-content-type-options"] == "nosniff"


def test_a_non_image_content_type_is_not_echoed(upstream):
    """The body is whatever the upstream chose; served as HTML from our origin it
    would run as our origin."""
    upstream.content_type = "text/html"

    resp = TestClient(app).get(TILE_PATH)

    assert resp.headers["content-type"] == "application/octet-stream"
    assert resp.headers["x-content-type-options"] == "nosniff"


def test_planet_scene_layers_of_one_source_share_one_lookup(upstream):
    """Scene layers are minted per place looked at, so a cache keyed by layer went to the
    database for nearly every Planet tile."""
    client = TestClient(app)
    for layer in ("sceneA", "sceneB", "sceneC"):
        path = f"/api/campaigns/{CAMPAIGN_ID}/imagery/sources/5/planet-layers/{layer}/tiles/5/1/2"
        assert client.get(path).status_code == 200

    assert upstream.log.count("db") == 1
    assert upstream.log.count("fetch") == 3


def test_a_tile_is_never_gzipped(upstream):
    """Imagery is already compressed; gzipping it only burned CPU on every tile."""
    upstream.content = b"0" * 64_000

    resp = TestClient(app).get(TILE_PATH, headers={"Accept-Encoding": "gzip"})

    assert resp.status_code == 200
    assert "content-encoding" not in resp.headers


def test_a_worker_out_of_cpu_refuses_tiles_but_still_answers_the_api(upstream, monkeypatch):
    monkeypatch.setattr(main, "loop_overloaded", lambda: True)
    client = TestClient(app)

    assert client.get(TILE_PATH).status_code == 503
    assert client.get("/api/no-such-route").status_code == 404
    assert upstream.log == []


def test_light_traffic_keeps_to_one_pool_and_a_busy_pool_is_passed_over(monkeypatch):
    """Round-robin let every pool's keep-alive lapse, so a lone user's tiles each paid a
    new TLS handshake. And a pool whose connections hang on a slow host must not make
    fast tiles queue behind it."""
    used: list[int] = []

    def pool(i):
        async def get(url):
            used.append(i)
            return "ok"

        return SimpleNamespace(get=get)

    monkeypatch.setattr(proxy_router, "_clients", [pool(0), pool(1), pool(2)])
    monkeypatch.setattr(proxy_router, "_in_flight", [0, 0, 0])

    async def scenario():
        for _ in range(5):
            await proxy_router._fetch("u")
        proxy_router._in_flight[0] = 16  # stuck on a slow host
        await proxy_router._fetch("u")

    asyncio.run(scenario())
    assert used == [0, 0, 0, 0, 0, 1]


def test_the_upstream_budget_is_spread_over_small_pools():
    """httpcore rescans a pool on every request it starts or finishes, quadratically in
    the pool's size: one pool as big as the whole budget cost ~10ms of CPU per tile."""
    sizes = [client._transport._pool._max_connections for client in proxy_router._clients]

    assert max(sizes) <= 32
    assert sum(sizes) >= get_settings().TILE_UPSTREAM_MAX_CONCURRENCY


def test_an_internal_basemap_url_is_never_fetched(monkeypatch):
    """A campaign admin owns this URL, so the proxy is an SSRF hole without the guard.
    Nothing is stubbed here - the real guarded client has to refuse the connection."""
    _serve_basemap(monkeypatch, "http://169.254.169.254/latest/meta-data/{z}{x}{y}", [])

    resp = TestClient(app).get(TILE_PATH)

    assert resp.status_code == 502
    assert net_guard.BLOCKED_HOST in resp.json()["detail"]


class TestWhoTheProxyServes:
    """A visualizer's tile session names the visualizer and the single campaign layers
    it links, never those campaigns, so the proxy serves it the visualizer's routes and
    nothing a campaign's route would."""

    LINKED_CAMPAIGN = 42
    VISUALIZER = 3

    def _request(self, **claims):
        return SimpleNamespace(cookies={"tiler_token": tokens.mint(**claims)})

    def _visualizer_session(self):
        return self._request(
            sub=f"visualizer:{self.VISUALIZER}",
            owners=[f"visualizer:{self.VISUALIZER}"],
            layers=["source:5"],
        )

    def test_a_visualizer_session_reads_the_visualizers_own_route(self):
        asyncio.run(
            require_visualizer_tile_access(
                self._visualizer_session(), visualizer_id=self.VISUALIZER
            )
        )

    def test_a_visualizer_session_cannot_read_the_campaign_it_links_from(self):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                require_tile_access(self._visualizer_session(), campaign_id=self.LINKED_CAMPAIGN)
            )

        assert exc.value.status_code == 403

    def test_a_visualizer_session_cannot_read_another_visualizer(self):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                require_visualizer_tile_access(self._visualizer_session(), visualizer_id=99)
            )

        assert exc.value.status_code == 403

    def test_a_users_session_still_reads_their_campaigns(self):
        request = self._request(sub="user", owners=[str(self.LINKED_CAMPAIGN)])

        asyncio.run(require_tile_access(request, campaign_id=self.LINKED_CAMPAIGN))


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

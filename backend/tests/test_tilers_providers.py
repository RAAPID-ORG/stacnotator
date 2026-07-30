"""Provider routing + tile-URL building + register/ingest calls. No DB / network."""

from types import SimpleNamespace

import jwt

from src.config import TilerCfg
from src.tilers import providers
from src.tilers import tokens as tiler_token

MPC = "https://planetarycomputer.microsoft.com/api/stac/v1"
VIZ = {"assets": ["red", "green", "blue"], "rescale": "0,3000"}
TILER = TilerCfg(url="https://tiler-one.example.com", allows_ingest=True)


def test_select_provider_mpc_only_when_eligible():
    assert providers.select_provider(MPC, {"compositing": "first"}) == "mpc"
    assert providers.select_provider(MPC, {}) == "mpc"
    assert providers.select_provider(MPC, {"compositing": "median"}) == "hosted"
    assert providers.select_provider(MPC, {"mask_layer": "scl", "mask_values": [3]}) == "hosted"
    assert providers.select_provider("https://earth-search.aws.element84.com/v1", {}) == "hosted"


def test_build_tile_url_hosted_uses_tiler_url():
    url = providers.build_tile_url("hosted", "abc123", VIZ, tiler=TILER)
    assert url.startswith(
        "https://tiler-one.example.com/searches/abc123/tiles/WebMercatorQuad/{z}/{x}/{y}.png?"
    )
    assert "assets=red" in url and "rescale=0%2C3000" in url


def test_build_tile_url_mpc():
    url = providers.build_tile_url("mpc", "hash9", VIZ, collection_id="sentinel-2-l2a")
    assert "/mosaic/hash9/tiles/WebMercatorQuad/{z}/{x}/{y}" in url
    assert "collection=sentinel-2-l2a" in url and "pixel_selection=first" in url


def test_resolve_tiler_by_name_and_default(monkeypatch):
    monkeypatch.setattr(
        providers,
        "get_settings",
        lambda: SimpleNamespace(TILERS={"planet": TILER}, DEFAULT_TILER="planet"),
    )
    assert providers.resolve_tiler("planet") is TILER
    assert providers.resolve_tiler(None) is TILER  # falls back to DEFAULT_TILER


def _fake_post(monkeypatch, payload):
    captured = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return payload

    monkeypatch.setattr(
        providers.httpx,
        "post",
        lambda url, json, headers, timeout: (
            captured.update(url=url, json=json, headers=headers) or _Resp()
        ),
    )
    return captured


def test_register_on_tiler_posts_search_with_campaign(monkeypatch):
    captured = _fake_post(monkeypatch, {"id": "search-xyz"})
    out = providers.register_on_tiler(TILER, {"collections": ["sentinel-2-l2a"]}, campaign_id=42)
    assert out == "search-xyz"
    assert captured["url"] == "https://tiler-one.example.com/searches/register"
    assert captured["json"]["metadata"] == {"campaign_id": "42"}
    assert captured["headers"]["Authorization"].startswith("Bearer ")


def test_register_on_tiler_stamps_asset_signer_for_internal_storage(monkeypatch):
    captured = _fake_post(monkeypatch, {"id": "s"})
    providers.register_on_tiler(
        TILER, {"collections": ["c"]}, campaign_id=42, internal_storage=True
    )
    assert captured["json"]["metadata"] == {
        "campaign_id": "42",
        "asset_signer": "azure_managed_identity",
    }


def test_register_on_tiler_omits_marker_by_default(monkeypatch):
    captured = _fake_post(monkeypatch, {"id": "s"})
    providers.register_on_tiler(TILER, {"collections": ["c"]}, campaign_id=42)
    assert "asset_signer" not in captured["json"]["metadata"]


def test_ingest_on_tiler_posts_aoi(monkeypatch):
    captured = _fake_post(monkeypatch, {"collection": "sentinel-2-l2a", "ingested": 7})
    n = providers.ingest_on_tiler(
        TILER,
        "https://earth-search.aws.element84.com/v1",
        "sentinel-2-l2a",
        [1, 2, 3, 4],
        "2023-01-01/2023-12-31",
        max_cloud=20,
        limit=100,
    )
    assert n == 7
    assert captured["url"] == "https://tiler-one.example.com/ingest"
    assert captured["json"]["collection"] == "sentinel-2-l2a"


def test_ingest_rejected_when_tiler_disallows():
    no_ingest = TilerCfg(url="https://t", allows_ingest=False)
    try:
        providers.ingest_on_tiler(no_ingest, "x", "y", None, None)
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


def test_mint_token_claims():
    token = tiler_token.mint("u1", [1, 2], scope=["tiles:read"], ttl=60)
    from src.config import get_settings

    claims = jwt.decode(token, get_settings().TILER_TOKEN_SECRET, algorithms=["HS256"])
    assert claims["sub"] == "u1"
    assert claims["campaigns"] == ["1", "2"]
    assert claims["scope"] == ["tiles:read"]
    assert "exp" in claims

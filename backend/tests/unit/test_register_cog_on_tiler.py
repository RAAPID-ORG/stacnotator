"""Unit test for register_cog_on_tiler - no network, mirrors test_tilers_providers style."""

from src.config import TilerCfg
from src.tilers import providers

TILER = TilerCfg(url="https://tiler.test", allows_ingest=True)


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


def test_register_cog_posts_and_returns_id(monkeypatch):
    monkeypatch.setattr(providers, "mint_tiler_token", lambda *a, **k: "tok")
    monkeypatch.setattr(providers, "_register_base", lambda tiler: "https://tiler.test")
    captured = _fake_post(monkeypatch, {"id": "search-123"})

    result = providers.register_cog_on_tiler(TILER, "https://x/y.tif", 42)

    assert result == "search-123"
    assert captured["url"] == "https://tiler.test/searches/register-cog"
    assert captured["json"]["cog_url"] == "https://x/y.tif"
    assert captured["json"]["campaign_id"] == "42"
    assert captured["json"]["internal_storage"] is False
    assert captured["headers"]["Authorization"] == "Bearer tok"


def test_register_cog_forwards_internal_storage(monkeypatch):
    monkeypatch.setattr(providers, "mint_tiler_token", lambda *a, **k: "tok")
    monkeypatch.setattr(providers, "_register_base", lambda tiler: "https://tiler.test")
    captured = _fake_post(monkeypatch, {"id": "s"})

    providers.register_cog_on_tiler(TILER, "https://x/y.tif", 42, internal_storage=True)

    assert captured["json"]["internal_storage"] is True

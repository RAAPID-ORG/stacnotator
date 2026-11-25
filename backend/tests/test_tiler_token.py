"""Tiler token mint + verify round-trip and rejection cases. No DB / network."""

from types import SimpleNamespace

import jwt
import pytest
from fastapi import Response

from src.config import TilerCfg
from src.layers import LayerOwner
from src.tilers import tokens as tiler_token


@pytest.fixture()
def secret(monkeypatch):
    monkeypatch.setattr(
        tiler_token, "get_settings", lambda: SimpleNamespace(TILER_TOKEN_SECRET="test-secret")
    )


def test_mint_then_verify_returns_claims(secret):
    token = tiler_token.mint("user-1", [1, 2], scope=["tiles:read"], layers=["source:5"])
    claims = tiler_token.verify(token)
    assert claims["sub"] == "user-1"
    assert claims["owners"] == ["1", "2"]
    assert claims["layers"] == ["source:5"]
    assert claims["scope"] == ["tiles:read"]


def test_verify_rejects_expired(secret):
    token = tiler_token.mint("user-1", [1], ttl=-10)
    with pytest.raises(jwt.ExpiredSignatureError):
        tiler_token.verify(token)


def test_verify_rejects_wrong_secret(secret, monkeypatch):
    token = tiler_token.mint("user-1", [1])
    monkeypatch.setattr(
        tiler_token, "get_settings", lambda: SimpleNamespace(TILER_TOKEN_SECRET="other-secret")
    )
    with pytest.raises(jwt.InvalidTokenError):
        tiler_token.verify(token)


def _session_cookies(monkeypatch, owner: LayerOwner) -> list[str]:
    settings = SimpleNamespace(
        TILER_TOKEN_SECRET="test-secret",
        TILER_COOKIE_SECURE=True,
        TILER_COOKIE_SAMESITE="lax",
        TILER_COOKIE_DOMAIN=None,
        TILERS={
            "a": TilerCfg(url="https://tiler.example.com"),
            "b": TilerCfg(url="https://tiler.example.com/"),
            "c": TilerCfg(url="https://example.com/tiler"),
        },
    )
    monkeypatch.setattr(tiler_token, "get_settings", lambda: settings)
    response = Response()
    tiler_token.set_tile_session(response, sub="u1", owner=owner, layers=["source:5"])
    return [v.decode() for k, v in response.raw_headers if k == b"set-cookie"]


def test_a_session_names_one_owner_and_is_set_only_on_its_tile_paths(monkeypatch):
    cookies = _session_cookies(monkeypatch, LayerOwner(campaign_id=235))

    paths = [c.split("Path=")[1].split(";")[0] for c in cookies]
    assert paths == ["/api/campaigns/235/", "/scopes/235/", "/tiler/scopes/235/"]
    token = cookies[0].split(";")[0].removeprefix(f"{tiler_token.TILE_SESSION_COOKIE}=")
    claims = tiler_token.verify(token)
    assert (claims["owners"], claims["layers"]) == (["235"], ["source:5"])


def test_a_visualizer_session_is_set_on_the_visualizer_routes(monkeypatch):
    cookies = _session_cookies(monkeypatch, LayerOwner(visualizer_id=12))

    paths = [c.split("Path=")[1].split(";")[0] for c in cookies]
    assert paths == [
        "/api/visualizers/12/",
        "/scopes/visualizer:12/",
        "/tiler/scopes/visualizer:12/",
    ]

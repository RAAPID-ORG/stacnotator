"""Tiler token mint + verify round-trip and rejection cases. No DB / network."""

from types import SimpleNamespace

import jwt
import pytest

from src.tiling import tiler_token


@pytest.fixture()
def secret(monkeypatch):
    monkeypatch.setattr(
        tiler_token, "get_settings", lambda: SimpleNamespace(TILER_TOKEN_SECRET="test-secret")
    )


def test_mint_then_verify_returns_claims(secret):
    token = tiler_token.mint("user-1", [1, 2], scope=["tiles:read"])
    claims = tiler_token.verify(token)
    assert claims["sub"] == "user-1"
    assert claims["campaigns"] == ["1", "2"]
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

"""Mint short-lived HS256 tile-access tokens for the titiler-pgstac tilers.

Mirrors the tiler's own verification (its ``auth.py``): a JWT with
``{sub, exp, scope, campaigns}`` signed with the shared ``TILER_TOKEN_SECRET``. Browsers
receive it as an ``HttpOnly`` cookie (scope ``tiles:read`` + the user's campaigns);
backend->tiler register calls use it as a ``Bearer`` token with scope ``searches:write``.
"""

import time

import jwt
from fastapi import Response

from src.config import get_settings

ALGORITHM = "HS256"
DEFAULT_TTL = 3600
TILER_TOKEN_TTL = 3600  # 1 hour


def mint(
    sub: str,
    campaigns: list,
    scope: list[str] | None = None,
    ttl: int = DEFAULT_TTL,
    visualizer_id: int | None = None,
) -> str:
    """Create a signed tile-access token. Campaign ids are stringified to match the tiler.

    ``visualizer_id`` marks a session handed out for one published map. Such a session
    holds the scopes of the campaigns that map draws from - the tiler needs them to serve
    a linked source at all - but it is not a session on those campaigns, and the tile
    proxy narrows it back down to the visualizer's own routes.
    """
    payload = {
        "sub": str(sub),
        "exp": int(time.time()) + ttl,
        "scope": scope or ["tiles:read"],
        "campaigns": [str(c) for c in campaigns],
    }
    if visualizer_id is not None:
        payload["visualizer"] = visualizer_id
    return jwt.encode(payload, get_settings().TILER_TOKEN_SECRET, algorithm=ALGORITHM)


def verify(token: str) -> dict:
    """Decode and validate a tile-access token (signature + expiry).

    Raises ``jwt.InvalidTokenError`` (incl. ``ExpiredSignatureError``) on any failure.
    Used by the tile-proxy to authorize browser tile requests from the ``tiler_token`` cookie.
    """
    return jwt.decode(token, get_settings().TILER_TOKEN_SECRET, algorithms=[ALGORITHM])


def set_tiler_cookie(
    response: Response, *, sub: str, campaigns: list, visualizer_id: int | None = None
) -> None:
    """Attach the browser's ``tiles:read`` cookie for exactly these campaigns.

    The subject is whatever the caller is granting access on behalf of - a user
    for the app, a visualizer for a shared link - and never reaches the client.
    """
    settings = get_settings()
    response.set_cookie(
        key="tiler_token",
        value=mint(
            sub,
            campaigns,
            scope=["tiles:read"],
            ttl=TILER_TOKEN_TTL,
            visualizer_id=visualizer_id,
        ),
        max_age=TILER_TOKEN_TTL,
        httponly=True,
        secure=settings.TILER_COOKIE_SECURE,
        samesite=settings.TILER_COOKIE_SAMESITE,
        domain=settings.TILER_COOKIE_DOMAIN,
        path="/",
    )

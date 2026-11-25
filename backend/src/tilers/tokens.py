"""Mint short-lived HS256 tile-access tokens for the titiler-pgstac tilers.

Mirrors the tiler's own verification (its ``auth.py``): a JWT with
``{sub, exp, scope, owners, layers}`` signed with the shared ``TILER_TOKEN_SECRET``. A
search is readable when its owner (``LayerOwner.tile_scope``) is in ``owners`` or its
``tile_layer`` is in ``layers``. Browsers receive it as an ``HttpOnly`` cookie (scope
``tiles:read``) naming a single owner, set on that owner's tile paths only; backend->tiler
register calls use it as a ``Bearer`` token with scope ``searches:write``.
"""

import time
from urllib.parse import urlparse

import jwt
from fastapi import Response
from pydantic import BaseModel

from src.config import get_settings
from src.layers import LayerOwner

ALGORITHM = "HS256"
DEFAULT_TTL = 3600
TILER_TOKEN_TTL = 3600  # 1 hour
TILE_SESSION_COOKIE = "tile_session"


def mint(
    sub: str,
    owners: list,
    scope: list[str] | None = None,
    ttl: int = DEFAULT_TTL,
    layers: list[str] | None = None,
) -> str:
    """Create a signed tile-access token. Owner scopes are stringified to match the tiler."""
    payload = {
        "sub": str(sub),
        "exp": int(time.time()) + ttl,
        "scope": scope or ["tiles:read"],
        "owners": [str(o) for o in owners],
        "layers": list(layers or []),
    }
    return jwt.encode(payload, get_settings().TILER_TOKEN_SECRET, algorithm=ALGORITHM)


def verify(token: str) -> dict:
    """Decode and validate a tile-access token (signature + expiry).

    Raises ``jwt.InvalidTokenError`` (incl. ``ExpiredSignatureError``) on any failure.
    Used by the tile-proxy to authorize browser tile requests from the tile session cookie.
    """
    return jwt.decode(token, get_settings().TILER_TOKEN_SECRET, algorithms=[ALGORITHM])


class TileSessionOut(BaseModel):
    expires_in: int


def session_paths(owner: LayerOwner) -> list[str]:
    """Every path a scope's tiles are fetched under: its backend proxy routes and its
    prefix on each tiler.

    The cookie is set once per path so a tile request carries only the session for
    the scope it reads, whatever else the browser has open.
    """
    if owner.campaign_id is not None:
        api = f"/api/campaigns/{owner.campaign_id}/"
    else:
        api = f"/api/visualizers/{owner.visualizer_id}/"
    tiler_bases = {urlparse(t.url).path.rstrip("/") for t in get_settings().TILERS.values()}
    return [api, *(f"{base}/scopes/{owner.tile_scope}/" for base in sorted(tiler_bases))]


def set_tile_session(
    response: Response, *, sub: str, owner: LayerOwner, layers: list[str] | None = None
) -> TileSessionOut:
    """Attach the browser's ``tiles:read`` session for one owner and the single layers
    of others it may read.

    One owner per session keeps the cookie the same size however many campaigns
    exist. The subject is whatever the caller is granting access on behalf of - a
    user for the app, a visualizer for a shared link - and never reaches the client.
    """
    settings = get_settings()
    token = mint(sub, [owner.tile_scope], scope=["tiles:read"], ttl=TILER_TOKEN_TTL, layers=layers)
    for path in session_paths(owner):
        response.set_cookie(
            key=TILE_SESSION_COOKIE,
            value=token,
            max_age=TILER_TOKEN_TTL,
            httponly=True,
            secure=settings.TILER_COOKIE_SECURE,
            samesite=settings.TILER_COOKIE_SAMESITE,
            domain=settings.TILER_COOKIE_DOMAIN,
            path=path,
        )
    return TileSessionOut(expires_in=TILER_TOKEN_TTL)

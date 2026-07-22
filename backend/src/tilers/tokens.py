"""Mint short-lived HS256 tile-access tokens for the titiler-pgstac tilers.

Mirrors the tiler's own verification (its ``auth.py``): a JWT with
``{sub, exp, scope, campaigns}`` signed with the shared ``TILER_TOKEN_SECRET``. Browsers
receive it as an ``HttpOnly`` cookie (scope ``tiles:read`` + the user's campaigns);
backend->tiler register calls use it as a ``Bearer`` token with scope ``searches:write``.
"""

import time

import jwt

from src.config import get_settings

ALGORITHM = "HS256"
DEFAULT_TTL = 3600


def mint(
    sub: str,
    campaigns: list,
    scope: list[str] | None = None,
    ttl: int = DEFAULT_TTL,
) -> str:
    """Create a signed tile-access token. Campaign ids are stringified to match the tiler."""
    payload = {
        "sub": str(sub),
        "exp": int(time.time()) + ttl,
        "scope": scope or ["tiles:read"],
        "campaigns": [str(c) for c in campaigns],
    }
    return jwt.encode(payload, get_settings().TILER_TOKEN_SECRET, algorithm=ALGORITHM)


def verify(token: str) -> dict:
    """Decode and validate a tile-access token (signature + expiry).

    Raises ``jwt.InvalidTokenError`` (incl. ``ExpiredSignatureError``) on any failure.
    Used by the tile-proxy to authorize browser tile requests from the ``tiler_token`` cookie.
    """
    return jwt.decode(token, get_settings().TILER_TOKEN_SECRET, algorithms=[ALGORITHM])

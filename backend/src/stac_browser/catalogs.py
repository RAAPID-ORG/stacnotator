"""Catalog listing: curated catalogs, the StacIndex integration, and the SSRF guard
applied to user-supplied catalog URLs."""

import logging
import time
from collections import OrderedDict
from typing import Any

import httpx
from fastapi import HTTPException

from src import net_guard
from src.tilers import registry

logger = logging.getLogger(__name__)

STACINDEX_URL = "https://stacindex.org/api/catalogs"
STACINDEX_CACHE_TTL = 3600  # 1 hour

_AUTH_REQUIRED_CATALOGS = {"usgs-m2m", "maxar"}


def _curated_catalog(cat_id: str, title: str, url: str, summary: str, is_mpc: bool = False) -> dict:
    return {
        "id": cat_id,
        "title": title,
        "url": url,
        "summary": summary,
        "is_mpc": is_mpc,
        "auth_required": False,
        "tiler_name": None,
        "provided": True,
    }


# Hand-picked catalogs, shown in the featured section ahead of the StacIndex list.
# Static catalogs (no /search endpoint) never pass StacIndex's isApi filter, so
# adding them here is the only way they get listed.
CURATED_CATALOGS: list[dict] = [
    _curated_catalog(
        "mpc",
        "Microsoft Planetary Computer",
        registry.MPC_STAC_URL,
        "The Planetary Computer - petabytes of Earth observation data",
        is_mpc=True,
    ),
    _curated_catalog(
        "vantor-opendata",
        "Vantor OpenData",
        "https://vantor-opendata.s3.amazonaws.com/events/catalog.json",
        "Open high-resolution Vantor (formerly Maxar) imagery of disaster events",
    ),
]


_catalogs_cache: dict[str, Any] = {"data": None, "expires": 0}

# Per-catalog_url collections cache. MPC's /collections can time out for
# 20+ seconds - cache aggressively and serve stale on upstream failure so
# one bad upstream response doesn't block the user.
_COLLECTIONS_CACHE_MAX = 256
_collections_cache: OrderedDict[str, dict] = OrderedDict()
COLLECTIONS_CACHE_TTL = 86400  # 1 day


def _cache_set(key: str, value: dict) -> None:
    if key in _collections_cache:
        _collections_cache.move_to_end(key)
    _collections_cache[key] = value
    while len(_collections_cache) > _COLLECTIONS_CACHE_MAX:
        _collections_cache.popitem(last=False)


def _cache_get(key: str) -> dict | None:
    return _collections_cache.get(key)


def assert_catalog_url_safe(catalog_url: str) -> None:
    """Reject a catalog URL we must not fetch, with the reason as a 400.

    A courtesy check only, so the user gets a clear error on the entry URL rather
    than a 502 from deeper in. The guard that actually holds is on the connection
    (``net_guard``), which also covers redirects and the hrefs the catalog itself
    hands us. Public hosts are allowed - browsing arbitrary public STAC catalogs
    is the whole feature.
    """
    try:
        net_guard.assert_public_url(catalog_url)
    except net_guard.UnsafeUrlError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


def map_stacindex_catalog(cat: dict) -> dict | None:
    """Map one raw StacIndex catalog to our output shape, or None to skip it.

    Skips non-API catalogs and the Planetary Computer (added explicitly as MPC).
    Uses the stable string `slug` as the id: StacIndex's `id` is a numeric,
    unstable value, and `_AUTH_REQUIRED_CATALOGS` matches on the slug.
    """
    if not cat.get("isApi"):
        return None
    url = cat.get("url", "")
    if "planetarycomputer" in url:
        return None
    cat_id = cat.get("slug") or str(cat.get("id", ""))
    auth_required = cat_id in _AUTH_REQUIRED_CATALOGS
    return {
        "id": cat_id,
        "title": cat.get("title", ""),
        "url": url,
        "summary": cat.get("summary", ""),
        "is_mpc": False,
        "auth_required": auth_required,
        "tiler_name": None,
        "provided": False,
        "selectable": not auth_required,
        "unavailable_reason": "Requires authentication we don't have" if auth_required else None,
    }


async def public_catalogs() -> list[dict]:
    """Curated catalogs (MPC, Vantor) + StacIndex API catalogs (user-independent), cached."""
    now = time.time()
    cached: list[dict] | None = _catalogs_cache["data"]
    if cached and now < _catalogs_cache["expires"]:
        return cached

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(STACINDEX_URL)
            resp.raise_for_status()
            all_catalogs = resp.json()
    except Exception as e:
        logger.error("Failed to fetch StacIndex catalogs: %s", e)
        if cached:
            return cached
        raise HTTPException(status_code=502, detail="StacIndex unavailable") from e

    filtered = [*CURATED_CATALOGS]

    for cat in all_catalogs:
        mapped = map_stacindex_catalog(cat)
        if mapped is not None:
            filtered.append(mapped)

    _catalogs_cache["data"] = filtered
    _catalogs_cache["expires"] = now + STACINDEX_CACHE_TTL
    return filtered

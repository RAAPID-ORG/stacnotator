import contextlib
import ipaddress
import logging
import socket
import time
from collections import OrderedDict
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPBearer

from src.auth.dependencies import require_approved_user
from src.auth.models import User
from src.stac_browser.client import list_collections as _list_collections
from src.stac_browser.client import search_items
from src.stac_browser.schemas import (
    SearchRequest,
    SearchResponse,
    StacCatalogOut,
    StacCollectionOut,
)
from src.tilers import registry

logger = logging.getLogger(__name__)
bearer = HTTPBearer()
router = APIRouter(
    prefix="/stac",
    tags=["STAC Browser"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
)

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


_catalogs_cache: dict = {"data": None, "expires": 0}

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


_INTERNAL_IP_ERROR = "Catalog URL host is not permitted"


def _trusted_catalog_origins() -> frozenset[str]:
    """Origins always allowed regardless of resolved IP (trusted config)."""
    origins: set[str] = set()
    candidate_urls = [registry.MPC_STAC_URL]
    with contextlib.suppress(Exception):
        candidate_urls += [
            t.stac_url for t in registry.all_tilers() if getattr(t, "stac_url", None)
        ]
    for u in candidate_urls:
        p = urlparse(u)
        origins.add(f"{p.scheme}://{p.netloc}".rstrip("/"))
    return frozenset(origins)


def _is_internal_ip(ip_str: str) -> bool:
    addr = ipaddress.ip_address(ip_str)
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def _assert_catalog_url_safe(catalog_url: str) -> None:
    """Block SSRF: reject catalog URLs whose host resolves to an internal address.

    Public hosts are allowed (browsing arbitrary public STAC catalogs is a core
    feature). Trusted configured origins (MPC, configured tilers) are always allowed.
    """
    parsed = urlparse(catalog_url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Catalog URL must be http or https")
    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=400, detail="Catalog URL has no host")

    origin = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    if origin in _trusted_catalog_origins():
        return

    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise HTTPException(status_code=400, detail="Catalog host could not be resolved") from e

    for info in infos:
        if _is_internal_ip(info[4][0]):
            raise HTTPException(status_code=403, detail=_INTERNAL_IP_ERROR)


@router.get("/catalogs", response_model=list[StacCatalogOut])
async def list_catalogs(user: User = Depends(require_approved_user)):
    """Browsable catalogs: the user's platform tiler catalogs first, then public ones
    (MPC + StacIndex). Platform catalogs carry ``tiler_name`` so the wizard auto-targets
    the tiler; others route to the default tiler."""
    return [*_tiler_catalogs(user), *await _public_catalogs()]


def _tiler_catalogs(user: User) -> list[dict]:
    """Platform tiler catalogs the user may use. Excludes MPC (a public catalog below)."""
    out = []
    for tiler in registry.browsable_tilers():
        if tiler.kind == registry.MPC or not user.can_use_tiler(tiler.name):
            continue
        out.append(
            {
                "id": f"tiler-{tiler.name}",
                "title": tiler.title or tiler.name,
                "url": tiler.stac_url,
                "summary": tiler.title or f"Imagery served by the {tiler.name} tiler",
                "is_mpc": False,
                "auth_required": False,
                "tiler_name": tiler.name,
                "provided": True,
            }
        )
    return out


def _map_stacindex_catalog(cat: dict) -> dict | None:
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


async def _public_catalogs() -> list[dict]:
    """Curated catalogs (MPC, Vantor) + StacIndex API catalogs (user-independent), cached."""
    now = time.time()
    if _catalogs_cache["data"] and now < _catalogs_cache["expires"]:
        return _catalogs_cache["data"]

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(STACINDEX_URL)
            resp.raise_for_status()
            all_catalogs = resp.json()
    except Exception as e:
        logger.error("Failed to fetch StacIndex catalogs: %s", e)
        if _catalogs_cache["data"]:
            return _catalogs_cache["data"]
        raise HTTPException(status_code=502, detail="StacIndex unavailable") from e

    filtered = [*CURATED_CATALOGS]

    for cat in all_catalogs:
        mapped = _map_stacindex_catalog(cat)
        if mapped is not None:
            filtered.append(mapped)

    _catalogs_cache["data"] = filtered
    _catalogs_cache["expires"] = now + STACINDEX_CACHE_TTL
    return filtered


@router.get("/collections", response_model=list[StacCollectionOut])
def get_collections(catalog_url: str = Query(..., description="STAC API URL")):
    """List collections from a STAC API catalog, with a 1h cache.

    Serves stale data on upstream failure so a transient MPC timeout
    doesn't block the user.
    """
    _assert_catalog_url_safe(catalog_url)
    now = time.time()
    entry = _cache_get(catalog_url)
    if entry and now < entry["expires"]:
        age = now - (entry["expires"] - COLLECTIONS_CACHE_TTL)
        logger.info(
            "collections cache HIT catalog=%s count=%d age=%.1fs",
            catalog_url,
            len(entry["data"]),
            age,
        )
        return entry["data"]

    logger.info("collections cache MISS catalog=%s - fetching upstream", catalog_url)
    t0 = time.time()
    try:
        data = _list_collections(catalog_url)
    except Exception as e:
        elapsed = time.time() - t0
        logger.error(
            "collections fetch FAILED catalog=%s elapsed=%.2fs err=%s",
            catalog_url,
            elapsed,
            e,
        )
        if entry and entry.get("data"):
            logger.warning("Serving stale collections cache for %s", catalog_url)
            return entry["data"]
        raise HTTPException(status_code=502, detail="Failed to connect to catalog") from e

    elapsed = time.time() - t0
    logger.info(
        "collections fetch OK catalog=%s count=%d elapsed=%.2fs",
        catalog_url,
        len(data),
        elapsed,
    )
    _cache_set(catalog_url, {"data": data, "expires": now + COLLECTIONS_CACHE_TTL})
    return data


@router.post("/search", response_model=SearchResponse)
def search(request: SearchRequest):
    """Search STAC items in a catalog collection."""
    _assert_catalog_url_safe(request.catalog_url)
    try:
        items, next_offset = search_items(
            catalog_url=request.catalog_url,
            collection_id=request.collection_id,
            bbox=request.bbox,
            datetime_range=request.datetime_range,
            limit=request.limit,
            offset=request.offset,
        )
        return {"items": items, "count": len(items), "next_offset": next_offset}
    except Exception as e:
        logger.error("STAC search failed: %s", e)
        raise HTTPException(status_code=502, detail="Search failed") from e

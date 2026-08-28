"""Reads against Planet's Basemaps and Data APIs.

Basemaps are pre-built temporal mosaics rather than STAC items, so the temporal
structure the wizard needs comes from a *series* - a named cadence (monthly, quarterly)
whose mosaics are already ordered in time, served as XYZ tiles directly.

Scenes are individual acquisitions, addressable only once a set of them has been minted
into a tile layer. Deciding which scenes belong in one layer is ``scenes.py``.
"""

import logging
from collections.abc import Iterator
from typing import Any
from urllib.parse import quote, urlparse

import httpx

from src import net_guard
from src.planet import tiles

logger = logging.getLogger(__name__)

API_HOST = "api.planet.com"
API_ROOT = f"https://{API_HOST}/basemaps/v1"
DATA_ROOT = f"https://{API_HOST}/data/v1"
# Minting a scene layer is the one call that goes to the tile host rather than the API.
LAYERS_URL = f"https://{tiles.TILE_HOST}/data/v1/layers"
READ_TIMEOUT = 30.0
PAGE_SIZE = 500
# A series is a decade of mosaics at worst; anything beyond this is a paging loop.
MAX_PAGES = 20

_http = net_guard.guarded_client(
    timeout=READ_TIMEOUT, follow_redirects=True, headers={"Accept": "application/json"}
)


class PlanetError(RuntimeError):
    """Planet refused or could not answer the request."""


def _require_host(url: str, host: str) -> None:
    if urlparse(url).hostname != host:
        raise PlanetError(f"refusing to send Planet credentials to {url}")


def _checked(response: httpx.Response) -> dict[str, Any]:
    if response.status_code in (401, 403):
        raise PlanetError("Planet rejected the API key")
    if response.status_code >= 400:
        raise PlanetError(f"Planet returned {response.status_code}")
    body: dict[str, Any] = response.json()
    return body


def _get(url: str, api_key: str) -> dict[str, Any]:
    """Fetch one page. The key travels as basic-auth credentials, so it never
    lands in a query string we might log."""
    _require_host(url, API_HOST)
    return _checked(_http.get(url, auth=(api_key, "")))


def _paged(url: str, api_key: str, field: str) -> Iterator[dict[str, Any]]:
    """Walk Planet's ``_links._next`` chain, which is how both listings page."""
    next_url: str | None = url
    for _ in range(MAX_PAGES):
        if not next_url:
            return
        body = _get(next_url, api_key)
        yield from body.get(field, [])
        next_url = body.get("_links", {}).get("_next")
    logger.warning("Planet listing stopped at the %d page cap: %s", MAX_PAGES, url)


def list_series(api_key: str) -> list[dict[str, Any]]:
    """Every series the key can see, newest content first as Planet orders them."""
    return list(_paged(f"{API_ROOT}/series?_page_size={PAGE_SIZE}", api_key, "series"))


def list_mosaics(series_id: str, api_key: str) -> list[dict[str, Any]]:
    """A series' mosaics in acquisition order."""
    path = f"{API_ROOT}/series/{quote(series_id, safe='')}/mosaics"
    mosaics = list(_paged(f"{path}?_page_size={PAGE_SIZE}", api_key, "mosaics"))
    return sorted(mosaics, key=lambda m: m.get("first_acquired") or "")


def _scene_filters(
    geometry: dict[str, Any],
    start: str,
    end: str,
    max_cloud_cover: float,
    quality_categories: list[str],
) -> list[dict[str, Any]]:
    """The cloud filter is omitted at 100 rather than sent as a no-op: a strict range
    filter also excludes items that carry no cloud metadata at all, which is how a
    permissive setting can silently return nothing."""
    filters: list[dict[str, Any]] = [
        {
            "type": "DateRangeFilter",
            "field_name": "acquired",
            "config": {"gte": f"{start}T00:00:00.000Z", "lte": f"{end}T23:59:59.999Z"},
        },
        {"type": "GeometryFilter", "field_name": "geometry", "config": geometry},
    ]
    if quality_categories:
        filters.append(
            {
                "type": "StringInFilter",
                "field_name": "quality_category",
                "config": quality_categories,
            }
        )
    if max_cloud_cover < 100:
        filters.append(
            {
                "type": "RangeFilter",
                "field_name": "cloud_cover",
                "config": {"lte": max_cloud_cover / 100},
            }
        )
    return filters


def search_scenes(
    api_key: str,
    *,
    geometry: dict[str, Any],
    start: str,
    end: str,
    item_types: list[str],
    max_cloud_cover: float = 100,
    quality_categories: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Every scene intersecting ``geometry`` in the date range.

    Planet cannot sort a search, so ranking happens on the whole result set in
    ``scenes.py`` and the caller has to bound the date range: a wide one is paid for
    in pages here.
    """
    request = {
        "item_types": item_types,
        "filter": {
            "type": "AndFilter",
            "config": _scene_filters(
                geometry, start, end, max_cloud_cover, quality_categories or []
            ),
        },
    }
    body = _checked(_http.post(f"{DATA_ROOT}/quick-search", auth=(api_key, ""), json=request))

    features = list(body.get("features", []))
    next_url = body.get("_links", {}).get("_next")
    for _ in range(MAX_PAGES - 1):
        if not next_url:
            return features
        page = _get(next_url, api_key)
        features.extend(page.get("features", []))
        next_url = page.get("_links", {}).get("_next")
    logger.warning("Planet scene search stopped at the %d page cap", MAX_PAGES)
    return features


def create_layer(api_key: str, scene_ids: list[str]) -> str:
    """Mint one tile layer from a set of scenes and return its id.

    Planet also returns a ready-made tile URL, ignored because the one we store has to
    be keyless - see ``tiles.layer_template``.
    """
    if not scene_ids:
        raise PlanetError("refusing to mint an empty scene layer")
    body = _checked(_http.post(LAYERS_URL, auth=(api_key, ""), data={"ids": ",".join(scene_ids)}))
    name = body.get("name")
    if not name:
        raise PlanetError("Planet returned a layer without an id")
    return str(name)

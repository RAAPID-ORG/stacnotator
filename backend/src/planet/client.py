"""Reads against Planet's Basemaps API.

Planet basemaps are pre-built temporal mosaics rather than STAC items, so the temporal
structure the wizard needs comes from a *series* - a named cadence (monthly, quarterly)
whose mosaics are already ordered in time. Nothing here registers or renders anything:
the mosaics are served as XYZ tiles directly.
"""

import logging
from collections.abc import Iterator
from typing import Any
from urllib.parse import quote, urlparse

from src import net_guard

logger = logging.getLogger(__name__)

API_HOST = "api.planet.com"
API_ROOT = f"https://{API_HOST}/basemaps/v1"
READ_TIMEOUT = 30.0
PAGE_SIZE = 500
# A series is a decade of mosaics at worst; anything beyond this is a paging loop.
MAX_PAGES = 20

_http = net_guard.guarded_client(
    timeout=READ_TIMEOUT, follow_redirects=True, headers={"Accept": "application/json"}
)


class PlanetError(RuntimeError):
    """Planet refused or could not answer the request."""


def _get(url: str, api_key: str) -> dict[str, Any]:
    """Fetch one page. The key travels as basic-auth credentials, so it never
    lands in a query string we might log."""
    if urlparse(url).hostname != API_HOST:
        raise PlanetError(f"refusing to send Planet credentials to {url}")
    response = _http.get(url, auth=(api_key, ""))
    if response.status_code in (401, 403):
        raise PlanetError("Planet rejected the API key")
    if response.status_code >= 400:
        raise PlanetError(f"Planet returned {response.status_code}")
    body: dict[str, Any] = response.json()
    return body


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

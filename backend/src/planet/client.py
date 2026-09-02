"""Reads against Planet's Basemaps and Data APIs.

Basemaps are pre-built temporal mosaics rather than STAC items, so the temporal
structure the wizard needs comes from a *series* - a named cadence (monthly, quarterly)
whose mosaics are already ordered in time, served as XYZ tiles directly.

Scenes are individual acquisitions, addressable only once a set of them has been minted
into a tile layer. Deciding which scenes belong in one layer is ``scenes.py``.
"""

import logging
import threading
import time
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any
from urllib.parse import quote, urlparse

import httpx

from src import net_guard
from src.planet import scenes, tiles
from src.planet.schemas import PlanetScenesGenerationConfigV1

logger = logging.getLogger(__name__)

API_HOST = "api.planet.com"
API_ROOT = f"https://{API_HOST}/basemaps/v1"
DATA_ROOT = f"https://{API_HOST}/data/v1"
# Minting a scene layer is the one call that goes to the tile host rather than the API.
LAYERS_URL = f"https://{tiles.TILE_HOST}/data/v1/layers"
READ_TIMEOUT = 30.0
# Asked for explicitly so a listing is not walked 250 rows at a time. The Basemaps API
# takes this; the Data API caps its pages lower, hence the separate size below.
PAGE_SIZE = 500
# Planet's documented maximum for a Data API search page. Asking for more is a 400,
# not a clamp, so this is also what the reachable-scenes cap is counted in.
SEARCH_PAGE_SIZE = 250
# A series is a decade of mosaics at worst; anything beyond this is a paging loop.
MAX_PAGES = 20
# How much of a range one scene search covers before it is split. A viewport-sized box
# over four months is a page or two of scenes, so a year costs a handful of searches
# rather than one per slice - and a chunk that turns out denser splits itself.
SEARCH_CHUNK_DAYS = 120
# Bisecting stops here: a single day that still overflows is a genuine refusal, not
# something a narrower range can fix.
MIN_CHUNK_DAYS = 1
# Backstop on one view's searches, splits included, so a dense archive under a wide
# view cannot bisect its way into thousands of requests.
MAX_SEARCHES = 64
SEARCH_WORKERS = 8
TOO_MANY_REQUESTS = 429
# Planet rate-limits per key across the whole Data API, and a view's searches are a
# burst against a key the whole organization shares.
REQUESTS_PER_SECOND = 5.0
# Minting layers is a different service on a different host, so it has its own budget
# rather than competing with the searches for one. Adaptive either way: what a key is
# allowed is found, not assumed.
MINT_REQUESTS_PER_SECOND = 10.0
# Where pacing lands if Planet keeps refusing: one request a second.
MIN_REQUESTS_PER_SECOND = 1.0
RETRY_ATTEMPTS = 4
MAX_RETRY_WAIT = 10.0

_http = net_guard.guarded_client(
    timeout=READ_TIMEOUT, follow_redirects=True, headers={"Accept": "application/json"}
)


class PlanetError(RuntimeError):
    """Planet refused or could not answer the request."""


class PlanetTooManyResults(PlanetError):
    """More scenes than one search can page through, so the range has to be split."""


class _Pacer:
    """Hands out request slots no closer together than one interval, across threads.

    The interval widens when Planet refuses and narrows again as requests get through.
    What a key is actually allowed is neither documented nor constant - it is shared
    with everything else spending it - so the rate is found rather than assumed.
    """

    def __init__(self, per_second: float) -> None:
        self._base = 1.0 / per_second
        self._slowest = 1.0 / MIN_REQUESTS_PER_SECOND
        self._interval = self._base
        self._lock = threading.Lock()
        self._free_at = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            start = max(now, self._free_at)
            self._free_at = start + self._interval
        if start > now:
            time.sleep(start - now)

    def refused(self) -> None:
        with self._lock:
            self._interval = min(self._interval * 2, self._slowest)

    def allowed(self) -> None:
        with self._lock:
            self._interval = max(self._interval * 0.9, self._base)


_pacers = {
    API_HOST: _Pacer(REQUESTS_PER_SECOND),
    tiles.TILE_HOST: _Pacer(MINT_REQUESTS_PER_SECOND),
}


def _pacer_for(url: str) -> _Pacer:
    return _pacers.get(urlparse(url).hostname or "", _pacers[API_HOST])


def _retry_wait(response: httpx.Response, attempt: int) -> float:
    """A widening backoff, or Planet's own Retry-After where it asks for longer.

    Planet answers 429 with ``Retry-After: 0``, so taking the header at face value is
    a retry storm dressed up as backoff - it is a floor for how long to wait, never a
    licence to go straight back.
    """
    backoff = min(2.0**attempt, MAX_RETRY_WAIT)
    header = response.headers.get("Retry-After", "")
    try:
        return min(max(float(header), backoff), MAX_RETRY_WAIT)
    except ValueError:
        return backoff


def _send(url: str, request: Callable[[], httpx.Response]) -> dict[str, Any]:
    """One paced request, retried while Planet is only asking us to slow down.

    Paced per host: the Data API and the tile host are separate services with separate
    limits, and one of them being slowed down is no reason to slow the other.
    """
    pacer = _pacer_for(url)
    for attempt in range(RETRY_ATTEMPTS):
        pacer.wait()
        response = request()
        if response.status_code != TOO_MANY_REQUESTS:
            pacer.allowed()
            return _checked(response)
        pacer.refused()
        if attempt < RETRY_ATTEMPTS - 1:
            wait = _retry_wait(response, attempt)
            logger.warning("Planet rate limited us, waiting %.1fs (attempt %d)", wait, attempt + 1)
            time.sleep(wait)
    raise PlanetError(
        "Planet is rate limiting this API key. Wait a moment and search again, or "
        "shorten the date range so fewer searches are needed."
    )


def _require_host(url: str, host: str) -> None:
    if urlparse(url).hostname != host:
        raise PlanetError(f"refusing to send Planet credentials to {url}")


def _complaint(response: httpx.Response) -> str:
    """What Planet said was wrong, if it said anything.

    A bare status is not a diagnosis: 400 covers a geometry it cannot parse, a filter
    it does not know and a page size past its maximum, and only Planet knows which.
    Its errors come back as ``{"general": [{"message": ...}], "field": {...}}``.
    """
    try:
        body = response.json()
    except ValueError:
        return ""
    messages = [str(item.get("message", "")) for item in body.get("general", [])]
    for problems in (body.get("field") or {}).values():
        messages += [str(item.get("message", "")) for item in problems]
    return "; ".join(m for m in messages if m)[:200]


def _checked(response: httpx.Response) -> dict[str, Any]:
    if response.status_code in (401, 403):
        raise PlanetError("Planet rejected the API key")
    if response.status_code >= 400:
        said = _complaint(response)
        raise PlanetError(
            f"Planet returned {response.status_code}: {said}"
            if said
            else f"Planet returned {response.status_code}"
        )
    body: dict[str, Any] = response.json()
    return body


def _get(url: str, api_key: str) -> dict[str, Any]:
    """Fetch one page. The key travels as basic-auth credentials, so it never
    lands in a query string we might log."""
    _require_host(url, API_HOST)
    return _send(url, lambda: _http.get(url, auth=(api_key, "")))


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

    Bound the range narrowly - see ``search_config``. Planet returns results in an
    order we cannot control, so running out of pages here does not mean "the rest is
    less interesting", it means an arbitrary end of the range is missing. That is why
    the cap raises rather than returning what it has.
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
    body = _send(
        DATA_ROOT,
        lambda: _http.post(
            f"{DATA_ROOT}/quick-search",
            auth=(api_key, ""),
            params={"_page_size": SEARCH_PAGE_SIZE},
            json=request,
        ),
    )

    features = list(body.get("features", []))
    next_url = body.get("_links", {}).get("_next")
    for _ in range(MAX_PAGES - 1):
        if not next_url:
            return features
        page = _get(next_url, api_key)
        features.extend(page.get("features", []))
        next_url = page.get("_links", {}).get("_next")
    raise PlanetTooManyResults(
        f"Planet has more than {MAX_PAGES * SEARCH_PAGE_SIZE} scenes over this area for "
        f"{start} to {end}. Narrow the area, or search a shorter range."
    )


class _Budget:
    """How many searches one view may still spend, shared across the threads."""

    def __init__(self, total: int) -> None:
        self._left = total
        self._lock = threading.Lock()

    def spend(self) -> None:
        with self._lock:
            if self._left <= 0:
                raise PlanetError(
                    "This view holds more Planet archive than one search can work "
                    "through. Zoom in, or shorten the source's date range."
                )
            self._left -= 1


def search_range(
    api_key: str,
    config: PlanetScenesGenerationConfigV1,
    geometry: dict[str, Any],
    start: date,
    end: date,
) -> list[dict[str, Any]]:
    """Every scene ``start``..``end`` holds over ``geometry``, in as few searches as
    the archive allows.

    The range is cut into chunks wide enough that a viewport-sized search answers in a
    page or two, and a chunk that turns out to hold more than its pages can carry is
    halved until it fits. Splitting on the answer rather than on the slice period is
    what keeps a year of two-day slices at a handful of searches instead of 183, and
    still cannot silently lose an end of the range: a truncated search raises.
    """
    budget = _Budget(MAX_SEARCHES)
    chunks = scenes.periods(start, end, SEARCH_CHUNK_DAYS, "days")

    def one(period: "scenes.Period") -> list[dict[str, Any]]:
        budget.spend()
        try:
            return search_scenes(
                api_key,
                geometry=geometry,
                start=period.start.isoformat(),
                end=period.end.isoformat(),
                item_types=config.item_types,
                max_cloud_cover=config.max_cloud_cover,
                quality_categories=config.quality_categories,
            )
        except PlanetTooManyResults:
            span = (period.end - period.start).days
            if span < MIN_CHUNK_DAYS * 2:
                raise
            middle = period.start + timedelta(days=span // 2)
            halves = [
                scenes.Period(period.start, middle),
                scenes.Period(middle + timedelta(days=1), period.end),
            ]
            return [feature for half in halves for feature in one(half)]

    with ThreadPoolExecutor(max_workers=SEARCH_WORKERS) as pool:
        return [feature for page in pool.map(one, chunks) for feature in page]


def search_config(
    api_key: str, config: PlanetScenesGenerationConfigV1, geometry: dict[str, Any]
) -> list[dict[str, Any]]:
    """Every scene the config's slices can draw on over ``geometry``.

    The config settles the dates and the filters; where to look is the caller's, since
    it is wherever the annotator is standing rather than anything set up in advance.
    """
    return search_range(
        api_key,
        config,
        geometry,
        date.fromisoformat(config.start_date),
        date.fromisoformat(config.end_date),
    )


def create_layer(api_key: str, scene_ids: list[str]) -> str:
    """Mint one tile layer from a set of scenes and return its id.

    Planet also returns a ready-made tile URL, ignored because the one we store has to
    be keyless - see ``tiles.layer_template``.
    """
    if not scene_ids:
        raise PlanetError("refusing to mint an empty scene layer")
    body = _send(
        LAYERS_URL,
        lambda: _http.post(LAYERS_URL, auth=(api_key, ""), data={"ids": ",".join(scene_ids)}),
    )
    name = body.get("name")
    if not name:
        raise PlanetError("Planet returned a layer without an id")
    return str(name)

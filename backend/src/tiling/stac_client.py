"""pystac_client wrapper with MPC signing support."""

import concurrent.futures
import logging
import time
from datetime import UTC, datetime
from urllib.parse import urlparse

import httpx
import planetary_computer as pc
import pystac
import pystac_client
from pystac_client import CollectionClient

logger = logging.getLogger(__name__)

# Collections whose items carry eo:cloud_cover even though the collection metadata
# doesn't declare the EO extension (mostly MPC), so the wizard can still offer a
# cloud-cover filter.
_KNOWN_CLOUD_COVER_COLLECTIONS = {
    "sentinel-2-l2a",
    "sentinel-2-l1c",
    "landsat-c2-l2",
    "landsat-c2-l1",
    "landsat-8-c2-l2",
    "landsat-9-c2-l2",
    "hls2-s30",
    "hls2-l30",
    "modis-09A1-061",
    "modis-09Q1-061",
    "modis-13Q1-061",
}


def _is_mpc(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host == "planetarycomputer.microsoft.com" or host.endswith(
        ".planetarycomputer.microsoft.com"
    )


def get_client(catalog_url: str, sign: bool = True) -> pystac_client.Client:
    """Get a pystac Client for the given catalog URL.

    For MPC, applies the planetary_computer modifier so that
    returned items have signed asset URLs. Pass ``sign=False`` when you
    only need catalog metadata (e.g. listing collections) - the signer
    eagerly hits MPC's SAS token endpoint per collection and a single
    broken collection (e.g. nex-gddp-cmip6) 404s the whole listing.
    """
    kwargs = {}
    if sign and _is_mpc(catalog_url):
        kwargs["modifier"] = pc.sign_inplace
    return pystac_client.Client.open(catalog_url, **kwargs)


def _asset_defs_from_item(item: pystac.Item) -> dict:
    """Build wizard `item_assets` entries from a real item's assets. Used when a
    collection doesn't declare `item_assets` (common for static catalogs), so the
    mosaic wizard still has assets/bands to configure a visualization from."""
    result: dict = {}
    for key, asset in item.assets.items():
        eo_bands = (asset.extra_fields or {}).get("eo:bands") or []
        result[key] = {
            "title": asset.title or key,
            "type": asset.media_type or "",
            "roles": asset.roles or [],
            "bands": [
                {"name": b.get("name", f"b{i + 1}"), "description": b.get("description")}
                for i, b in enumerate(eo_bands)
            ],
        }
    return result


def _sample_item_assets(col) -> dict:
    """Fetch a single item from a collection and derive its assets. Empty on failure.
    One extra request, only taken when the collection declares no `item_assets`."""
    try:
        item = next(iter(col.get_items()), None)
    except Exception:
        logger.debug("could not sample an item from collection %s", getattr(col, "id", "?"))
        return {}
    return _asset_defs_from_item(item) if item is not None else {}


def _raw_collections(client: pystac_client.Client) -> list[dict]:
    """Fetch the raw /collections payload (all pages) as plain dicts.

    We can't use client.get_collections() here: it's a generator that raises on the
    first collection with malformed STAC metadata, aborting the whole catalog. Reading
    the raw list lets us parse each collection independently and isolate the bad ones.
    """
    link = client.get_single_link("data") or client.get_single_link("collections")
    if link is None:
        raise ValueError("catalog exposes no 'data' link to list collections")
    stac_io = client._stac_io
    if stac_io is None:
        raise ValueError("catalog client has no IO to read collections")

    out: list[dict] = []
    href: str | None = link.href
    seen: set[str] = set()
    while href and href not in seen:
        seen.add(href)
        payload = stac_io.read_json(href)
        out.extend(payload.get("collections", []))
        href = next(
            (link_.get("href") for link_ in payload.get("links", []) if link_.get("rel") == "next"),
            None,
        )
    return out


def _collection_out(col: pystac.Collection) -> dict:
    """Map a parsed collection to the wizard's shape."""
    extent = col.extent
    temporal = None
    if extent and extent.temporal and extent.temporal.intervals:
        interval = extent.temporal.intervals[0]
        temporal = {
            "start": interval[0].isoformat() if interval[0] else None,
            "end": interval[1].isoformat() if interval[1] else None,
        }
    spatial = None
    if extent and extent.spatial and extent.spatial.bboxes:
        spatial = extent.spatial.bboxes[0]

    item_assets = {}
    raw_item_assets = (col.extra_fields or {}).get("item_assets", {})
    for key, asset_def in raw_item_assets.items():
        # eo:bands lets the wizard offer per-band selection for a single multiband
        # asset (e.g. an 8-band COG served as one "data" asset). Order = band index.
        eo_bands = asset_def.get("eo:bands") or []
        item_assets[key] = {
            "title": asset_def.get("title", key),
            "type": asset_def.get("type", ""),
            "roles": asset_def.get("roles", []),
            "bands": [
                {"name": b.get("name", f"b{i + 1}"), "description": b.get("description")}
                for i, b in enumerate(eo_bands)
            ],
        }

    # Static catalogs often omit collection-level item_assets; sample one item so
    # the mosaic wizard still has assets to configure a visualization from.
    if not item_assets:
        item_assets = _sample_item_assets(col)

    summaries = (col.extra_fields or {}).get("summaries", {})
    extensions = (col.extra_fields or {}).get("stac_extensions", [])
    has_cloud_cover = (
        "eo:cloud_cover" in summaries
        or any("eo" in ext.split("/")[-1].lower() for ext in extensions)
        or col.id in _KNOWN_CLOUD_COVER_COLLECTIONS
    )

    return {
        "id": col.id,
        "title": col.title or col.id,
        "description": col.description or "",
        "temporal_extent": temporal,
        "spatial_extent": spatial,
        "keywords": getattr(col, "keywords", []) or [],
        "item_assets": item_assets,
        "has_cloud_cover": has_cloud_cover,
        "selectable": True,
        "unavailable_reason": None,
    }


def _unavailable_collection(raw: dict, err: Exception) -> dict:
    """A collection we couldn't parse. Surfaced (never hidden) but not selectable, with
    a reason, so the user still sees it exists and understands why it's unusable."""
    reason = (
        "Missing the required 'stac_version' field in its STAC metadata"
        if "stac_version" not in raw
        else "Its STAC metadata is invalid and could not be parsed"
    )
    logger.warning("collection %s unusable: %s (%s)", raw.get("id"), reason, err)
    return {
        "id": raw.get("id", "unknown"),
        "title": raw.get("title") or raw.get("id", "unknown"),
        "description": raw.get("description", "") or "",
        "temporal_extent": None,
        "spatial_extent": None,
        "keywords": raw.get("keywords", []) or [],
        "item_assets": {},
        "has_cloud_cover": False,
        "selectable": False,
        "unavailable_reason": reason,
    }


def list_collections(catalog_url: str) -> list[dict]:
    """List collections from a STAC API catalog.

    Each collection is parsed independently: one with malformed STAC metadata is
    returned as an unselectable entry (with a reason) rather than aborting the whole
    listing. Collections are never silently dropped.
    """
    t0 = time.time()
    client = get_client(catalog_url, sign=False)
    raw_cols = _raw_collections(client)

    results = []
    for raw in raw_cols:
        try:
            col = CollectionClient.from_dict(raw, root=client)
        except Exception as e:
            results.append(_unavailable_collection(raw, e))
            continue
        results.append(_collection_out(col))

    unusable = sum(1 for r in results if not r["selectable"])
    logger.info(
        "list_collections: %d collections (%d unusable) in %.2fs",
        len(results),
        unusable,
        time.time() - t0,
    )
    return results


# When falling back to walking a static catalog, cap how many items we visit so a
# huge catalog with a restrictive bbox can't crawl forever looking for `limit` hits.
STATIC_SCAN_CAP = 2000


def _simplify_item(item) -> dict:
    """Reduce a pystac Item to the wizard's result shape."""
    thumbnail = None
    fallback = None
    for thumb_key in ("rendered_preview", "thumbnail", "preview"):
        if thumb_key not in item.assets:
            continue
        asset = item.assets[thumb_key]
        media = (asset.media_type or "").lower()
        if "png" in media or "jpeg" in media or "jpg" in media:
            thumbnail = asset.href
            break
        if fallback is None:
            fallback = asset.href
    if not thumbnail:
        thumbnail = fallback

    assets_info = {}
    for key, asset in item.assets.items():
        assets_info[key] = {
            "title": asset.title or key,
            "type": asset.media_type or "",
            "roles": asset.roles or [],
        }

    return {
        "id": item.id,
        "datetime": item.datetime.isoformat() if item.datetime else None,
        "bbox": list(item.bbox) if item.bbox else None,
        "geometry": item.geometry,
        "properties": dict(item.properties),
        "assets": assets_info,
        "thumbnail": thumbnail,
        "self_href": item.get_self_href(),
    }


def _to_utc(dt: datetime | None) -> datetime | None:
    """Coerce a datetime to timezone-aware UTC so comparisons never mix naive/aware."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _parse_dt(value: str) -> datetime | None:
    value = value.strip()
    if not value or value == "..":
        return None
    try:
        return _to_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except ValueError:
        return None


def parse_datetime_range(datetime_range: str | None) -> tuple[datetime | None, datetime | None]:
    """Parse a STAC datetime parameter into (start, end); either may be None (open)."""
    if not datetime_range:
        return (None, None)
    parts = datetime_range.split("/")
    if len(parts) == 1:
        return (_parse_dt(parts[0]), None)
    return (_parse_dt(parts[0]), _parse_dt(parts[1]))


def bbox_intersects(item_bbox: list[float] | None, query_bbox: list[float] | None) -> bool:
    """2D bbox intersection test. Missing boxes never exclude an item."""
    if not query_bbox or not item_bbox:
        return True

    def _2d(b: list[float]) -> list[float]:
        return [b[0], b[1], b[3], b[4]] if len(b) == 6 else [b[0], b[1], b[2], b[3]]

    a, q = _2d(item_bbox), _2d(query_bbox)
    return not (a[2] < q[0] or a[0] > q[2] or a[3] < q[1] or a[1] > q[3])


def datetime_in_range(
    item_dt: datetime | None, start: datetime | None, end: datetime | None
) -> bool:
    """Whether an item's datetime falls within [start, end]. Undated items are kept."""
    if item_dt is None:
        return True
    item_dt = _to_utc(item_dt)
    if start and item_dt < start:
        return False
    return not (end and item_dt > end)


def _conforms_to_item_search(client: pystac_client.Client) -> bool:
    try:
        return client.conforms_to(pystac_client.ConformanceClasses.ITEM_SEARCH)
    except Exception:
        return False


def _search_via_api(
    client: pystac_client.Client,
    collection_id: str,
    bbox: list[float] | None,
    datetime_range: str | None,
    limit: int,
) -> list[dict]:
    search_kwargs: dict = {"collections": [collection_id], "max_items": limit}
    if bbox:
        search_kwargs["bbox"] = bbox
    if datetime_range:
        search_kwargs["datetime"] = datetime_range
    return [_simplify_item(item) for item in client.search(**search_kwargs).items()]


MAX_STATIC_FETCH_WORKERS = 32


def _fetch_item(http: httpx.Client, href: str) -> pystac.Item | None:
    """Fetch and parse a single static-catalog item file. None on any failure."""
    try:
        resp = http.get(href)
        resp.raise_for_status()
        return pystac.Item.from_dict(resp.json())
    except Exception:
        logger.debug("failed to fetch static item %s", href, exc_info=True)
        return None


def _walk_items_sequential(
    collection: pystac.Collection,
    collection_id: str,
    start: datetime | None,
    end: datetime | None,
    bbox: list[float] | None,
    limit: int,
) -> list[dict]:
    """Fallback for nested catalogs (items reached via child subcatalogs): let pystac
    crawl recursively. Sequential, so only used when there are no direct item links."""
    results: list[dict] = []
    scanned = 0
    for item in collection.get_items(recursive=True):
        scanned += 1
        if scanned > STATIC_SCAN_CAP:
            logger.warning(
                "search_items: hit static scan cap (%d) for collection %s; results may be partial",
                STATIC_SCAN_CAP,
                collection_id,
            )
            break
        if not bbox_intersects(item.bbox, bbox):
            continue
        if not datetime_in_range(item.datetime, start, end):
            continue
        results.append(_simplify_item(item))
        if len(results) >= limit:
            break
    return results


# Per-request ceiling on item files fetched during a static crawl. When a filter is
# sparse we return a cursor after this many rather than scanning the whole catalog, so
# each page stays responsive and the caller pages on with "load more".
STATIC_PAGE_FETCH_BUDGET = 96


def _search_via_walk(
    client: pystac_client.Client,
    collection_id: str,
    bbox: list[float] | None,
    datetime_range: str | None,
    limit: int,
    offset: int,
) -> tuple[list[dict], int | None]:
    """Static-catalog fallback: no /search endpoint, so read the collection's item
    links and crawl them a page at a time from `offset`, fetching each page's item
    files in parallel and filtering by bbox/datetime client-side (what a catalog
    browser does). Returns (items, next_offset); next_offset is the link index to
    resume from, or None when the collection is exhausted. Collections that nest
    items under child subcatalogs fall back to a (non-paged) pystac crawl.
    """
    collection = client.get_collection(collection_id)
    if collection is None:
        return [], None

    start, end = parse_datetime_range(datetime_range)
    item_hrefs = [
        href for link in collection.get_links(rel="item") if (href := link.get_absolute_href())
    ]
    if not item_hrefs:
        # Items are nested under subcatalogs (or none) - crawl recursively via pystac.
        return _walk_items_sequential(collection, collection_id, start, end, bbox, limit), None

    total = len(item_hrefs)
    results: list[dict] = []
    idx = max(offset, 0)
    fetched = 0
    limits = httpx.Limits(
        max_connections=MAX_STATIC_FETCH_WORKERS, max_keepalive_connections=MAX_STATIC_FETCH_WORKERS
    )
    # One pooled client reused across the whole crawl (connection + TLS reuse).
    with (
        httpx.Client(timeout=15, follow_redirects=True, limits=limits) as http,
        concurrent.futures.ThreadPoolExecutor(max_workers=MAX_STATIC_FETCH_WORKERS) as pool,
    ):
        while idx < total and len(results) < limit and fetched < STATIC_PAGE_FETCH_BUDGET:
            window = item_hrefs[idx : idx + MAX_STATIC_FETCH_WORKERS]
            page = list(pool.map(lambda href: _fetch_item(http, href), window))
            consumed = 0
            for item in page:  # preserve the collection's item order
                consumed += 1
                if item is None:
                    continue
                if not bbox_intersects(item.bbox, bbox):
                    continue
                if not datetime_in_range(item.datetime, start, end):
                    continue
                results.append(_simplify_item(item))
                if len(results) >= limit:
                    break
            idx += consumed
            fetched += consumed

    next_offset = idx if idx < total else None
    return results, next_offset


def search_items(
    catalog_url: str,
    collection_id: str,
    bbox: list[float] | None = None,
    datetime_range: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int | None]:
    """Search STAC items and return (items, next_offset).

    STAC API catalogs (advertising ITEM_SEARCH) use the /search endpoint and are never
    paged (next_offset is None). Static catalogs (e.g. an S3-hosted catalog.json with no
    search endpoint) crawl the collection's item links a page at a time and return a
    cursor so the caller can load more.
    """
    client = get_client(catalog_url)
    if _conforms_to_item_search(client):
        return _search_via_api(client, collection_id, bbox, datetime_range, limit), None
    return _search_via_walk(client, collection_id, bbox, datetime_range, limit, offset)

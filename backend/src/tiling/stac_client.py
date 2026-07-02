"""pystac_client wrapper with MPC signing support."""

import logging
import time
from datetime import UTC, datetime
from urllib.parse import urlparse

import planetary_computer as pc
import pystac_client

logger = logging.getLogger(__name__)


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


def list_collections(catalog_url: str) -> list[dict]:
    """List collections from a STAC API catalog."""
    t_open = time.time()
    client = get_client(catalog_url, sign=False)
    logger.info("list_collections: Client.open took %.2fs", time.time() - t_open)

    t_fetch = time.time()
    cols = list(client.get_collections())
    logger.info(
        "list_collections: get_collections() fetched %d cols in %.2fs",
        len(cols),
        time.time() - t_fetch,
    )

    t_parse = time.time()
    results = []
    for col in cols:
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

        # Detect eo:cloud_cover support:
        # 1. Check summaries (some catalogs declare it explicitly)
        # 2. Check stac_extensions for the EO extension
        # 3. Known MPC collections that have eo:cloud_cover on their items
        summaries = (col.extra_fields or {}).get("summaries", {})
        extensions = (col.extra_fields or {}).get("stac_extensions", [])

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

        has_cloud_cover = (
            "eo:cloud_cover" in summaries
            or any("eo" in ext.split("/")[-1].lower() for ext in extensions)
            or col.id in _KNOWN_CLOUD_COVER_COLLECTIONS
        )

        results.append(
            {
                "id": col.id,
                "title": col.title or col.id,
                "description": col.description or "",
                "temporal_extent": temporal,
                "spatial_extent": spatial,
                "keywords": getattr(col, "keywords", []) or [],
                "item_assets": item_assets,
                "has_cloud_cover": has_cloud_cover,
            }
        )
    logger.info("list_collections: parsed %d cols in %.2fs", len(results), time.time() - t_parse)
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


def _search_via_walk(
    client: pystac_client.Client,
    collection_id: str,
    bbox: list[float] | None,
    datetime_range: str | None,
    limit: int,
) -> list[dict]:
    """Static-catalog fallback: walk the collection's item links (no /search endpoint),
    filtering by bbox/datetime client-side, the way a catalog browser crawls."""
    collection = client.get_collection(collection_id)
    if collection is None:
        return []

    start, end = parse_datetime_range(datetime_range)
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


def search_items(
    catalog_url: str,
    collection_id: str,
    bbox: list[float] | None = None,
    datetime_range: str | None = None,
    limit: int = 50,
) -> list[dict]:
    """Search STAC items and return simplified results.

    STAC API catalogs (advertising ITEM_SEARCH) use the /search endpoint. Static
    catalogs (e.g. an S3-hosted catalog.json with no search endpoint) fall back to
    walking the collection's item links, filtered client-side.
    """
    client = get_client(catalog_url)
    if _conforms_to_item_search(client):
        return _search_via_api(client, collection_id, bbox, datetime_range, limit)
    return _search_via_walk(client, collection_id, bbox, datetime_range, limit)

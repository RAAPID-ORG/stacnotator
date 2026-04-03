"""pystac_client wrapper with MPC signing support."""

import logging

import planetary_computer as pc
import pystac_client

logger = logging.getLogger(__name__)


def _is_mpc(url: str) -> bool:
    return "planetarycomputer.microsoft.com" in url


def get_client(catalog_url: str) -> pystac_client.Client:
    """Get a pystac Client for the given catalog URL.

    For MPC, applies the planetary_computer modifier so that
    returned items have signed asset URLs.
    """
    kwargs = {}
    if _is_mpc(catalog_url):
        kwargs["modifier"] = pc.sign_inplace
    return pystac_client.Client.open(catalog_url, **kwargs)


def list_collections(catalog_url: str) -> list[dict]:
    """List collections from a STAC API catalog."""
    client = get_client(catalog_url)
    results = []
    for col in client.get_collections():
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
            item_assets[key] = {
                "title": asset_def.get("title", key),
                "type": asset_def.get("type", ""),
                "roles": asset_def.get("roles", []),
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
    return results


def search_items(
    catalog_url: str,
    collection_id: str,
    bbox: list[float] | None = None,
    datetime_range: str | None = None,
    limit: int = 50,
) -> list[dict]:
    """Search STAC items and return simplified results."""
    client = get_client(catalog_url)
    search_kwargs: dict = {"collections": [collection_id], "max_items": limit}
    if bbox:
        search_kwargs["bbox"] = bbox
    if datetime_range:
        search_kwargs["datetime"] = datetime_range

    search = client.search(**search_kwargs)
    results = []
    for item in search.items():
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

        results.append(
            {
                "id": item.id,
                "datetime": item.datetime.isoformat() if item.datetime else None,
                "bbox": list(item.bbox) if item.bbox else None,
                "geometry": item.geometry,
                "properties": dict(item.properties),
                "assets": assets_info,
                "thumbnail": thumbnail,
                "self_href": item.get_self_href(),
            }
        )
    return results

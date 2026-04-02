import hashlib
import json
import logging
import time
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Query

from src.tiling.schemas import (
    MosaicRegisterRequest,
    MosaicRegisterResponse,
    SearchRequest,
    SearchResponse,
)
from src.tiling.stac_client import get_client, search_items
from src.tiling.stac_client import list_collections as _list_collections

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stac", tags=["STAC Browser"])

STACINDEX_URL = "https://stacindex.org/api/catalogs"
STACINDEX_CACHE_TTL = 3600  # 1 hour
MPC_API_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

_AUTH_REQUIRED_CATALOGS = {"usgs-m2m", "maxar"}


_catalogs_cache: dict = {"data": None, "expires": 0}


@router.get("/catalogs")
async def list_catalogs():
    """Proxy StacIndex API with caching. Returns public STAC API catalogs."""
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
        raise HTTPException(status_code=502, detail=f"StacIndex unavailable: {e}") from e

    filtered = []
    filtered.append(
        {
            "id": "mpc",
            "title": "Microsoft Planetary Computer",
            "url": MPC_API_URL,
            "summary": "The Planetary Computer - petabytes of Earth observation data",
            "is_mpc": True,
            "auth_required": False,
        }
    )

    for cat in all_catalogs:
        if not cat.get("isApi"):
            continue
        url = cat.get("url", "")
        if "planetarycomputer" in url:
            continue
        cat_id = cat.get("id") or cat.get("slug", "")
        filtered.append(
            {
                "id": cat_id,
                "title": cat.get("title", ""),
                "url": url,
                "summary": cat.get("summary", ""),
                "is_mpc": False,
                "auth_required": cat_id in _AUTH_REQUIRED_CATALOGS,
            }
        )

    _catalogs_cache["data"] = filtered
    _catalogs_cache["expires"] = now + STACINDEX_CACHE_TTL
    return filtered


@router.get("/collections")
def get_collections(catalog_url: str = Query(..., description="STAC API URL")):
    """List collections from a STAC API catalog."""
    try:
        return _list_collections(catalog_url)
    except Exception as e:
        logger.error("Failed to list collections from %s: %s", catalog_url, e)
        raise HTTPException(status_code=502, detail=f"Failed to connect to catalog: {e}") from e


@router.post("/search", response_model=SearchResponse)
def search(request: SearchRequest):
    """Search STAC items in a catalog collection."""
    try:
        items = search_items(
            catalog_url=request.catalog_url,
            collection_id=request.collection_id,
            bbox=request.bbox,
            datetime_range=request.datetime_range,
            limit=request.limit,
        )
        return {"items": items, "count": len(items)}
    except Exception as e:
        logger.error("STAC search failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Search failed: {e}") from e


def build_viz_query_string(viz_params: dict | None) -> str:
    """Build URL query string from viz params dict (snake_case keys).

    Returns empty string if no params.
    """
    if not viz_params:
        return ""

    parts: list[tuple[str, str]] = []

    assets = viz_params.get("assets", [])
    for a in assets:
        parts.append(("assets", a))

    if viz_params.get("asset_as_band"):
        parts.append(("asset_as_band", "true"))

    expression = viz_params.get("expression")
    if expression:
        parts.append(("expression", expression))

    rescale = viz_params.get("rescale")
    if rescale:
        num_bands = max(len(assets), 1)
        for _ in range(num_bands):
            parts.append(("rescale", rescale))

    colormap_name = viz_params.get("colormap_name")
    if colormap_name and len(assets) <= 1:
        parts.append(("colormap_name", colormap_name))

    color_formula = viz_params.get("color_formula")
    if color_formula:
        parts.append(("color_formula", color_formula))

    resampling = viz_params.get("resampling")
    if resampling:
        parts.append(("resampling", resampling))

    nodata = viz_params.get("nodata")
    if nodata is not None:
        parts.append(("nodata", str(nodata)))

    compositing = viz_params.get("compositing")
    if compositing:
        parts.append(("compositing", compositing))

    mask_layer = viz_params.get("mask_layer")
    if mask_layer:
        parts.append(("mask_layer", mask_layer))

    mask_values = viz_params.get("mask_values", [])
    for mv in mask_values:
        parts.append(("mask_values", str(mv)))

    nir_band = viz_params.get("nir_band")
    if nir_band:
        parts.append(("nir_band", nir_band))

    red_band = viz_params.get("red_band")
    if red_band:
        parts.append(("red_band", red_band))

    max_items = viz_params.get("max_items")
    if max_items is not None:
        parts.append(("max_items", str(min(int(max_items), 10))))

    return urlencode(parts)


def _extract_cloud_cover_from_filter(cql_filter: dict) -> float | None:
    """Extract eo:cloud_cover limit from a CQL2 filter tree, if present."""
    op = cql_filter.get("op", "")
    args = cql_filter.get("args", [])

    # Direct: {"op": "<=", "args": [{"property": "eo:cloud_cover"}, 90]}
    if (
        op == "<="
        and len(args) == 2
        and isinstance(args[0], dict)
        and args[0].get("property") == "eo:cloud_cover"
    ):
        return float(args[1])

    # Wrapped in "or" with isNull (our pattern):
    # {"op": "or", "args": [{"op": "isNull", ...}, {"op": "<=", ...}]}
    if op == "or":
        for arg in args:
            result = _extract_cloud_cover_from_filter(arg)
            if result is not None:
                return result

    # Inside "and":
    if op == "and":
        for arg in args:
            result = _extract_cloud_cover_from_filter(arg)
            if result is not None:
                return result

    return None


def register_mosaic_sync(
    catalog_url: str,
    collection_id: str,
    bbox: list[float] | None,
    datetime_range: str,
    max_items: int = 500,
    search_query: dict | None = None,
) -> dict:
    """Register a mosaic from STAC search results (sync version).

    search_query is the CQL2-JSON query built by the frontend.
    Returns dict with mosaic_id, item_count, assets, item_refs.
    Raises ValueError if no items found.
    """
    client = get_client(catalog_url)

    # Check if the catalog supports CQL2 filtering
    try:
        conforms_to = (
            client.conforms_to()
            if callable(getattr(client, "conforms_to", None))
            else (getattr(client, "conforms_to", None) or [])
        )
    except Exception:
        conforms_to = []
    supports_filter = any("filter" in c.lower() for c in (conforms_to or []))

    search_kwargs: dict = {
        "max_items": max_items,
        "collections": (search_query or {}).get("collections", [collection_id]),
    }
    if bbox:
        search_kwargs["bbox"] = bbox
    if datetime_range:
        search_kwargs["datetime"] = datetime_range

    cql_filter = (search_query or {}).get("filter")
    if cql_filter and supports_filter:
        search_kwargs["filter"] = cql_filter
        search_kwargs["filter_lang"] = "cql2-json"
    elif cql_filter and not supports_filter:
        # Fallback: extract cloud cover from CQL2 filter into STAC query extension
        cloud_limit = _extract_cloud_cover_from_filter(cql_filter)
        if cloud_limit is not None:
            search_kwargs["query"] = {"eo:cloud_cover": {"lte": cloud_limit}}

    search = client.search(**search_kwargs)
    items = list(search.items())

    if not items:
        raise ValueError(f"No items found for {collection_id} in {datetime_range}")

    item_refs = []
    for item in items:
        href = item.get_self_href()
        item_bbox = list(item.bbox) if item.bbox else None
        item_dt = item.datetime.isoformat() if item.datetime else None
        cloud_cover = item.properties.get("eo:cloud_cover")
        if href and item_bbox:
            item_refs.append(
                {
                    "href": href,
                    "bbox": item_bbox,
                    "id": item.id,
                    "datetime": item_dt,
                    "cloud_cover": cloud_cover,
                }
            )

    if not item_refs:
        raise ValueError("No items with valid self_href and bbox")

    sample_item = items[0]
    assets_info = {}
    for key, asset in sample_item.assets.items():
        assets_info[key] = {
            "title": asset.title or key,
            "type": asset.media_type or "",
            "roles": asset.roles or [],
        }

    key_data = json.dumps(
        {
            "catalog_url": catalog_url,
            "collection_id": collection_id,
            "bbox": bbox,
            "datetime_range": datetime_range,
        },
        sort_keys=True,
    )
    mosaic_id = hashlib.sha256(key_data.encode()).hexdigest()[:16]

    return {
        "mosaic_id": mosaic_id,
        "item_count": len(item_refs),
        "assets": assets_info,
        "item_refs": item_refs,
    }


@router.post("/mosaic/register", response_model=MosaicRegisterResponse)
def register_mosaic(request: MosaicRegisterRequest):
    """Create a mosaic from STAC search results for a single time window."""
    try:
        result = register_mosaic_sync(
            catalog_url=request.catalog_url,
            collection_id=request.collection_id,
            bbox=request.bbox,
            datetime_range=request.datetime_range,
            max_items=request.max_items or 500,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

logger = logging.getLogger(__name__)

PLACEHOLDER_START = "{startDatetimePlaceholder}"
PLACEHOLDER_END = "{endDatetimePlaceholder}"
PLACEHOLDER_BBOX = "{campaignBBoxPlaceholder}"


def _fill_placeholders(
    search_body: str,
    start_date: str,
    end_date: str,
    bbox: list[float],
) -> dict:
    """Replace temporal and spatial placeholders in a STAC search body."""
    raw = json.dumps({**json.loads(search_body), "bbox": bbox})
    filled = (
        raw.replace(PLACEHOLDER_START, start_date)
        .replace(PLACEHOLDER_END, end_date)
        .replace(f'"{PLACEHOLDER_BBOX}"', json.dumps(bbox))
    )
    return json.loads(filled)


def register_single_slice(
    registration_url: str,
    search_body: str,
    bbox: list[float],
    start_date: str,
    end_date: str,
) -> str:
    """
    Register a single STAC mosaic slice and return the searchId.
    Raises ValueError if the registration endpoint does not return a searchId.
    """
    payload = _fill_placeholders(search_body, start_date, end_date, bbox)
    resp = httpx.post(registration_url, json=payload, timeout=30.0)
    resp.raise_for_status()

    data = resp.json()
    search_id = data.get("searchId") or data.get("searchid") or data.get("search_id")
    if not search_id:
        raise ValueError(f"No searchId returned from {registration_url}")
    return search_id


def resolve_tile_url(url_template: str, search_id: str) -> str:
    """Replace {searchId} placeholder in a tile URL template."""
    return url_template.replace("{searchId}", search_id)


def register_collection_slices(
    registration_url: str,
    search_body: str,
    bbox: list[float],
    slices: list[dict],
    viz_url_templates: list[dict],
    max_workers: int = 4,
) -> list[dict]:
    """
    Register STAC mosaics for every slice and return resolved tile URLs.

    Args:
        registration_url: STAC mosaic registration endpoint
        search_body: JSON string with placeholders
        bbox: Campaign bounding box [west, south, east, north]
        slices: List of dicts with keys 'index', 'start_date', 'end_date'
        viz_url_templates: List of dicts with keys 'viz_name', 'url_template'
        max_workers: Concurrency limit for registration calls

    Returns:
        List of dicts: [{ 'slice_index': int, 'tile_urls': [{ 'viz_name': str, 'url': str }] }]
    """
    results: list[dict] = [None] * len(slices)  # type: ignore[list-item]

    def _register(idx: int, sl: dict) -> tuple[int, str]:
        search_id = register_single_slice(
            registration_url,
            search_body,
            bbox,
            sl["start_date"],
            sl["end_date"],
        )
        return idx, search_id

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_register, i, s): i for i, s in enumerate(slices)}
        for future in as_completed(futures):
            idx, search_id = future.result()
            results[idx] = {
                "slice_index": idx,
                "tile_urls": [
                    {
                        "viz_name": t["viz_name"],
                        "url": resolve_tile_url(t["url_template"], search_id),
                    }
                    for t in viz_url_templates
                ],
            }

    return results

"""A slice's tiles, derived from what is stored rather than stored themselves.

A manual slice is drawn from its templates. A STAC slice is drawn from a mosaic its
search was registered as, on the provider each visualization's parameters route to, with
those parameters in the URL. So a parameter edit is visible on the next read, and only
a change to what was searched needs registering again.
"""

import time
from typing import TYPE_CHECKING

from src.config import get_settings
from src.tilers import providers, registry

if TYPE_CHECKING:
    from src.imagery.models import ImageryCollection, ImagerySlice, SliceMosaic, SliceTile

# MPC forgets a search a day after registering it, so one is registered again this
# long before then.
MPC_RENEW_BEFORE_SECONDS = 4 * 3600


def visualization_params(collection: "ImageryCollection", sl: "ImagerySlice") -> dict[int, dict]:
    """Each visualization's parameters on this slice: the cover's own where it has them."""
    cover = collection.is_cover(sl)
    return {
        cr.visualization_id: cr.cover_params if cover and cr.cover_params is not None else cr.params
        for cr in collection.visualizations
    }


def provider_for(collection: "ImageryCollection", params: dict) -> str | None:
    """Where a visualization is drawn: MPC, or the collection's hosted tiler (the
    configured default when it names none - None when there is no default)."""
    if providers.select_provider(collection.catalog_url, params) == registry.MPC:
        return registry.MPC
    return collection.tiler or get_settings().DEFAULT_TILER


def search_query(collection: "ImageryCollection", sl: "ImagerySlice") -> dict | None:
    """The query a slice is mosaicked from: the cover's own for a dedicated cover."""
    if collection.is_cover(sl) and collection.cover_search_query:
        return collection.cover_search_query
    return collection.search_query


def cloud_cover_ceiling(query: dict | list | None) -> float | None:
    """The ``eo:cloud_cover`` ceiling a search filters on, if any. A hosted tiler's
    ingest applies it too, so it does not load items the search would drop."""
    if isinstance(query, list):
        return next((c for q in query if (c := cloud_cover_ceiling(q)) is not None), None)
    if not isinstance(query, dict):
        return None
    args = query.get("args")
    if (
        query.get("op") == "<="
        and isinstance(args, list)
        and len(args) == 2
        and args[0] == {"property": "eo:cloud_cover"}
        and isinstance(args[1], int | float)
    ):
        return float(args[1])
    return cloud_cover_ceiling(list(query.values()))


def mpc_expiry(mosaic_id: str) -> int:
    """When MPC forgets a search: the unix time it stamps on the id
    (``pc1.<expiry>.<hash>``), or 0 for an id from before it stamped them, all of
    which it has forgotten."""
    parts = mosaic_id.split(".")
    if len(parts) == 3 and parts[0] == "pc1" and parts[1].isdigit():
        return int(parts[1])
    return 0


def _lasts(mosaic: "SliceMosaic", seconds: float) -> bool:
    return mosaic.provider != registry.MPC or mpc_expiry(mosaic.mosaic_id) > time.time() + seconds


def missing_providers(collection: "ImageryCollection", sl: "ImagerySlice") -> set[str | None]:
    """Providers this slice's visualizations need a mosaic on and it has none, or only
    one MPC is about to forget."""
    if not collection.is_stac:
        return set()
    have = {m.provider for m in sl.mosaics if _lasts(m, MPC_RENEW_BEFORE_SECONDS)}
    needed = {provider_for(collection, p) for p in visualization_params(collection, sl).values()}
    return needed - have


def slice_tiles(collection: "ImageryCollection", sl: "ImagerySlice") -> list["SliceTile"]:
    """Every visualization of the slice that can be drawn now. One whose mosaic is not
    registered yet, has expired, or whose tiler is no longer configured, is left out."""
    from src.imagery.models import SliceTile

    if not collection.is_stac:
        return [SliceTile(t.visualization_id, t.url, None) for t in sl.templates]
    mosaics = {m.provider: m.mosaic_id for m in sl.mosaics if _lasts(m, 0)}
    tiles = []
    for visualization_id, params in sorted(visualization_params(collection, sl).items()):
        provider = provider_for(collection, params)
        mosaic = mosaics.get(provider) if provider else None
        if mosaic is None:
            continue
        if provider == registry.MPC:
            url = providers.build_tile_url(
                registry.MPC, mosaic, params, collection_id=collection.stac_collection_id
            )
        else:
            try:
                tiler = providers.resolve_tiler(provider)
            except ValueError:
                continue
            url = providers.build_tile_url(registry.HOSTED, mosaic, params, tiler=tiler)
        tiles.append(SliceTile(visualization_id, url, provider))
    return tiles

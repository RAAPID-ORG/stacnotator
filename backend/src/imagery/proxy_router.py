"""Backend tile proxy: fetch provider tiles server-side with the decrypted API key attached.

Browser tile requests (OpenLayers ``<img>``) carry no ``Authorization`` header, so these
endpoints authenticate via the campaign-scoped ``tiler_token`` HttpOnly cookie instead of the
usual Firebase bearer. The provider key is decrypted here and never reaches the client.

This is a separate router (not ``imagery.router``) precisely so it is *not* under that
router's ``require_authenticated_user`` bearer dependency.

Two things bound this path, and they are deliberately different sizes. The database
lookup holds a tile *DB* slot, because connections are scarce - but it almost never runs,
since a tile's upstream target changes only when an admin edits the layer and is cached
here for a minute. The provider fetch holds a tile *upstream* slot instead, which is far
larger, because a proxied tile spends its life waiting on someone else's server while
holding no connection of ours. Holding the DB budget across that wait, as this module
used to, capped the whole proxy at roughly sixty tiles a second.
"""

import time
from collections import OrderedDict
from collections.abc import Callable

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from src import net_guard
from src.config import get_settings
from src.crypto import DecryptionError, decrypt
from src.database import SessionLocal
from src.imagery.models import (
    Basemap,
    ImageryCollection,
    ImagerySlice,
    ImagerySource,
    SliceTileUrl,
)
from src.imagery.proxy import build_upstream_tile_url
from src.layers import LayerOwner
from src.tile_bulkhead import tile_db_slot, tile_upstream_slot
from src.tilers import tokens

router = APIRouter(tags=["Imagery Tiles"])

# Guarded: the template is a stored, campaign-admin-supplied URL, so the fetch is
# only as trustworthy as whatever that admin typed.
#
# httpx defaults to 100 connections, which on its own capped the proxy well below the
# upstream bulkhead it now sits behind. The two are sized together so the semaphore is
# the thing that queues, not the connection pool silently underneath it.
_settings = get_settings()
_client = net_guard.guarded_async_client(
    timeout=15.0,
    limits=httpx.Limits(
        max_connections=_settings.TILE_UPSTREAM_MAX_CONCURRENCY,
        max_keepalive_connections=max(32, _settings.TILE_UPSTREAM_MAX_CONCURRENCY // 4),
    ),
)

# Resolved tile targets, keyed by what identifies the layer. One query and one pool
# checkout per tile is the difference between a proxy that scales and one that does not,
# and the value changes only when an admin edits the layer - so it is cached for
# TILE_TARGET_CACHE_TTL and the edit shows up within that. Only successes are stored: a
# 404 stays uncached so a newly created layer works immediately.
_targets: OrderedDict[tuple, tuple[float, tuple[str, str | None]]] = OrderedDict()


def _cache_get(key: tuple) -> tuple[str, str | None] | None:
    entry = _targets.get(key)
    if entry is None:
        return None
    expires, value = entry
    if expires <= time.monotonic():
        _targets.pop(key, None)
        return None
    _targets.move_to_end(key)
    return value


def _cache_put(key: tuple, value: tuple[str, str | None]) -> None:
    settings = get_settings()
    _targets[key] = (time.monotonic() + settings.TILE_TARGET_CACHE_TTL, value)
    _targets.move_to_end(key)
    while len(_targets) > settings.TILE_TARGET_CACHE_SIZE:
        _targets.popitem(last=False)


def reset_target_cache() -> None:
    _targets.clear()


async def _resolve(
    key: tuple, lookup: Callable[[Session], tuple[str, str | None]]
) -> tuple[str, str | None]:
    """The tile's upstream target, from cache when possible.

    Only the miss touches the database, and only the miss holds a DB slot. The slot is
    taken here rather than on the route so it is released before the provider fetch,
    which is the slow part and needs no connection.
    """
    hit = _cache_get(key)
    if hit is not None:
        return hit
    async with tile_db_slot():
        value = await run_in_threadpool(_with_session, lookup)
    _cache_put(key, value)
    return value


def _with_session[T](lookup: Callable[[Session], T]) -> T:
    db = SessionLocal()
    try:
        return lookup(db)
    finally:
        db.close()


def _assert_scope(request: Request, scope: str) -> None:
    """Authorize a tile request from the ``tiler_token`` cookie for one owner.

    The cookie carries the scopes its holder may read; a campaign's is its bare
    id and a visualizer's is prefixed, so the two can never be mistaken for one
    another. See ``imagery.models.LayerOwner``.
    """
    token = request.cookies.get("tiler_token")
    if not token:
        raise HTTPException(status_code=401, detail="Missing tiler session")
    try:
        claims = tokens.verify(token)
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid tiler session") from None
    if scope not in claims.get("campaigns", []):
        raise HTTPException(status_code=403, detail="No access to this imagery")


def require_tile_access(request: Request, campaign_id: int = Path(...)) -> None:
    _assert_scope(request, LayerOwner(campaign_id=campaign_id).tile_scope)


def require_visualizer_tile_access(request: Request, visualizer_id: int = Path(...)) -> None:
    _assert_scope(request, LayerOwner(visualizer_id=visualizer_id).tile_scope)


async def _proxy(template: str, encrypted_api_key: str | None, z: int, x: int, y: int) -> Response:
    if not encrypted_api_key:
        raise HTTPException(status_code=404, detail="Provider API key not configured")
    try:
        api_key = decrypt(encrypted_api_key)
    except DecryptionError as e:
        raise HTTPException(status_code=500, detail="Provider API key could not be read") from e
    url = build_upstream_tile_url(template, z, x, y, api_key)
    try:
        async with tile_upstream_slot():
            resp = await _client.get(url)
        resp.raise_for_status()
    except net_guard.UnsafeUrlError as e:
        raise HTTPException(status_code=502, detail=f"Upstream tile URL rejected: {e}") from e
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail="Upstream tile fetch failed") from e
    return Response(
        content=resp.content,
        media_type=_image_media_type(resp.headers.get("content-type")),
        headers={"Cache-Control": "public, max-age=86400"},
    )


def _image_media_type(upstream: str | None) -> str:
    """Never echo a non-image content type back from an image endpoint - the body
    is upstream-controlled, so HTML here would render in the user's origin."""
    if upstream and upstream.split(";")[0].strip().lower().startswith("image/"):
        return upstream
    return "application/octet-stream"


@router.get(
    "/{campaign_id}/imagery/basemaps/{basemap_id}/tiles/{z}/{x}/{y}",
    dependencies=[Depends(require_tile_access)],
)
async def proxy_basemap_tile(
    campaign_id: int,
    basemap_id: int,
    z: int,
    x: int,
    y: int,
) -> Response:
    owner = LayerOwner(campaign_id=campaign_id)
    url, encrypted_api_key = await _resolve(
        ("basemap", owner.tile_scope, basemap_id), _basemap_lookup(basemap_id, owner)
    )
    return await _proxy(url, encrypted_api_key, z, x, y)


def _basemap_lookup(basemap_id: int, owner: LayerOwner):
    """Resolve one basemap's upstream template and key, scoped to its owner."""

    def lookup(db: Session) -> tuple[str, str | None]:
        basemap = db.get(Basemap, basemap_id)
        if basemap is None or basemap.owner != owner:
            raise HTTPException(status_code=404, detail="Basemap not found")
        return basemap.url, basemap.encrypted_key

    return lookup


def _slice_lookup(slice_id: int, visualization_name: str, owner: LayerOwner):
    """Resolve one slice's upstream template and key, scoped to its owner."""

    def lookup(db: Session) -> tuple[str, str | None]:
        source = db.execute(
            select(ImagerySource)
            .join(ImageryCollection, ImageryCollection.source_id == ImagerySource.id)
            .join(ImagerySlice, ImagerySlice.collection_id == ImageryCollection.id)
            .where(ImagerySlice.id == slice_id)
        ).scalar_one_or_none()
        if source is None or source.owner != owner:
            raise HTTPException(status_code=404, detail="Slice not found")
        tile = db.execute(
            select(SliceTileUrl).where(
                SliceTileUrl.slice_id == slice_id,
                SliceTileUrl.visualization_name == visualization_name,
            )
        ).scalar_one_or_none()
        if tile is None:
            raise HTTPException(status_code=404, detail="Tile URL not found")
        return tile.tile_url, source.encrypted_key

    return lookup


@router.get(
    "/{campaign_id}/imagery/slices/{slice_id}/tiles/{visualization_name}/{z}/{x}/{y}",
    dependencies=[Depends(require_tile_access)],
)
async def proxy_slice_tile(
    campaign_id: int,
    slice_id: int,
    visualization_name: str,
    z: int,
    x: int,
    y: int,
) -> Response:
    owner = LayerOwner(campaign_id=campaign_id)
    tile_url, encrypted_api_key = await _resolve(
        ("slice", owner.tile_scope, slice_id, visualization_name),
        _slice_lookup(slice_id, visualization_name, owner),
    )
    return await _proxy(tile_url, encrypted_api_key, z, x, y)


@router.get(
    "/visualizers/{visualizer_id}/imagery/basemaps/{basemap_id}/tiles/{z}/{x}/{y}",
    dependencies=[Depends(require_visualizer_tile_access)],
)
async def proxy_visualizer_basemap_tile(
    visualizer_id: int,
    basemap_id: int,
    z: int,
    x: int,
    y: int,
) -> Response:
    owner = LayerOwner(visualizer_id=visualizer_id)
    tile_url, encrypted_api_key = await _resolve(
        ("basemap", owner.tile_scope, basemap_id), _basemap_lookup(basemap_id, owner)
    )
    return await _proxy(tile_url, encrypted_api_key, z, x, y)


@router.get(
    "/visualizers/{visualizer_id}/imagery/slices/{slice_id}/tiles/{visualization_name}/{z}/{x}/{y}",
    dependencies=[Depends(require_visualizer_tile_access)],
)
async def proxy_visualizer_slice_tile(
    visualizer_id: int,
    slice_id: int,
    visualization_name: str,
    z: int,
    x: int,
    y: int,
) -> Response:
    owner = LayerOwner(visualizer_id=visualizer_id)
    tile_url, encrypted_api_key = await _resolve(
        ("slice", owner.tile_scope, slice_id, visualization_name),
        _slice_lookup(slice_id, visualization_name, owner),
    )
    return await _proxy(tile_url, encrypted_api_key, z, x, y)

"""Backend tile proxy: fetch provider tiles server-side with the decrypted API key attached.

Browser tile requests (OpenLayers ``<img>``) carry no ``Authorization`` header, so these
endpoints authenticate via the campaign-scoped ``tiler_token`` HttpOnly cookie instead of the
usual Firebase bearer. The provider key is decrypted here and never reaches the client.

This is a separate router (not ``imagery.router``) precisely so it is *not* under that
router's ``require_authenticated_user`` bearer dependency.
"""

from collections.abc import Callable

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from src import net_guard
from src.crypto import DecryptionError, decrypt
from src.database import SessionLocal
from src.imagery.models import (
    Basemap,
    ImageryCollection,
    ImagerySlice,
    ImagerySource,
    SliceTileUrl,
    SourceOwner,
)
from src.imagery.proxy import build_upstream_tile_url
from src.organizations.models import OrganizationApiKey
from src.tile_bulkhead import tile_db_slot
from src.tilers import tokens

router = APIRouter(tags=["Imagery Tiles"])

# Guarded: the template is a stored, campaign-admin-supplied URL, so the fetch is
# only as trustworthy as whatever that admin typed.
_client = net_guard.guarded_async_client(timeout=15.0)


async def _read[T](lookup: Callable[[Session], T]) -> T:
    """Resolve a tile's upstream target, holding the DB only for the lookup itself."""
    async with tile_db_slot():
        return await run_in_threadpool(_with_session, lookup)


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
    another. See ``imagery.models.SourceOwner``.
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
    _assert_scope(request, SourceOwner(campaign_id=campaign_id).tile_scope)


def require_visualizer_tile_access(request: Request, visualizer_id: int = Path(...)) -> None:
    _assert_scope(request, SourceOwner(visualizer_id=visualizer_id).tile_scope)


def _resolve_key(db: Session, layer: Basemap | ImagerySource) -> str | None:
    """The layer's own key, or the organization key it points at. Both are the
    same ciphertext; only where it is stored differs."""
    if layer.encrypted_api_key is not None:
        return layer.encrypted_api_key
    if layer.organization_api_key_id is None:
        return None
    key = db.get(OrganizationApiKey, layer.organization_api_key_id)
    return key.encrypted_key if key else None


async def _proxy(template: str, encrypted_api_key: str | None, z: int, x: int, y: int) -> Response:
    if not encrypted_api_key:
        raise HTTPException(status_code=404, detail="Provider API key not configured")
    try:
        api_key = decrypt(encrypted_api_key)
    except DecryptionError as e:
        raise HTTPException(status_code=500, detail="Provider API key could not be read") from e
    url = build_upstream_tile_url(template, z, x, y, api_key)
    try:
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
    def lookup(db: Session) -> tuple[str, str | None]:
        basemap = db.get(Basemap, basemap_id)
        if basemap is None or basemap.campaign_id != campaign_id:
            raise HTTPException(status_code=404, detail="Basemap not found")
        return basemap.url, _resolve_key(db, basemap)

    url, encrypted_api_key = await _read(lookup)
    return await _proxy(url, encrypted_api_key, z, x, y)


def _slice_lookup(slice_id: int, visualization_name: str, owner: SourceOwner):
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
        return tile.tile_url, _resolve_key(db, source)

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
    tile_url, encrypted_api_key = await _read(
        _slice_lookup(slice_id, visualization_name, SourceOwner(campaign_id=campaign_id))
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
    tile_url, encrypted_api_key = await _read(
        _slice_lookup(slice_id, visualization_name, SourceOwner(visualizer_id=visualizer_id))
    )
    return await _proxy(tile_url, encrypted_api_key, z, x, y)

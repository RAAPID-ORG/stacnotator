"""Backend tile proxy: fetch provider tiles server-side with the decrypted API key attached.

Browser tile requests (OpenLayers ``<img>``) carry no ``Authorization`` header, so these
endpoints authenticate via the campaign-scoped ``tiler_token`` HttpOnly cookie instead of the
usual Firebase bearer. The provider key is decrypted here and never reaches the client.

This is a separate router (not ``imagery.router``) precisely so it is *not* under that
router's ``require_approved_user`` bearer dependency.
"""

from collections.abc import Callable

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from src.crypto import DecryptionError, decrypt
from src.database import SessionLocal
from src.imagery.models import Basemap, ImageryCollection, ImagerySlice, ImagerySource, SliceTileUrl
from src.imagery.proxy import build_upstream_tile_url
from src.routing import FunctionNameOperationIdRoute
from src.tile_bulkhead import tile_db_slot
from src.tiling import tiler_token

router = APIRouter(tags=["Imagery Tiles"], route_class=FunctionNameOperationIdRoute)

_client = httpx.AsyncClient(timeout=15.0)


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


def require_tile_access(request: Request, campaign_id: int = Path(...)) -> None:
    """Authorize a tile request from the ``tiler_token`` cookie for this campaign."""
    token = request.cookies.get("tiler_token")
    if not token:
        raise HTTPException(status_code=401, detail="Missing tiler session")
    try:
        claims = tiler_token.verify(token)
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid tiler session") from None
    if str(campaign_id) not in claims.get("campaigns", []):
        raise HTTPException(status_code=403, detail="No access to this campaign")


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
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail="Upstream tile fetch failed") from e
    return Response(
        content=resp.content,
        media_type=resp.headers.get("content-type", "image/png"),
        headers={"Cache-Control": "public, max-age=86400"},
    )


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
        return basemap.url, basemap.encrypted_api_key

    url, encrypted_api_key = await _read(lookup)
    return await _proxy(url, encrypted_api_key, z, x, y)


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
    def lookup(db: Session) -> tuple[str, str | None]:
        source = db.execute(
            select(ImagerySource)
            .join(ImageryCollection, ImageryCollection.source_id == ImagerySource.id)
            .join(ImagerySlice, ImagerySlice.collection_id == ImageryCollection.id)
            .where(ImagerySlice.id == slice_id)
        ).scalar_one_or_none()
        if source is None or source.campaign_id != campaign_id:
            raise HTTPException(status_code=404, detail="Slice not found")
        tile = db.execute(
            select(SliceTileUrl).where(
                SliceTileUrl.slice_id == slice_id,
                SliceTileUrl.visualization_name == visualization_name,
            )
        ).scalar_one_or_none()
        if tile is None:
            raise HTTPException(status_code=404, detail="Tile URL not found")
        return tile.tile_url, source.encrypted_api_key

    tile_url, encrypted_api_key = await _read(lookup)
    return await _proxy(tile_url, encrypted_api_key, z, x, y)

"""Tile serving for user-uploaded custom maps (COG overlays)."""

import logging
import uuid as _uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from rio_tiler.io import COGReader
from sqlalchemy.orm import Session

from src.config import get_settings
from src.database import get_db
from src.models import CustomMap
from src.render import empty_tile, render_png

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/custom-map", tags=["CustomMap"])


def _resolve_cog_url(cog_key: str) -> str:
    settings = get_settings()
    if settings.STORAGE_PROVIDER == "local":
        return str(Path(settings.STORAGE_LOCAL_PATH) / cog_key)

    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobSasPermissions, BlobServiceClient, generate_blob_sas

    client = BlobServiceClient(
        account_url=settings.AZURE_STORAGE_ACCOUNT_URL,
        credential=DefaultAzureCredential(),
    )
    expiry = datetime.now(timezone.utc) + timedelta(hours=1)
    delegation_key = client.get_user_delegation_key(
        key_start_time=datetime.now(timezone.utc),
        key_expiry_time=expiry,
    )
    sas = generate_blob_sas(
        account_name=client.account_name,
        container_name=settings.AZURE_STORAGE_CONTAINER,
        blob_name=cog_key,
        user_delegation_key=delegation_key,
        permission=BlobSasPermissions(read=True),
        expiry=expiry,
    )
    return f"{settings.AZURE_STORAGE_ACCOUNT_URL}/{settings.AZURE_STORAGE_CONTAINER}/{cog_key}?{sas}"


@router.get("/{map_id}/tiles/{z}/{x}/{y}.png")
def custom_map_tile(
    map_id: _uuid.UUID,
    z: int,
    x: int,
    y: int,
    bidx: list[int] = Query(default=[]),
    rescale: list[str] = Query(default=[]),
    colormap_name: str | None = Query(default=None),
    color_formula: str | None = Query(default=None),
    nodata: float | None = Query(default=None),
    db: Session = Depends(get_db),
):
    custom_map = db.query(CustomMap).filter_by(id=map_id, status="ready").first()
    if not custom_map or not custom_map.cog_key:
        return Response(content=empty_tile(), media_type="image/png")

    effective_bidx = bidx or list(range(1, (custom_map.band_count or 1) + 1))
    effective_nodata = nodata if nodata is not None else custom_map.nodata

    try:
        cog_url = _resolve_cog_url(custom_map.cog_key)
        with COGReader(cog_url) as src:
            img = src.tile(
                x,
                y,
                z,
                indexes=effective_bidx,
                nodata=effective_nodata,
            )
    except Exception as exc:
        logger.warning("custom_map_tile %s z=%d x=%d y=%d error: %s", map_id, z, x, y, exc)
        return Response(content=empty_tile(), media_type="image/png")

    if img is None or not img.mask.any():
        return Response(content=empty_tile(), media_type="image/png")

    content = render_png(img, rescale, color_formula, colormap_name)
    return Response(
        content=content,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )

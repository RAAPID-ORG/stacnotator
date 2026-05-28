from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from titiler.core.factory import TilerFactory

from src.database import get_db
from src.models import Campaign, CampaignUser, CustomMap, UserRole
from src.storage import generate_read_url

logger = logging.getLogger(__name__)

PLATFORM_ADMIN_ROLE = "admin"
CUSTOM_MAP_READY = "ready"


def _user_id(request: Request) -> UUID:
    uid = getattr(request.state, "user_id", None)
    if not uid:
        raise HTTPException(status_code=401, detail="Missing user context")
    try:
        return UUID(uid)
    except ValueError as e:
        raise HTTPException(status_code=401, detail="Invalid user id") from e


def _ensure_can_access(db: Session, user_id: UUID, custom_map_id: UUID) -> CustomMap:
    custom_map = db.get(CustomMap, custom_map_id)
    if custom_map is None or custom_map.status != CUSTOM_MAP_READY or not custom_map.cog_path:
        raise HTTPException(status_code=404, detail="Custom map not available")

    campaign = db.get(Campaign, custom_map.campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")

    if campaign.is_public:
        return custom_map

    is_member = db.execute(
        select(CampaignUser).where(
            CampaignUser.campaign_id == campaign.id,
            CampaignUser.user_id == user_id,
        )
    ).first()
    if is_member:
        return custom_map

    is_platform_admin = db.execute(
        select(UserRole).where(
            UserRole.user_id == user_id,
            UserRole.role == PLATFORM_ADMIN_ROLE,
        )
    ).first()
    if is_platform_admin:
        return custom_map

    raise HTTPException(status_code=403, detail="No access to custom map")


def _cog_path_dependency(
    request: Request,
    custom_map_id: UUID = Path(...),
    db: Session = Depends(get_db),
) -> str:
    custom_map = _ensure_can_access(db, _user_id(request), custom_map_id)
    return generate_read_url(custom_map.cog_path)


# TiTiler's COG factory wired to our path_dependency. Gives us /tiles,
# /tilejson.json, /info, /preview, /statistics, /point, /bounds — same
# rendering surface our STAC pipeline uses.
_factory = TilerFactory(path_dependency=_cog_path_dependency)

router = APIRouter(prefix="/api/custom-map/{custom_map_id}", tags=["CustomMapTiles"])
router.include_router(_factory.router)

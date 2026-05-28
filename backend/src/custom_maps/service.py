from __future__ import annotations

import logging
import os
import subprocess
import sys
import uuid
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src import storage
from src.custom_maps.models import (
    STATUS_FAILED,
    STATUS_PENDING,
    STATUS_PROCESSING,
    CustomMap,
)

logger = logging.getLogger(__name__)

# Each worker subprocess peaks around 1 GB RAM during reprojection; 2 stays
# safe on the 2 GB backend container.
MAX_CONCURRENT_PROCESSING = 2
UPLOAD_SAS_TTL_MINUTES = 30
# Pending rows older than this are orphans (signed upload URL has expired).
# Cleaned up lazily on every list call.
STALE_PENDING_AFTER_MINUTES = UPLOAD_SAS_TTL_MINUTES * 2


def list_for_campaign(db: Session, campaign_id: int) -> list[CustomMap]:
    _prune_stale_pending(db, campaign_id)
    return list(
        db.execute(
            select(CustomMap)
            .where(CustomMap.campaign_id == campaign_id)
            .order_by(CustomMap.display_order, CustomMap.created_at)
        )
        .scalars()
        .all()
    )


def _prune_stale_pending(db: Session, campaign_id: int) -> None:
    cutoff = datetime.now(UTC) - timedelta(minutes=STALE_PENDING_AFTER_MINUTES)
    stale = list(
        db.execute(
            select(CustomMap).where(
                CustomMap.campaign_id == campaign_id,
                CustomMap.status == STATUS_PENDING,
                CustomMap.created_at < cutoff,
            )
        )
        .scalars()
        .all()
    )
    if not stale:
        return
    backend = storage.get_backend()
    for s in stale:
        backend.delete(s.source_path)
        db.delete(s)
    db.commit()
    logger.info("Pruned %d stale pending custom map(s) for campaign %s", len(stale), campaign_id)


def get_for_campaign(db: Session, campaign_id: int, custom_map_id: UUID) -> CustomMap:
    custom_map = db.execute(
        select(CustomMap).where(
            CustomMap.id == custom_map_id,
            CustomMap.campaign_id == campaign_id,
        )
    ).scalar_one_or_none()
    if custom_map is None:
        raise HTTPException(status_code=404, detail="Custom map not found")
    return custom_map


def create(
    db: Session,
    campaign_id: int,
    user_id: UUID,
    name: str,
    original_filename: str,
) -> tuple[CustomMap, str, str, int]:
    custom_map_id = uuid.uuid4()
    upload_path = storage.custom_map_source_path(campaign_id, str(custom_map_id), original_filename)

    custom_map = CustomMap(
        id=custom_map_id,
        campaign_id=campaign_id,
        uploaded_by_user_id=user_id,
        name=name,
        status=STATUS_PENDING,
        source_path=upload_path,
    )
    db.add(custom_map)
    db.commit()
    db.refresh(custom_map)

    upload_url = storage.get_backend().generate_upload_url(
        upload_path, ttl_minutes=UPLOAD_SAS_TTL_MINUTES
    )
    return custom_map, upload_url, upload_path, UPLOAD_SAS_TTL_MINUTES * 60


def complete_upload(db: Session, campaign_id: int, custom_map_id: UUID) -> CustomMap:
    custom_map = get_for_campaign(db, campaign_id, custom_map_id)

    # Idempotent retry from anything other than pending/failed is a no-op.
    if custom_map.status not in (STATUS_PENDING, STATUS_FAILED):
        return custom_map

    if not storage.get_backend().exists(custom_map.source_path):
        raise HTTPException(
            status_code=400,
            detail="Upload not received yet; finish PUT to the upload URL first",
        )

    in_flight = db.execute(
        select(func.count()).select_from(CustomMap).where(CustomMap.status == STATUS_PROCESSING)
    ).scalar_one()
    if in_flight >= MAX_CONCURRENT_PROCESSING:
        raise HTTPException(
            status_code=503,
            detail="Too many custom maps processing right now, retry shortly",
            headers={"Retry-After": "10"},
        )

    custom_map.status = STATUS_PROCESSING
    custom_map.error_message = None
    custom_map.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(custom_map)

    _spawn_worker(custom_map.id)
    return custom_map


def update(
    db: Session,
    campaign_id: int,
    custom_map_id: UUID,
    name: str | None = None,
    display_order: int | None = None,
    viz_params: dict | None = None,
) -> CustomMap:
    custom_map = get_for_campaign(db, campaign_id, custom_map_id)
    if name is not None:
        custom_map.name = name
    if display_order is not None:
        custom_map.display_order = display_order
    if viz_params is not None:
        custom_map.viz_params = viz_params
    custom_map.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(custom_map)
    return custom_map


def delete(db: Session, campaign_id: int, custom_map_id: UUID) -> None:
    custom_map = get_for_campaign(db, campaign_id, custom_map_id)
    source_path = custom_map.source_path
    cog_path = custom_map.cog_path
    db.delete(custom_map)
    db.commit()
    # Best-effort blob cleanup; errors here should not roll back the DB delete.
    backend = storage.get_backend()
    backend.delete(source_path)
    if cog_path:
        backend.delete(cog_path)


def _spawn_worker(custom_map_id: UUID) -> None:
    cmd = [sys.executable, "-m", "src.custom_maps.process", "--id", str(custom_map_id)]
    # Inherit stdout/stderr so worker logs (and crashes) surface in container logs.
    proc = subprocess.Popen(  # noqa: S603 - args fully controlled
        cmd,
        env=os.environ.copy(),
        start_new_session=True,
    )
    logger.info("Spawned custom map worker pid=%s for %s", proc.pid, custom_map_id)

import logging
import threading

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.custommaps.models import CustomMap
from src.custommaps.render import build_viz_params
from src.custommaps.schemas import CustomMapCreate, CustomMapUpdate
from src.database import SessionLocal
from src.tiling.providers import build_tile_url, register_cog_on_tiler, resolve_tiler

logger = logging.getLogger(__name__)


def _insert(db: Session, campaign_id: int, payload: CustomMapCreate) -> CustomMap:
    cm = CustomMap(
        campaign_id=campaign_id,
        name=payload.name,
        cog_url=payload.cog_url,
        render_config=payload.render_config.model_dump(mode="json"),
        opacity=payload.opacity,
        max_native_zoom=payload.max_native_zoom,
        status="registering",
    )
    db.add(cm)
    db.commit()
    db.refresh(cm)
    return cm


def run_registration(db: Session, cm: CustomMap) -> None:
    try:
        tiler = resolve_tiler(None)
        search_id = register_cog_on_tiler(tiler, cm.cog_url, cm.campaign_id)
        viz_params = build_viz_params(cm.render_config)
        cm.tile_url = build_tile_url("hosted", search_id, viz_params, tiler=tiler)
        cm.mosaic_id = search_id
        cm.status = "ready"
        cm.status_error = None
    except Exception as exc:
        logger.exception("Custom map registration failed for map %s", cm.id)
        cm.status = "failed"
        cm.status_error = {"error": str(exc)}
    db.commit()


def _register_async(map_id: int) -> None:
    bg_db = SessionLocal()
    try:
        cm = bg_db.get(CustomMap, map_id)
        if cm is not None:
            run_registration(bg_db, cm)
    finally:
        bg_db.close()


def _spawn_registration(map_id: int) -> None:
    threading.Thread(target=_register_async, args=(map_id,), daemon=True).start()


def create_custom_map(db: Session, campaign_id: int, payload: CustomMapCreate) -> CustomMap:
    cm = _insert(db, campaign_id, payload)
    _spawn_registration(cm.id)
    return cm


def list_custom_maps(db: Session, campaign_id: int) -> list[CustomMap]:
    return list(
        db.execute(
            select(CustomMap)
            .where(CustomMap.campaign_id == campaign_id)
            .order_by(CustomMap.display_order, CustomMap.id)
        ).scalars()
    )


def _get(db: Session, campaign_id: int, map_id: int) -> CustomMap | None:
    return db.execute(
        select(CustomMap).where(CustomMap.id == map_id, CustomMap.campaign_id == campaign_id)
    ).scalar_one_or_none()


def update_custom_map(
    db: Session, campaign_id: int, map_id: int, payload: CustomMapUpdate
) -> CustomMap | None:
    cm = _get(db, campaign_id, map_id)
    if cm is None:
        return None
    data = payload.model_dump(exclude_unset=True)
    needs_reregister = False
    if "render_config" in data and data["render_config"] is not None:
        old_band = (cm.render_config or {}).get("band", 1)
        cm.render_config = payload.render_config.model_dump(mode="json")
        needs_reregister = cm.render_config.get("band", 1) != old_band
    if "cog_url" in data and data["cog_url"] != cm.cog_url:
        cm.cog_url = data["cog_url"]
        needs_reregister = True
    for field in ("name", "opacity", "max_native_zoom", "display_order"):
        if field in data:
            setattr(cm, field, data[field])
    if needs_reregister:
        cm.status = "registering"
        cm.status_error = None
    db.commit()
    db.refresh(cm)
    if needs_reregister:
        _spawn_registration(cm.id)
    return cm


def delete_custom_map(db: Session, campaign_id: int, map_id: int) -> bool:
    cm = _get(db, campaign_id, map_id)
    if cm is None:
        return False
    db.delete(cm)
    db.commit()
    return True

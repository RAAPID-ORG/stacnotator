import logging
import threading

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.config import TilerCfg
from src.custom_layers.models import CustomMap, VectorLayer
from src.custom_layers.render import build_viz_params
from src.custom_layers.schemas import (
    CustomMapCreate,
    CustomMapUpdate,
    RenderConfig,
    VectorLayerCreate,
    VectorLayerUpdate,
)
from src.database import SessionLocal
from src.tiling.providers import build_tile_url, register_cog_on_tiler, resolve_tiler

logger = logging.getLogger(__name__)


class DuplicateCustomMapName(Exception):
    pass


class InvalidRenderConfig(Exception):
    pass


def _render_config_dict(render_config: RenderConfig) -> dict:
    """`build_viz_params` is the authority on what can actually render, so run it up front:
    an unrenderable config becomes a 422 rather than a map that saves and then serves no
    tiles. Kept off the schema deliberately - `RenderConfig` also types `CustomMapOut`, and
    rows predating this check must stay readable (and therefore deletable)."""
    data = render_config.model_dump(mode="json")
    try:
        build_viz_params(data)
    except ValueError as exc:
        raise InvalidRenderConfig(str(exc)) from exc
    return data


def _name_taken(db: Session, campaign_id: int, name: str, exclude_id: int | None = None) -> bool:
    query = select(CustomMap.id).where(CustomMap.campaign_id == campaign_id, CustomMap.name == name)
    if exclude_id is not None:
        query = query.where(CustomMap.id != exclude_id)
    return db.execute(query).first() is not None


def _insert(db: Session, campaign_id: int, payload: CustomMapCreate) -> CustomMap:
    cm = CustomMap(
        campaign_id=campaign_id,
        name=payload.name,
        cog_url=payload.cog_url,
        render_config=_render_config_dict(payload.render_config),
        max_native_zoom=payload.max_native_zoom,
        mlops_url=payload.mlops_url,
        internal_storage=payload.internal_storage,
        status="registering",
    )
    db.add(cm)
    db.commit()
    db.refresh(cm)
    return cm


def _stamp_tile_url(cm: CustomMap, search_id: str, tiler: TilerCfg) -> None:
    viz_params = build_viz_params(cm.render_config)
    cm.tile_url = build_tile_url("hosted", search_id, viz_params, tiler=tiler)


def run_registration(db: Session, cm: CustomMap) -> None:
    try:
        tiler = resolve_tiler(None)
        search_id = register_cog_on_tiler(
            tiler, cm.cog_url, cm.campaign_id, internal_storage=cm.internal_storage
        )
        # A colour edit can land while the tiler call is in flight, and update_custom_map
        # cannot restamp a map that has no search yet, so pick up the current config here.
        db.refresh(cm, ["render_config"])
        _stamp_tile_url(cm, search_id, tiler)
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
    if _name_taken(db, campaign_id, payload.name):
        raise DuplicateCustomMapName(payload.name)
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


def _get_custom_map(db: Session, campaign_id: int, map_id: int) -> CustomMap | None:
    return db.execute(
        select(CustomMap).where(CustomMap.id == map_id, CustomMap.campaign_id == campaign_id)
    ).scalar_one_or_none()


def update_custom_map(
    db: Session, campaign_id: int, map_id: int, payload: CustomMapUpdate
) -> CustomMap | None:
    cm = _get_custom_map(db, campaign_id, map_id)
    if cm is None:
        return None
    data = payload.model_dump(exclude_unset=True)
    if (
        "name" in data
        and data["name"] != cm.name
        and _name_taken(db, campaign_id, data["name"], exclude_id=map_id)
    ):
        raise DuplicateCustomMapName(data["name"])
    render_changed = False
    if payload.render_config is not None:
        cm.render_config = _render_config_dict(payload.render_config)
        render_changed = True
    needs_reregister = False
    if "cog_url" in data and data["cog_url"] != cm.cog_url:
        cm.cog_url = data["cog_url"]
        needs_reregister = True
    if "internal_storage" in data and data["internal_storage"] != cm.internal_storage:
        cm.internal_storage = data["internal_storage"]
        needs_reregister = True  # re-stamps the tiler search's asset_signer marker
    for field in ("name", "max_native_zoom", "display_order", "mlops_url"):
        if field in data:
            setattr(cm, field, data[field])
    # A failed map has no usable search, so any edit is also the retry affordance.
    needs_reregister = needs_reregister or cm.status == "failed"
    if needs_reregister:
        cm.status = "registering"
        cm.status_error = None
    elif render_changed and cm.mosaic_id and cm.status == "ready":
        # No tiler call: the pgstac search keys on cog_url/campaign/internal_storage only, so
        # colormap, rescale and band live in the tile URL alone. Anything not ready is skipped
        # because its mosaic_id is stale or absent; its in-flight registration bakes this in.
        _stamp_tile_url(cm, cm.mosaic_id, resolve_tiler(None))
    db.commit()
    db.refresh(cm)
    if needs_reregister:
        _spawn_registration(cm.id)
    return cm


def delete_custom_map(db: Session, campaign_id: int, map_id: int) -> bool:
    cm = _get_custom_map(db, campaign_id, map_id)
    if cm is None:
        return False
    db.delete(cm)
    db.commit()
    return True


def list_vector_layers(db: Session, campaign_id: int) -> list[VectorLayer]:
    return list(
        db.execute(
            select(VectorLayer)
            .where(VectorLayer.campaign_id == campaign_id)
            .order_by(VectorLayer.display_order, VectorLayer.id)
        ).scalars()
    )


def create_vector_layer(db: Session, campaign_id: int, payload: VectorLayerCreate) -> VectorLayer:
    layer = VectorLayer(
        campaign_id=campaign_id,
        name=payload.name,
        pmtiles_url=payload.pmtiles_url,
        source_layer=payload.source_layer,
        color=payload.color,
    )
    db.add(layer)
    db.commit()
    db.refresh(layer)
    return layer


def _get_vector_layer(db: Session, campaign_id: int, layer_id: int) -> VectorLayer | None:
    return db.execute(
        select(VectorLayer).where(
            VectorLayer.id == layer_id, VectorLayer.campaign_id == campaign_id
        )
    ).scalar_one_or_none()


def update_vector_layer(
    db: Session, campaign_id: int, layer_id: int, payload: VectorLayerUpdate
) -> VectorLayer | None:
    layer = _get_vector_layer(db, campaign_id, layer_id)
    if layer is None:
        return None
    data = payload.model_dump(exclude_unset=True)
    for field in ("name", "pmtiles_url", "source_layer", "color", "display_order"):
        if field in data:
            setattr(layer, field, data[field])
    db.commit()
    db.refresh(layer)
    return layer


def delete_vector_layer(db: Session, campaign_id: int, layer_id: int) -> bool:
    layer = _get_vector_layer(db, campaign_id, layer_id)
    if layer is None:
        return False
    db.delete(layer)
    db.commit()
    return True

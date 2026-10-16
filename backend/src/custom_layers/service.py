import logging
import threading

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src import storage_access
from src.config import TilerCfg
from src.custom_layers.models import CustomMap, VectorLayer
from src.custom_layers.render import build_viz_params
from src.custom_layers.schemas import (
    CustomMapCreate,
    CustomMapUpdate,
    VectorLayerCreate,
    VectorLayerUpdate,
)
from src.database import SessionLocal
from src.layers import LayerOwner
from src.redact import redact_urls
from src.tilers.providers import build_tile_url, register_cog_on_tiler, resolve_tiler
from src.visualizers.models import VisualizerOverlay

logger = logging.getLogger(__name__)


class DuplicateCustomMapName(Exception):
    pass


PRIVATE_MAP_NOT_PUBLISHABLE = (
    "A custom map read with a SAS token can't be published in a visualizer"
)


def _require_private_map_allowed(db: Session, owner: LayerOwner, map_id: int | None = None) -> None:
    if owner.visualizer_id is not None or (
        map_id is not None
        and db.scalar(select(VisualizerOverlay.id).where(VisualizerOverlay.custom_map_id == map_id))
        is not None
    ):
        raise HTTPException(status_code=400, detail=PRIVATE_MAP_NOT_PUBLISHABLE)


def _owned(model, owner: LayerOwner):
    """Rows belonging to this owner and no other."""
    return (model.campaign_id == owner.campaign_id) & (model.visualizer_id == owner.visualizer_id)


def _name_taken(db: Session, owner: LayerOwner, name: str, exclude_id: int | None = None) -> bool:
    query = select(CustomMap.id).where(_owned(CustomMap, owner), CustomMap.name == name)
    if exclude_id is not None:
        query = query.where(CustomMap.id != exclude_id)
    return db.execute(query).first() is not None


def _insert(db: Session, owner: LayerOwner, payload: CustomMapCreate) -> CustomMap:
    cm = CustomMap(
        **owner.as_columns(),
        name=payload.name,
        cog_url=payload.cog_url,
        render_config=payload.render_config.model_dump(mode="json"),
        max_native_zoom=payload.max_native_zoom,
        mlops_url=payload.mlops_url,
        internal_storage=payload.internal_storage,
        status="registering",
    )
    storage_access.store(cm, payload.storage_access)
    db.add(cm)
    db.commit()
    db.refresh(cm)
    return cm


def _stamp_tile_url(cm: CustomMap, search_id: str, tiler: TilerCfg) -> None:
    viz_params = build_viz_params(cm.render_config)
    cm.tile_url = build_tile_url("hosted", search_id, viz_params, tiler=tiler)


def run_registration(db: Session, cm: CustomMap) -> None:
    registered_access = (cm.cog_url, cm.internal_storage, cm.encrypted_storage_secret)

    def still_current() -> bool:
        db.refresh(
            cm,
            ["render_config", "cog_url", "internal_storage", "encrypted_storage_secret"],
            with_for_update=True,
        )
        return registered_access == (cm.cog_url, cm.internal_storage, cm.encrypted_storage_secret)

    try:
        tiler = resolve_tiler(None)
        access = storage_access.stored(cm)
        search_id = register_cog_on_tiler(
            tiler,
            cm.cog_url,
            cm.owner.tile_scope,
            internal_storage=cm.internal_storage,
            sealed_storage_access=(
                storage_access.seal_for_tiler(access, cm.cog_url) if access else None
            ),
        )
        # A colour edit can land while the tiler call is in flight, and update_custom_map
        # cannot restamp a map that has no search yet, so pick up the current config here.
        if not still_current():
            return
        _stamp_tile_url(cm, search_id, tiler)
        cm.mosaic_id = search_id
        cm.status = "ready"
        cm.status_error = None
    except Exception as exc:
        if not still_current():
            return
        logger.exception("Custom map registration failed for map %s", cm.id)
        cm.status = "failed"
        cm.status_error = {"error": redact_urls(str(exc))}
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


def create_custom_map(db: Session, owner: LayerOwner, payload: CustomMapCreate) -> CustomMap:
    if payload.storage_access is not None:
        _require_private_map_allowed(db, owner)
    if _name_taken(db, owner, payload.name):
        raise DuplicateCustomMapName(payload.name)
    cm = _insert(db, owner, payload)
    _spawn_registration(cm.id)
    return cm


def list_custom_maps(db: Session, owner: LayerOwner) -> list[CustomMap]:
    return list(
        db.execute(
            select(CustomMap)
            .where(_owned(CustomMap, owner))
            .order_by(CustomMap.display_order, CustomMap.id)
        ).scalars()
    )


def _get_custom_map(db: Session, owner: LayerOwner, map_id: int) -> CustomMap | None:
    return db.execute(
        select(CustomMap)
        .where(CustomMap.id == map_id, _owned(CustomMap, owner))
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def update_custom_map(
    db: Session, owner: LayerOwner, map_id: int, payload: CustomMapUpdate
) -> CustomMap | None:
    cm = _get_custom_map(db, owner, map_id)
    if cm is None:
        return None
    data = payload.model_dump(exclude_unset=True)
    new_url = payload.cog_url if payload.cog_url is not None else cm.cog_url
    keeps_access = cm.storage_auth and "storage_access" not in data
    if payload.storage_access is not None or keeps_access:
        try:
            storage_access.check_url(new_url)
        except storage_access.InvalidStorageAccess as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        internal = (
            payload.internal_storage
            if payload.internal_storage is not None
            else cm.internal_storage
        )
        if internal:
            raise HTTPException(
                status_code=400, detail="Choose either a SAS token or internal storage, not both"
            )
        if keeps_access and storage_access.host_of(new_url) != storage_access.host_of(cm.cog_url):
            raise HTTPException(
                status_code=400, detail="Provide a new SAS token when changing the storage host"
            )
    if payload.storage_access is not None:
        _require_private_map_allowed(db, cm.owner, cm.id)
    if (
        "name" in data
        and data["name"] != cm.name
        and _name_taken(db, owner, data["name"], exclude_id=map_id)
    ):
        raise DuplicateCustomMapName(data["name"])
    render_changed = False
    if payload.render_config is not None:
        cm.render_config = payload.render_config.model_dump(mode="json")
        render_changed = True
    needs_reregister = False
    if "storage_access" in data:
        if payload.storage_access is None:
            needs_reregister = bool(cm.storage_auth)
            storage_access.clear(cm)
        else:
            needs_reregister = storage_access.store(cm, payload.storage_access)
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


def delete_custom_map(db: Session, owner: LayerOwner, map_id: int) -> bool:
    cm = _get_custom_map(db, owner, map_id)
    if cm is None:
        return False
    db.delete(cm)
    db.commit()
    return True


def list_vector_layers(db: Session, owner: LayerOwner) -> list[VectorLayer]:
    return list(
        db.execute(
            select(VectorLayer)
            .where(_owned(VectorLayer, owner))
            .order_by(VectorLayer.display_order, VectorLayer.id)
        ).scalars()
    )


def create_vector_layer(db: Session, owner: LayerOwner, payload: VectorLayerCreate) -> VectorLayer:
    layer = VectorLayer(
        **owner.as_columns(),
        name=payload.name,
        pmtiles_url=payload.pmtiles_url,
        source_layer=payload.source_layer,
        color=payload.color,
    )
    db.add(layer)
    db.commit()
    db.refresh(layer)
    return layer


def _get_vector_layer(db: Session, owner: LayerOwner, layer_id: int) -> VectorLayer | None:
    return db.execute(
        select(VectorLayer).where(VectorLayer.id == layer_id, _owned(VectorLayer, owner))
    ).scalar_one_or_none()


def update_vector_layer(
    db: Session, owner: LayerOwner, layer_id: int, payload: VectorLayerUpdate
) -> VectorLayer | None:
    layer = _get_vector_layer(db, owner, layer_id)
    if layer is None:
        return None
    data = payload.model_dump(exclude_unset=True)
    for field in ("name", "pmtiles_url", "source_layer", "color", "display_order"):
        if field in data:
            setattr(layer, field, data[field])
    db.commit()
    db.refresh(layer)
    return layer


def delete_vector_layer(db: Session, owner: LayerOwner, layer_id: int) -> bool:
    layer = _get_vector_layer(db, owner, layer_id)
    if layer is None:
        return False
    db.delete(layer)
    db.commit()
    return True

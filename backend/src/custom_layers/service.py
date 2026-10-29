import logging
import threading

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src import background, storage_access
from src.config import TilerCfg, get_settings
from src.custom_layers.models import CustomMap, VectorLayer
from src.custom_layers.schemas import (
    CustomMapCreate,
    CustomMapUpdate,
    VectorLayerCreate,
    VectorLayerUpdate,
)
from src.database import SessionLocal
from src.layers import LayerOwner
from src.redact import redact_urls
from src.tilers.providers import (
    register_cog_on_tiler,
    resolve_tiler,
    revoke_on_tiler,
)
from src.visualizers.models import VisualizerOverlay

logger = logging.getLogger(__name__)


class DuplicateCustomMapName(Exception):
    pass


CUSTOM_MAP_RUN = background.StatusField(
    model=CustomMap,
    status_column="status",
    heartbeat_column="heartbeat_at",
    errors_column="status_errors",
    interrupted_error=(
        "Registering this map was interrupted by a server restart. Save it again to retry."
    ),
)


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


REVOKE_FAILED = "Couldn't withdraw the previous SAS token from the tiler; please try again"


def _private_search(cm: CustomMap) -> str | None:
    """The tiler search this map serves its SAS token through, if it has one."""
    return cm.mosaic_id if cm.storage_auth else None


def _revoke_private_search(db: Session, cm: CustomMap, search_id: str | None) -> None:
    """Delete a SAS-backed tiler search before the edit that retires it is committed.

    The search carries the SAS sealed inside it, so for as long as it exists it serves
    with a token the owner has replaced or removed. The edit fails rather than leave it
    live. Every map registers its own search (a duplicated campaign's copies too), so
    no other map reads through it.
    """
    if search_id is None:
        return
    try:
        revoke_on_tiler(resolve_tiler(cm.tiler), search_id)
    except (httpx.HTTPError, ValueError) as exc:
        logger.exception("Revoking tiler search %s for custom map %s failed", search_id, cm.id)
        raise HTTPException(status_code=502, detail=REVOKE_FAILED) from exc
    if cm.mosaic_id == search_id:
        cm.mosaic_id = None
        cm.tiler = None


def _discard_orphan(tiler: TilerCfg, search_id: str, map_id: int) -> None:
    """Revoke a SAS-backed search registered for an access that changed meanwhile."""
    try:
        revoke_on_tiler(tiler, search_id)
    except Exception:
        logger.exception(
            "Revoking orphaned tiler search %s for custom map %s failed", search_id, map_id
        )


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
    )
    background.begin_status_run(cm, CUSTOM_MAP_RUN)
    storage_access.store(cm, payload.storage_access)
    db.add(cm)
    db.commit()
    db.refresh(cm)
    return cm


def run_registration(db: Session, cm: CustomMap) -> None:
    registered_access = (cm.cog_url, cm.internal_storage, cm.encrypted_storage_secret)

    def still_current() -> bool:
        db.refresh(
            cm, ["cog_url", "internal_storage", "encrypted_storage_secret"], with_for_update=True
        )
        return registered_access == (cm.cog_url, cm.internal_storage, cm.encrypted_storage_secret)

    sealed_search: str | None = None
    try:
        tiler_name = get_settings().DEFAULT_TILER
        tiler = resolve_tiler(tiler_name)
        access = storage_access.stored(cm)
        search_id = register_cog_on_tiler(
            tiler,
            cm.cog_url,
            cm.owner.tile_scope,
            cm.tile_layer,
            internal_storage=cm.internal_storage,
            sealed_storage_access=(
                storage_access.seal_for_tiler(access, cm.cog_url) if access else None
            ),
        )
        if access is not None:
            sealed_search = search_id
        if not still_current():
            if sealed_search is not None:
                _discard_orphan(tiler, sealed_search, cm.id)
            return
        cm.mosaic_id = search_id
        cm.tiler = tiler_name
        cm.status = "ready"
        cm.status_errors = None
    except Exception as exc:
        if sealed_search is not None:
            _discard_orphan(tiler, sealed_search, cm.id)
        if not still_current():
            return
        logger.exception("Custom map registration failed for map %s", cm.id)
        cm.status = "failed"
        cm.status_errors = [{"error": redact_urls(str(exc))}]
    db.commit()


def _register_async(map_id: int) -> None:
    """Not ``background.spawn_status_run``: a run overtaken by an edit must leave the
    status to the run that edit started, so this one writes its own outcome. It still
    beats, so the stale-run sweep can tell a dead worker's run from a live one."""
    bg_db = SessionLocal()
    try:
        with background.heartbeat(map_id, CUSTOM_MAP_RUN):
            cm = bg_db.get(CustomMap, map_id)
            if cm is not None:
                run_registration(bg_db, cm)
    finally:
        bg_db.close()


def spawn_registration(map_id: int) -> None:
    threading.Thread(target=_register_async, args=(map_id,), daemon=True).start()


def resume_pending(db: Session) -> None:
    """Start the custom-map registrations left owed, for the maps this worker claims."""
    map_ids = background.claim_pending_runs(db, CUSTOM_MAP_RUN)
    db.commit()
    for map_id in map_ids:
        spawn_registration(map_id)


def create_custom_map(db: Session, owner: LayerOwner, payload: CustomMapCreate) -> CustomMap:
    if payload.storage_access is not None:
        _require_private_map_allowed(db, owner)
    if _name_taken(db, owner, payload.name):
        raise DuplicateCustomMapName(payload.name)
    cm = _insert(db, owner, payload)
    spawn_registration(cm.id)
    return cm


def list_custom_maps(db: Session, owner: LayerOwner) -> list[CustomMap]:
    """The editor polls this while a map registers, so a run whose worker died is
    failed here rather than left "registering" until the next restart."""
    query = (
        select(CustomMap)
        .where(_owned(CustomMap, owner))
        .order_by(CustomMap.display_order, CustomMap.id)
    )
    maps = list(db.execute(query).scalars())
    if any(cm.status == "registering" for cm in maps) and background.fail_stale_status_runs(
        db, (CUSTOM_MAP_RUN,)
    ):
        db.commit()
        maps = list(db.execute(query.execution_options(populate_existing=True)).scalars())
    return maps


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
    private_search = _private_search(cm)
    if (
        "name" in data
        and data["name"] != cm.name
        and _name_taken(db, owner, data["name"], exclude_id=map_id)
    ):
        raise DuplicateCustomMapName(data["name"])
    if payload.render_config is not None:
        cm.render_config = payload.render_config.model_dump(mode="json")
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
        _revoke_private_search(db, cm, private_search)
        background.begin_status_run(cm, CUSTOM_MAP_RUN)
        cm.status_errors = None
    db.commit()
    db.refresh(cm)
    if needs_reregister:
        spawn_registration(cm.id)
    return cm


def delete_custom_map(db: Session, owner: LayerOwner, map_id: int) -> bool:
    cm = _get_custom_map(db, owner, map_id)
    if cm is None:
        return False
    _revoke_private_search(db, cm, _private_search(cm))
    db.delete(cm)
    db.commit()
    return True


def revoke_campaign_private_searches(db: Session, campaign_id: int) -> None:
    """Retire every SAS-backed search of a campaign's custom maps, before it is deleted."""
    for cm in db.scalars(
        select(CustomMap).where(
            CustomMap.campaign_id == campaign_id,
            CustomMap.storage_auth.is_not(None),
            CustomMap.mosaic_id.is_not(None),
        )
    ):
        _revoke_private_search(db, cm, cm.mosaic_id)


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

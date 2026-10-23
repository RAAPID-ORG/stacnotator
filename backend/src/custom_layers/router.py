"""Overlay endpoints, once per owner.

A campaign and a visualizer set overlays up the same way, through the same service
and the same organization guards. What differs is the path, who may read the list
(anyone with campaign access, but only a visualizer's admins), and that an overlay
set up on a visualizer joins its overlay list as it is created.
"""

from collections.abc import Callable

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_authenticated_user
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.config import get_settings
from src.custom_layers import service
from src.custom_layers.models import CustomMap, VectorLayer
from src.custom_layers.schemas import (
    CustomMapCreate,
    CustomMapOut,
    CustomMapUpdate,
    VectorLayerCreate,
    VectorLayerOut,
    VectorLayerUpdate,
)
from src.database import get_db
from src.visualizers import service as visualizers_service
from src.visualizers.dependencies import require_visualizer_admin
from src.visualizers.models import Visualizer

bearer = HTTPBearer()

Owner = Campaign | Visualizer


def _require_internal_storage_allowed(internal_storage: bool | None, owner: Owner) -> None:
    """Only organizations cleared for it may point a map at internal
    (managed-identity) storage."""
    if internal_storage and not owner.project.organization.allows_internal_storage:
        raise HTTPException(
            status_code=403,
            detail="This organization cannot mark a custom map as internal storage",
        )


def _require_tiler_allowed(owner: Owner) -> None:
    """Registration always puts a custom map on the default hosted tiler, so the
    owning organization must be allowed to use it. A deployment without a default
    tiler has nothing to authorize - registration then fails on its own."""
    tiler_name = get_settings().DEFAULT_TILER
    if tiler_name is None or tiler_name in owner.project.organization.allowed_tiler_names:
        return
    raise HTTPException(
        status_code=403,
        detail=f"Your organization is not authorized to use tiler '{tiler_name}'",
    )


def _duplicate_name(exc: service.DuplicateCustomMapName) -> HTTPException:
    return HTTPException(status_code=409, detail="A custom map with this name already exists")


def _named(name: str):
    """Name the endpoint, which is what its OpenAPI operation id is derived from."""

    def rename(fn):
        fn.__name__ = name
        return fn

    return rename


def _owner_routes(
    owner_path: str,
    *,
    reader: Callable[..., Owner],
    admin: Callable[..., Owner],
    names: str,
    on_created: Callable[[Session, Owner, CustomMap | VectorLayer], None] | None = None,
) -> APIRouter:
    """The custom-map and vector-layer routes under one owner's path.

    ``names`` is spliced into each endpoint's name, so the operation ids stay
    ``listCustomMaps`` for a campaign and ``listVisualizerCustomMaps`` for a visualizer.
    """
    router = APIRouter(dependencies=[Depends(bearer), Depends(require_authenticated_user)])
    maps = f"{owner_path}/custom-maps"
    vectors = f"{owner_path}/vector-layers"

    @router.get(maps, response_model=list[CustomMapOut], tags=["Custom Maps"])
    @_named(f"list_{names}custom_maps")
    def list_maps(owner: Owner = Depends(reader), db: Session = Depends(get_db)):
        return service.list_custom_maps(db, owner.layer_owner)

    @router.post(maps, response_model=CustomMapOut, status_code=201, tags=["Custom Maps"])
    @_named(f"create_{names}custom_map")
    def create_map(
        payload: CustomMapCreate, owner: Owner = Depends(admin), db: Session = Depends(get_db)
    ):
        _require_internal_storage_allowed(payload.internal_storage, owner)
        _require_tiler_allowed(owner)
        try:
            created = service.create_custom_map(db, owner.layer_owner, payload)
        except service.DuplicateCustomMapName as exc:
            raise _duplicate_name(exc) from exc
        if on_created:
            on_created(db, owner, created)
        return created

    @router.patch(f"{maps}/{{map_id}}", response_model=CustomMapOut, tags=["Custom Maps"])
    @_named(f"update_{names}custom_map")
    def update_map(
        map_id: int,
        payload: CustomMapUpdate,
        owner: Owner = Depends(admin),
        db: Session = Depends(get_db),
    ):
        _require_internal_storage_allowed(payload.internal_storage, owner)
        _require_tiler_allowed(owner)
        try:
            cm = service.update_custom_map(db, owner.layer_owner, map_id, payload)
        except service.DuplicateCustomMapName as exc:
            raise _duplicate_name(exc) from exc
        if cm is None:
            raise HTTPException(status_code=404, detail="Custom map not found")
        return cm

    @router.delete(f"{maps}/{{map_id}}", status_code=204, tags=["Custom Maps"])
    @_named(f"delete_{names}custom_map")
    def delete_map(map_id: int, owner: Owner = Depends(admin), db: Session = Depends(get_db)):
        if not service.delete_custom_map(db, owner.layer_owner, map_id):
            raise HTTPException(status_code=404, detail="Custom map not found")
        return Response(status_code=204)

    @router.get(vectors, response_model=list[VectorLayerOut], tags=["Vector Layers"])
    @_named(f"list_{names}vector_layers")
    def list_vectors(owner: Owner = Depends(reader), db: Session = Depends(get_db)):
        return service.list_vector_layers(db, owner.layer_owner)

    @router.post(vectors, response_model=VectorLayerOut, status_code=201, tags=["Vector Layers"])
    @_named(f"create_{names}vector_layer")
    def create_vector(
        payload: VectorLayerCreate, owner: Owner = Depends(admin), db: Session = Depends(get_db)
    ):
        created = service.create_vector_layer(db, owner.layer_owner, payload)
        if on_created:
            on_created(db, owner, created)
        return created

    @router.patch(f"{vectors}/{{layer_id}}", response_model=VectorLayerOut, tags=["Vector Layers"])
    @_named(f"update_{names}vector_layer")
    def update_vector(
        layer_id: int,
        payload: VectorLayerUpdate,
        owner: Owner = Depends(admin),
        db: Session = Depends(get_db),
    ):
        layer = service.update_vector_layer(db, owner.layer_owner, layer_id, payload)
        if layer is None:
            raise HTTPException(status_code=404, detail="Vector layer not found")
        return layer

    @router.delete(f"{vectors}/{{layer_id}}", status_code=204, tags=["Vector Layers"])
    @_named(f"delete_{names}vector_layer")
    def delete_vector(layer_id: int, owner: Owner = Depends(admin), db: Session = Depends(get_db)):
        if not service.delete_vector_layer(db, owner.layer_owner, layer_id):
            raise HTTPException(status_code=404, detail="Vector layer not found")
        return Response(status_code=204)

    return router


def _join_visualizer_overlays(db: Session, owner: Owner, layer: CustomMap | VectorLayer) -> None:
    assert isinstance(owner, Visualizer)  # noqa: S101
    if isinstance(layer, CustomMap):
        visualizers_service.link_owned_overlay(db, owner, custom_map_id=layer.id)
    else:
        visualizers_service.link_owned_overlay(db, owner, vector_layer_id=layer.id)


router = APIRouter()
router.include_router(
    _owner_routes(
        "/campaigns/{campaign_id}",
        reader=require_campaign_access,
        admin=require_campaign_admin,
        names="",
    )
)
router.include_router(
    _owner_routes(
        "/visualizers/{visualizer_id}",
        reader=require_visualizer_admin,
        admin=require_visualizer_admin,
        names="visualizer_",
        on_created=_join_visualizer_overlays,
    )
)

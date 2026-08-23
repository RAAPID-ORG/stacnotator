from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_authenticated_user
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.config import get_settings
from src.custom_layers import service
from src.custom_layers.schemas import (
    CustomMapCreate,
    CustomMapOut,
    CustomMapUpdate,
    VectorLayerCreate,
    VectorLayerOut,
    VectorLayerUpdate,
)
from src.database import get_db
from src.layers import LayerOwner
from src.visualizers import service as visualizers_service
from src.visualizers.dependencies import require_visualizer_admin
from src.visualizers.models import Visualizer

bearer = HTTPBearer()

custom_maps_router = APIRouter(
    prefix="/campaigns/{campaign_id}/custom-maps",
    tags=["Custom Maps"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


def _require_internal_storage_allowed(internal_storage: bool | None, owner) -> None:
    """Only organizations cleared for it may point a map at internal
    (managed-identity) storage. Takes whatever owns the map - both a campaign
    and a visualizer reach their organization the same way."""
    if internal_storage and not owner.project.organization.allows_internal_storage:
        raise HTTPException(
            status_code=403,
            detail="This organization cannot mark a custom map as internal storage",
        )


def _require_tiler_allowed(owner) -> None:
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


@custom_maps_router.get("", response_model=list[CustomMapOut])
def list_custom_maps(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_access),
    db: Session = Depends(get_db),
):
    return service.list_custom_maps(db, LayerOwner(campaign_id=campaign_id))


@custom_maps_router.post("", response_model=CustomMapOut, status_code=201)
def create_custom_map(
    campaign_id: int,
    payload: CustomMapCreate,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    _require_internal_storage_allowed(payload.internal_storage, campaign)
    _require_tiler_allowed(campaign)
    try:
        return service.create_custom_map(db, LayerOwner(campaign_id=campaign_id), payload)
    except service.DuplicateCustomMapName as exc:
        raise HTTPException(
            status_code=409, detail="A custom map with this name already exists"
        ) from exc


@custom_maps_router.patch("/{map_id}", response_model=CustomMapOut)
def update_custom_map(
    campaign_id: int,
    map_id: int,
    payload: CustomMapUpdate,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    _require_internal_storage_allowed(payload.internal_storage, campaign)
    _require_tiler_allowed(campaign)
    try:
        cm = service.update_custom_map(db, LayerOwner(campaign_id=campaign_id), map_id, payload)
    except service.DuplicateCustomMapName as exc:
        raise HTTPException(
            status_code=409, detail="A custom map with this name already exists"
        ) from exc
    if cm is None:
        raise HTTPException(status_code=404, detail="Custom map not found")
    return cm


@custom_maps_router.delete("/{map_id}", status_code=204)
def delete_custom_map(
    campaign_id: int,
    map_id: int,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    if not service.delete_custom_map(db, LayerOwner(campaign_id=campaign_id), map_id):
        raise HTTPException(status_code=404, detail="Custom map not found")
    return Response(status_code=204)


vector_layers_router = APIRouter(
    prefix="/campaigns/{campaign_id}/vector-layers",
    tags=["Vector Layers"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


@vector_layers_router.get("", response_model=list[VectorLayerOut])
def list_vector_layers(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_access),
    db: Session = Depends(get_db),
):
    return service.list_vector_layers(db, LayerOwner(campaign_id=campaign_id))


@vector_layers_router.post("", response_model=VectorLayerOut, status_code=201)
def create_vector_layer(
    campaign_id: int,
    payload: VectorLayerCreate,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    return service.create_vector_layer(db, LayerOwner(campaign_id=campaign_id), payload)


@vector_layers_router.patch("/{layer_id}", response_model=VectorLayerOut)
def update_vector_layer(
    campaign_id: int,
    layer_id: int,
    payload: VectorLayerUpdate,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    layer = service.update_vector_layer(db, LayerOwner(campaign_id=campaign_id), layer_id, payload)
    if layer is None:
        raise HTTPException(status_code=404, detail="Vector layer not found")
    return layer


@vector_layers_router.delete("/{layer_id}", status_code=204)
def delete_vector_layer(
    campaign_id: int,
    layer_id: int,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    if not service.delete_vector_layer(db, LayerOwner(campaign_id=campaign_id), layer_id):
        raise HTTPException(status_code=404, detail="Vector layer not found")
    return Response(status_code=204)


router = APIRouter()
router.include_router(custom_maps_router)
router.include_router(vector_layers_router)


# Overlays set up on a visualizer rather than on a campaign. Same layers, same
# service, same organization guards; only the owner and the gate differ.
visualizer_maps_router = APIRouter(
    prefix="/visualizers/{visualizer_id}/custom-maps",
    tags=["Custom Maps"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)

visualizer_vectors_router = APIRouter(
    prefix="/visualizers/{visualizer_id}/vector-layers",
    tags=["Vector Layers"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


@visualizer_maps_router.get("", response_model=list[CustomMapOut])
def list_visualizer_custom_maps(
    visualizer_id: int,
    visualizer: Visualizer = Depends(require_visualizer_admin),
    db: Session = Depends(get_db),
):
    return service.list_custom_maps(db, LayerOwner(visualizer_id=visualizer_id))


@visualizer_maps_router.post("", response_model=CustomMapOut, status_code=201)
def create_visualizer_custom_map(
    visualizer_id: int,
    payload: CustomMapCreate,
    visualizer: Visualizer = Depends(require_visualizer_admin),
    db: Session = Depends(get_db),
):
    _require_internal_storage_allowed(payload.internal_storage, visualizer)
    _require_tiler_allowed(visualizer)
    try:
        created = service.create_custom_map(db, LayerOwner(visualizer_id=visualizer_id), payload)
    except service.DuplicateCustomMapName as exc:
        raise HTTPException(
            status_code=409, detail="A custom map with this name already exists"
        ) from exc
    visualizers_service.link_owned_overlay(db, visualizer, custom_map_id=created.id)
    return created


@visualizer_maps_router.patch("/{map_id}", response_model=CustomMapOut)
def update_visualizer_custom_map(
    visualizer_id: int,
    map_id: int,
    payload: CustomMapUpdate,
    visualizer: Visualizer = Depends(require_visualizer_admin),
    db: Session = Depends(get_db),
):
    _require_internal_storage_allowed(payload.internal_storage, visualizer)
    _require_tiler_allowed(visualizer)
    try:
        cm = service.update_custom_map(db, LayerOwner(visualizer_id=visualizer_id), map_id, payload)
    except service.DuplicateCustomMapName as exc:
        raise HTTPException(
            status_code=409, detail="A custom map with this name already exists"
        ) from exc
    if cm is None:
        raise HTTPException(status_code=404, detail="Custom map not found")
    return cm


@visualizer_maps_router.delete("/{map_id}", status_code=204)
def delete_visualizer_custom_map(
    visualizer_id: int,
    map_id: int,
    visualizer: Visualizer = Depends(require_visualizer_admin),
    db: Session = Depends(get_db),
):
    if not service.delete_custom_map(db, LayerOwner(visualizer_id=visualizer_id), map_id):
        raise HTTPException(status_code=404, detail="Custom map not found")
    return Response(status_code=204)


@visualizer_vectors_router.get("", response_model=list[VectorLayerOut])
def list_visualizer_vector_layers(
    visualizer_id: int,
    visualizer: Visualizer = Depends(require_visualizer_admin),
    db: Session = Depends(get_db),
):
    return service.list_vector_layers(db, LayerOwner(visualizer_id=visualizer_id))


@visualizer_vectors_router.post("", response_model=VectorLayerOut, status_code=201)
def create_visualizer_vector_layer(
    visualizer_id: int,
    payload: VectorLayerCreate,
    visualizer: Visualizer = Depends(require_visualizer_admin),
    db: Session = Depends(get_db),
):
    created = service.create_vector_layer(db, LayerOwner(visualizer_id=visualizer_id), payload)
    visualizers_service.link_owned_overlay(db, visualizer, vector_layer_id=created.id)
    return created


@visualizer_vectors_router.patch("/{layer_id}", response_model=VectorLayerOut)
def update_visualizer_vector_layer(
    visualizer_id: int,
    layer_id: int,
    payload: VectorLayerUpdate,
    visualizer: Visualizer = Depends(require_visualizer_admin),
    db: Session = Depends(get_db),
):
    layer = service.update_vector_layer(
        db, LayerOwner(visualizer_id=visualizer_id), layer_id, payload
    )
    if layer is None:
        raise HTTPException(status_code=404, detail="Vector layer not found")
    return layer


@visualizer_vectors_router.delete("/{layer_id}", status_code=204)
def delete_visualizer_vector_layer(
    visualizer_id: int,
    layer_id: int,
    visualizer: Visualizer = Depends(require_visualizer_admin),
    db: Session = Depends(get_db),
):
    if not service.delete_vector_layer(db, LayerOwner(visualizer_id=visualizer_id), layer_id):
        raise HTTPException(status_code=404, detail="Vector layer not found")
    return Response(status_code=204)


router.include_router(visualizer_maps_router)
router.include_router(visualizer_vectors_router)

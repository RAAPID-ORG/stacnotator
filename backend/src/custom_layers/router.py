from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_approved_user
from src.auth.models import User
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
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
from src.routing import FunctionNameOperationIdRoute

bearer = HTTPBearer()

custom_maps_router = APIRouter(
    prefix="/campaigns/{campaign_id}/custom-maps",
    tags=["Custom Maps"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
    route_class=FunctionNameOperationIdRoute,
)


def _require_internal_for_internal_storage(internal_storage: bool | None, user: User) -> None:
    """Only internal staff may point a map at internal (managed-identity) storage."""
    if internal_storage and not user.is_internal:
        raise HTTPException(
            status_code=403,
            detail="Only internal users can mark a custom map as internal storage",
        )


@custom_maps_router.get("", response_model=list[CustomMapOut])
def list_custom_maps(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_access),
    db: Session = Depends(get_db),
):
    return service.list_custom_maps(db, campaign_id)


@custom_maps_router.post("", response_model=CustomMapOut, status_code=201)
def create_custom_map(
    campaign_id: int,
    payload: CustomMapCreate,
    campaign: Campaign = Depends(require_campaign_admin),
    user: User = Depends(require_approved_user),
    db: Session = Depends(get_db),
):
    _require_internal_for_internal_storage(payload.internal_storage, user)
    try:
        return service.create_custom_map(db, campaign_id, payload)
    except service.DuplicateCustomMapName as exc:
        raise HTTPException(
            status_code=409, detail="A custom map with this name already exists"
        ) from exc
    except service.InvalidRenderConfig as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@custom_maps_router.patch("/{map_id}", response_model=CustomMapOut)
def update_custom_map(
    campaign_id: int,
    map_id: int,
    payload: CustomMapUpdate,
    campaign: Campaign = Depends(require_campaign_admin),
    user: User = Depends(require_approved_user),
    db: Session = Depends(get_db),
):
    _require_internal_for_internal_storage(payload.internal_storage, user)
    try:
        cm = service.update_custom_map(db, campaign_id, map_id, payload)
    except service.DuplicateCustomMapName as exc:
        raise HTTPException(
            status_code=409, detail="A custom map with this name already exists"
        ) from exc
    except service.InvalidRenderConfig as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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
    if not service.delete_custom_map(db, campaign_id, map_id):
        raise HTTPException(status_code=404, detail="Custom map not found")
    return Response(status_code=204)


vector_layers_router = APIRouter(
    prefix="/campaigns/{campaign_id}/vector-layers",
    tags=["Vector Layers"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
    route_class=FunctionNameOperationIdRoute,
)


@vector_layers_router.get("", response_model=list[VectorLayerOut])
def list_vector_layers(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_access),
    db: Session = Depends(get_db),
):
    return service.list_vector_layers(db, campaign_id)


@vector_layers_router.post("", response_model=VectorLayerOut, status_code=201)
def create_vector_layer(
    campaign_id: int,
    payload: VectorLayerCreate,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    return service.create_vector_layer(db, campaign_id, payload)


@vector_layers_router.patch("/{layer_id}", response_model=VectorLayerOut)
def update_vector_layer(
    campaign_id: int,
    layer_id: int,
    payload: VectorLayerUpdate,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    layer = service.update_vector_layer(db, campaign_id, layer_id, payload)
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
    if not service.delete_vector_layer(db, campaign_id, layer_id):
        raise HTTPException(status_code=404, detail="Vector layer not found")
    return Response(status_code=204)


router = APIRouter()
router.include_router(custom_maps_router)
router.include_router(vector_layers_router)

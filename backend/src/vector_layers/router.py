from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_approved_user
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.database import get_db
from src.utils import FunctionNameOperationIdRoute
from src.vector_layers import service
from src.vector_layers.schemas import (
    VectorLayerCreate,
    VectorLayerOut,
    VectorLayerUpdate,
)

bearer = HTTPBearer()

router = APIRouter(
    prefix="/campaigns/{campaign_id}/vector-layers",
    tags=["Vector Layers"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
    route_class=FunctionNameOperationIdRoute,
)


@router.get("", response_model=list[VectorLayerOut])
def list_vector_layers(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_access),
    db: Session = Depends(get_db),
):
    return service.list_vector_layers(db, campaign_id)


@router.post("", response_model=VectorLayerOut, status_code=201)
def create_vector_layer(
    campaign_id: int,
    payload: VectorLayerCreate,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    return service.create_vector_layer(db, campaign_id, payload)


@router.patch("/{layer_id}", response_model=VectorLayerOut)
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


@router.delete("/{layer_id}", status_code=204)
def delete_vector_layer(
    campaign_id: int,
    layer_id: int,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    if not service.delete_vector_layer(db, campaign_id, layer_id):
        raise HTTPException(status_code=404, detail="Vector layer not found")
    return Response(status_code=204)

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_approved_user
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.custom_maps import service
from src.custom_maps.schemas import CustomMapCreate, CustomMapOut, CustomMapUpdate
from src.database import get_db
from src.utils import FunctionNameOperationIdRoute

bearer = HTTPBearer()

router = APIRouter(
    prefix="/campaigns/{campaign_id}/custom-maps",
    tags=["Custom Maps"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
    route_class=FunctionNameOperationIdRoute,
)


@router.get("", response_model=list[CustomMapOut])
def list_custom_maps(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_access),
    db: Session = Depends(get_db),
):
    return service.list_custom_maps(db, campaign_id)


@router.post("", response_model=CustomMapOut, status_code=201)
def create_custom_map(
    campaign_id: int,
    payload: CustomMapCreate,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    return service.create_custom_map(db, campaign_id, payload)


@router.patch("/{map_id}", response_model=CustomMapOut)
def update_custom_map(
    campaign_id: int,
    map_id: int,
    payload: CustomMapUpdate,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    cm = service.update_custom_map(db, campaign_id, map_id, payload)
    if cm is None:
        raise HTTPException(status_code=404, detail="Custom map not found")
    return cm


@router.delete("/{map_id}", status_code=204)
def delete_custom_map(
    campaign_id: int,
    map_id: int,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    if not service.delete_custom_map(db, campaign_id, map_id):
        raise HTTPException(status_code=404, detail="Custom map not found")
    return Response(status_code=204)

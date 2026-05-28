from urllib.parse import urlencode
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_approved_user
from src.auth.models import User
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.custom_maps import service
from src.custom_maps.models import STATUS_READY, CustomMap
from src.custom_maps.schemas import (
    CustomMapCreate,
    CustomMapOut,
    CustomMapUpdate,
    CustomMapUploadOut,
)
from src.database import get_db
from src.utils import FunctionNameOperationIdRoute


def _to_out(custom_map: CustomMap) -> CustomMapOut:
    out = CustomMapOut.model_validate(custom_map)
    if custom_map.status == STATUS_READY:
        out.tile_url_template = _build_tile_url(custom_map)
    return out


def _build_tile_url(custom_map: CustomMap) -> str:
    # TiTiler's TilerFactory mounts tile routes under /tiles/{tileMatrixSetId}/...
    base = f"/api/custom-map/{custom_map.id}/tiles/WebMercatorQuad/{{z}}/{{x}}/{{y}}.png"
    params = custom_map.viz_params or {}
    flat = [(k, v) for k, v in params.items() if v not in (None, "")]
    if not flat:
        return base
    return f"{base}?{urlencode(flat, doseq=True)}"


bearer = HTTPBearer()
router = APIRouter(
    prefix="/campaigns/{campaign_id}/custom-maps",
    tags=["CustomMaps"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
    route_class=FunctionNameOperationIdRoute,
)


@router.get("/", response_model=list[CustomMapOut])
def list_custom_maps(
    campaign: Campaign = Depends(require_campaign_access),
    db: Session = Depends(get_db),
):
    return [_to_out(o) for o in service.list_for_campaign(db, campaign.id)]


@router.get("/{custom_map_id}", response_model=CustomMapOut)
def get_custom_map(
    custom_map_id: UUID,
    campaign: Campaign = Depends(require_campaign_access),
    db: Session = Depends(get_db),
):
    return _to_out(service.get_for_campaign(db, campaign.id, custom_map_id))


@router.post("/", response_model=CustomMapUploadOut, status_code=201)
def create_custom_map(
    req: CustomMapCreate,
    campaign: Campaign = Depends(require_campaign_admin),
    user: User = Depends(require_approved_user),
    db: Session = Depends(get_db),
):
    custom_map, upload_url, upload_path, expires_in = service.create(
        db,
        campaign_id=campaign.id,
        user_id=user.id,
        name=req.name,
        original_filename=req.original_filename,
    )
    return CustomMapUploadOut(
        custom_map=_to_out(custom_map),
        upload_url=upload_url,
        upload_path=upload_path,
        expires_in=expires_in,
    )


@router.post("/{custom_map_id}/complete", response_model=CustomMapOut)
def complete_custom_map_upload(
    custom_map_id: UUID,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    return _to_out(service.complete_upload(db, campaign.id, custom_map_id))


@router.patch("/{custom_map_id}", response_model=CustomMapOut)
def update_custom_map(
    custom_map_id: UUID,
    req: CustomMapUpdate,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    return _to_out(
        service.update(
            db,
            campaign_id=campaign.id,
            custom_map_id=custom_map_id,
            name=req.name,
            display_order=req.display_order,
            viz_params=req.viz_params,
        )
    )


@router.delete("/{custom_map_id}", status_code=204)
def delete_custom_map(
    custom_map_id: UUID,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    service.delete(db, campaign.id, custom_map_id)

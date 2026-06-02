import contextlib
import uuid as _uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth.dependencies import require_approved_user
from src.auth.models import User
from src.campaigns.dependencies import require_campaign_access
from src.campaigns.models import Campaign
from src.config import get_settings
from src.database import get_db
from src.imagery.models import CustomMap
from src.imagery.storage import AzureStorage, LocalStorage, get_storage
from src.utils import FunctionNameOperationIdRoute

bearer = HTTPBearer()
router = APIRouter(
    tags=["CustomMaps"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
    route_class=FunctionNameOperationIdRoute,
)


class PresignUploadResponse(BaseModel):
    key: str
    upload_url: str
    method: str


class CustomMapCreate(BaseModel):
    name: str
    key: str
    viz_params: dict | None = None


class VizParamsUpdate(BaseModel):
    viz_params: dict


class CustomMapOut(BaseModel):
    id: _uuid.UUID
    name: str
    status: str
    band_count: int | None
    nodata: float | None
    bounds: dict | None
    viz_params: dict | None
    error: str | None

    model_config = {"from_attributes": True}


@router.post("/{campaign_id}/custom-maps/request-upload", response_model=PresignUploadResponse)
def request_upload(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_access),
):
    """Returns the URL where a custom map should be uploaded to. Client should upload
    directly to there."""
    key = f"campaigns/{campaign_id}/custom-maps/{_uuid.uuid4()}.tif"

    storage = get_storage()
    if isinstance(storage, AzureStorage):
        upload_url, method = storage.upload_url(key)
    else:
        # Local dev: client posts to the backend which saves to the shared volume
        upload_url = f"/api/{campaign_id}/custom-maps/upload-local?key={quote(key)}"
        method = "POST"

    return {"key": key, "upload_url": upload_url, "method": method}


@router.post("/{campaign_id}/custom-maps/upload-local")
async def upload_local(
    campaign_id: int,
    key: str = Query(...),
    file: UploadFile = File(...),
    campaign: Campaign = Depends(require_campaign_access),
):
    """Only used for local dev"""
    settings = get_settings()
    if settings.STORAGE_PROVIDER != "local":
        raise HTTPException(
            status_code=400, detail="Local upload only available when STORAGE_PROVIDER=local"
        )

    storage = get_storage()
    if not isinstance(storage, LocalStorage):
        raise HTTPException(status_code=400, detail="Storage misconfiguration")

    if not key.startswith(f"campaigns/{campaign_id}/"):
        raise HTTPException(status_code=400, detail="Invalid storage key")

    content = await file.read()
    storage.save(key, content)
    return {"key": key}


@router.post("/{campaign_id}/custom-maps", status_code=201, response_model=CustomMapOut)
def create_custom_map(
    campaign_id: int,
    body: CustomMapCreate,
    campaign: Campaign = Depends(require_campaign_access),
    user: User = Depends(require_approved_user),
    db: Session = Depends(get_db),
):
    if not body.key.startswith(f"campaigns/{campaign_id}/"):
        raise HTTPException(status_code=400, detail="Invalid storage key")

    if db.query(CustomMap).filter_by(campaign_id=campaign_id, name=body.name).first():
        raise HTTPException(
            status_code=409,
            detail=f"A custom map named '{body.name}' already exists in this campaign",
        )

    custom_map = CustomMap(
        campaign_id=campaign_id,
        uploaded_by=user.id,
        name=body.name,
        original_key=body.key,
        viz_params=body.viz_params,
        status="pending_processing",
    )
    db.add(custom_map)
    db.commit()
    db.refresh(custom_map)
    return custom_map


@router.patch("/{campaign_id}/custom-maps/{map_id}/viz-params", response_model=CustomMapOut)
def update_viz_params(
    campaign_id: int,
    map_id: _uuid.UUID,
    body: VizParamsUpdate,
    campaign: Campaign = Depends(require_campaign_access),
    db: Session = Depends(get_db),
):
    custom_map = db.query(CustomMap).filter_by(id=map_id, campaign_id=campaign_id).first()
    if not custom_map:
        raise HTTPException(status_code=404, detail="Custom map not found")
    custom_map.viz_params = body.viz_params
    db.commit()
    db.refresh(custom_map)
    return custom_map


@router.get("/{campaign_id}/custom-maps", response_model=list[CustomMapOut])
def list_custom_maps(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_access),
    db: Session = Depends(get_db),
):
    return (
        db.query(CustomMap).filter_by(campaign_id=campaign_id).order_by(CustomMap.created_at).all()
    )


@router.delete("/{campaign_id}/custom-maps/{map_id}", status_code=204)
def delete_custom_map(
    campaign_id: int,
    map_id: _uuid.UUID,
    campaign: Campaign = Depends(require_campaign_access),
    db: Session = Depends(get_db),
):
    custom_map = db.query(CustomMap).filter_by(id=map_id, campaign_id=campaign_id).first()
    if not custom_map:
        raise HTTPException(status_code=404, detail="Custom map not found")

    storage = get_storage()
    for key in filter(None, [custom_map.original_key, custom_map.cog_key]):
        with contextlib.suppress(Exception):
            storage.delete(key)

    db.delete(custom_map)
    db.commit()

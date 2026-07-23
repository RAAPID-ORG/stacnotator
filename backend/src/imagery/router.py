from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_approved_user
from src.auth.models import User
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.canvas import service as canvas_service
from src.canvas.schemas import CanvasLayoutCreateRequest
from src.database import get_db
from src.imagery import registration, service
from src.imagery.schemas import (
    AllowedTilersOut,
    ApiKeyStatusOut,
    ApiKeyUpdate,
    ImageryEditorStateCreate,
    TilerOption,
)
from src.routing import FunctionNameOperationIdRoute
from src.tilers import registry

bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    tags=["Imagery"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
    route_class=FunctionNameOperationIdRoute,
)


def _require_internal_for_internal_storage(
    editor_state: ImageryEditorStateCreate, user: User
) -> None:
    """Only internal staff may point a collection at internal (managed-identity) storage."""
    if user.is_internal:
        return
    for source in editor_state.sources:
        for col in source.collections:
            if col.stac_config and col.stac_config.internal_storage:
                raise HTTPException(
                    status_code=403,
                    detail="Only internal users can mark imagery as internal storage",
                )


@router.get("/imagery/tilers", response_model=AllowedTilersOut)
def list_tilers(user: User = Depends(require_approved_user)):
    """Tilers the current user may use."""
    allowed = set(user.allowed_tilers)
    return AllowedTilersOut(
        tilers=[
            TilerOption(name=t.name, kind=t.kind, url=t.url, is_default=t.is_default)
            for t in registry.all_tilers()
            if t.name in allowed
        ]
    )


@router.post("/{campaign_id}/imagery", status_code=201)
def create_imagery(
    campaign_id: int,
    editor_state: ImageryEditorStateCreate,
    campaign: Campaign = Depends(require_campaign_admin),
    user: User = Depends(require_approved_user),
    db: Session = Depends(get_db),
):
    """Create imagery for a fresh campaign. Used by the campaign-create flow."""
    _require_internal_for_internal_storage(editor_state, user)
    result = service.create_imagery_from_editor_state(
        db,
        campaign=campaign,
        editor_state=editor_state,
        user=user,
    )
    db.commit()
    response = {
        "sources": len(result["sources"]),
        "views": len(result["views"]),
        "basemaps": len(result["basemaps"]),
    }
    errors = result.get("registration_errors", [])
    if errors:
        response["registration_errors"] = errors
    return response


@router.put("/{campaign_id}/imagery")
def save_imagery(
    campaign_id: int,
    editor_state: ImageryEditorStateCreate,
    campaign: Campaign = Depends(require_campaign_admin),
    user: User = Depends(require_approved_user),
    db: Session = Depends(get_db),
):
    """Upsert the campaign's full imagery editor state. Used by the settings
    edit flow's Save button - reconciles adds/updates/deletes across sources,
    collections, slices, views, and basemaps in a single transaction."""
    _require_internal_for_internal_storage(editor_state, user)
    result = service.save_imagery_editor_state(
        db,
        campaign=campaign,
        editor_state=editor_state,
        user=user,
    )

    pending = result["pending_registrations"]
    if pending:
        campaign.registration_status = "registering"
        campaign.registration_errors = None
    db.commit()
    if pending:
        registration.spawn_background_mosaic_registration(campaign.id, pending, result["bbox"])
    return {
        "sources": len(result["sources"]),
        "views": len(result["views"]),
        "basemaps": len(result["basemaps"]),
    }


@router.post("/{campaign_id}/new-layout", status_code=201)
def create_new_canvas_layout(
    canvas_layout_req: CanvasLayoutCreateRequest,
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
    user: User = Depends(require_approved_user),
):
    result = canvas_service.save_canvas_layouts(
        db=db,
        campaign_id=campaign_id,
        view_id=canvas_layout_req.view_id,
        layout_data=canvas_layout_req.layout,
        should_be_default=canvas_layout_req.should_be_default,
        user_id=user.id,
    )
    return result


@router.post("/{campaign_id}/imagery/collections/{collection_id}/refresh")
def refresh_collection_imagery(
    campaign_id: int,
    collection_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Re-search STAC catalog with stored params and update mosaic items."""
    bbox = [
        campaign.settings.bbox_west,
        campaign.settings.bbox_south,
        campaign.settings.bbox_east,
        campaign.settings.bbox_north,
    ]
    result = registration.refresh_collection_imagery(db, collection_id, bbox)
    db.commit()
    return result


@router.put("/{campaign_id}/imagery/basemaps/{basemap_id}/key", response_model=ApiKeyStatusOut)
def set_basemap_api_key(
    campaign_id: int,
    basemap_id: int,
    body: ApiKeyUpdate,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Store an encrypted provider API key for a basemap (campaign admin only). Write-only."""
    service.set_basemap_api_key(db, campaign_id, basemap_id, body.value)
    db.commit()
    return ApiKeyStatusOut(has_api_key=True)


@router.put("/{campaign_id}/imagery/sources/{source_id}/key", response_model=ApiKeyStatusOut)
def set_source_api_key(
    campaign_id: int,
    source_id: int,
    body: ApiKeyUpdate,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Store an encrypted provider API key for an imagery source (campaign admin only)."""
    service.set_source_api_key(db, campaign_id, source_id, body.value)
    db.commit()
    return ApiKeyStatusOut(has_api_key=True)

from fastapi import APIRouter, Depends
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_approved_user
from src.auth.models import User
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.database import get_db
from src.imagery import service
from src.imagery.schemas import (
    AllowedTilersOut,
    CanvasLayoutCreateRequest,
    ImageryEditorStateCreate,
    TilerOption,
)
from src.tiling import registry
from src.utils import FunctionNameOperationIdRoute

bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    tags=["Imagery"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
    route_class=FunctionNameOperationIdRoute,
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
    result = service.save_imagery_editor_state(
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


@router.post("/{campaign_id}/new-layout", status_code=201)
def create_new_canvas_layout(
    canvas_layout_req: CanvasLayoutCreateRequest,
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
    user: User = Depends(require_approved_user),
):
    result = service.create_new_canvas_layout(
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
    result = service.refresh_collection_imagery(db, collection_id, bbox)
    db.commit()
    return result

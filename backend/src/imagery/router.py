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
    CanvasLayoutCreateRequest,
    ImageryEditorStateCreate,
    ImagerySourceUpdate,
)
from src.utils import FunctionNameOperationIdRoute

bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    tags=["Imagery"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
    route_class=FunctionNameOperationIdRoute,
)


@router.post("/{campaign_id}/imagery", status_code=201)
def create_imagery(
    campaign_id: int,
    editor_state: ImageryEditorStateCreate,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    result = service.create_imagery_from_editor_state(
        db,
        campaign=campaign,
        editor_state=editor_state,
    )
    db.commit()
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
    result = service.create_new_canvas_layout(
        db=db,
        campaign_id=campaign_id,
        view_id=canvas_layout_req.view_id,
        layout_data=canvas_layout_req.layout,
        should_be_default=canvas_layout_req.should_be_default,
        user_id=user.id,
    )
    return result


@router.patch("/{campaign_id}/imagery/sources/{source_id}")
def update_source(
    campaign_id: int,
    source_id: int,
    body: ImagerySourceUpdate,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    return service.update_source(
        db=db,
        source_id=source_id,
        campaign_id=campaign_id,
        updates=body.model_dump(exclude_none=True),
    )


@router.delete("/{campaign_id}/imagery/sources/{source_id}", status_code=204)
def delete_source(
    campaign_id: int,
    source_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    service.delete_source(db=db, source_id=source_id, campaign_id=campaign_id)
    return

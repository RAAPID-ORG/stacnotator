from fastapi import APIRouter, Depends
from fastapi.security import HTTPBearer
from requests import Session

from src.auth.dependencies import require_approved_user
from src.auth.models import User
from src.campaigns.dependancies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.database import get_db
from src.imagery.schemas import ImageryBulkCreate, CanvasLayoutCreateRequest, CreateImageryResponse
from src.utils import FunctionNameOperationIdRoute

from src.imagery import service


bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    tags=["Imagery"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
    route_class=FunctionNameOperationIdRoute,
)


@router.post(
    "/{campaign_id}/imagery",
    response_model=CreateImageryResponse,
)
def create_imagery(
    campaign_id: int,
    imagery: ImageryBulkCreate,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    # TODO validate tile urls and search body and url
    new_items = service.create_imagery_with_layouts_bulk_no_commit(
        db,
        campaign=campaign,
        imagery_items=imagery.items,
    )
    db.commit()
    return {"new_items": new_items}


@router.post(
    "/{campaign_id}/new-layout",
    status_code=201,
)
def create_new_canvas_layout_for_imagery(
    canvas_layout_req: CanvasLayoutCreateRequest,
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
    user: User = Depends(require_approved_user),
):
    """
    Create or update canvas layout for imagery visualization.

    If should_be_default is True, requires campaign admin role and updates
    the default campaign-wide layout. Otherwise, creates/updates a personal
    layout for the authenticated user.
    """
    result = service.create_new_canvas_layout(
        db=db,
        campaign_id=campaign_id,
        imagery_id=canvas_layout_req.imagery_id,
        layout_data=canvas_layout_req.layout,
        should_be_default=canvas_layout_req.should_be_default,
        user_id=user.id,
    )

    return result


@router.delete("/{campaign_id}/imagery/{imagery_id}", status_code=204)
def delete_imagery(
    campaign_id: int,
    imagery_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """
    Delete an imagery entry and all associated data.
    """
    service.delete_imagery(
        db=db,
        imagery_id=imagery_id,
        campaign_id=campaign_id,
    )
    return

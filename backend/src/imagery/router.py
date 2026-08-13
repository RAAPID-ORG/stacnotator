from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src import background
from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.canvas import service as canvas_service
from src.canvas.schemas import CanvasLayoutCreateRequest
from src.database import get_db
from src.imagery import registration, service
from src.imagery.schemas import (
    ApiKeyStatusOut,
    ApiKeyUpdate,
    ImageryEditorStateCreate,
    ImageryViewCreate,
    ImageryViewOrderUpdate,
    ImageryViewOut,
    ImageryViewUpdate,
)

bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    tags=["Imagery"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


def _require_internal_storage_allowed(
    editor_state: ImageryEditorStateCreate, campaign: Campaign
) -> None:
    """Only organizations cleared for it may point a collection at internal
    (managed-identity) storage."""
    if campaign.project.organization.allows_internal_storage:
        return
    for source in editor_state.sources:
        for col in source.collections:
            if col.stac_config and col.stac_config.internal_storage:
                raise HTTPException(
                    status_code=403,
                    detail="This organization cannot mark imagery as internal storage",
                )


@router.put("/{campaign_id}/imagery")
def save_imagery(
    campaign_id: int,
    editor_state: ImageryEditorStateCreate,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    """Upsert the campaign's full imagery editor state. Used by the settings
    edit flow's Save button - reconciles adds/updates/deletes across sources,
    collections, slices, and basemaps in a single transaction."""
    _require_internal_storage_allowed(editor_state, campaign)
    result = service.save_imagery_editor_state(
        db,
        campaign=campaign,
        editor_state=editor_state,
    )

    pending = result["pending_registrations"]
    if pending:
        # Cycle-boundary clear, not a finished-work write: this commits before the
        # background thread spawns, so it cannot race finish_status_run's append.
        # Without it, stale errors from a prior failed registration would sit under
        # "registering" and then have new errors stacked on top indefinitely.
        background.begin_status_run(campaign, registration.REGISTRATION_RUN)
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
    user: User = Depends(require_authenticated_user),
):
    if canvas_layout_req.should_be_default:
        require_campaign_admin(campaign_id=campaign_id, db=db, user=user)
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
    """Re-search STAC catalog with stored params and re-ingest mosaic items.

    Ingest is a slow per-slice HTTP call to the tiler; it runs off the request
    path (see spawn_background_collection_refresh) so this transaction isn't
    held open across it.
    """
    # Cheap synchronous existence/config check before touching campaign status. A
    # bad or stale collection_id is the only realistic failure path left once
    # ingest moves off-thread (per-slice tiler failures are caught and logged
    # inside refresh_collection_imagery, never raised) - it must 404/400 here
    # rather than only surface later as a campaign-wide registration_status
    # "failed" that blocks annotation.
    registration.load_refreshable_collection(db, collection_id, campaign.id)
    bbox = [
        campaign.settings.bbox_west,
        campaign.settings.bbox_south,
        campaign.settings.bbox_east,
        campaign.settings.bbox_north,
    ]
    # Cycle-boundary clear, not a finished-work write: commits before the
    # background thread spawns, matching save_imagery's convention.
    background.begin_status_run(campaign, registration.REGISTRATION_RUN)
    campaign.registration_errors = None
    db.commit()
    registration.spawn_background_collection_refresh(campaign.id, collection_id, bbox)
    # Literal, not a re-read: expire_on_commit could reload the row after the
    # background thread has already flipped it to ready/failed.
    return {"registration_status": "registering"}


@router.post("/{campaign_id}/imagery/views", response_model=ImageryViewOut, status_code=201)
def create_imagery_view(
    campaign_id: int,
    payload: ImageryViewCreate,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Create a view with a default canvas layout showing every collection of
    its sources as a window (campaign admin only)."""
    return ImageryViewOut.from_orm(service.create_view(db, campaign, payload))


# Declared before /views/{view_id} so "order" is not captured by the int param.
@router.put("/{campaign_id}/imagery/views/order", status_code=204)
def reorder_imagery_views(
    campaign_id: int,
    payload: ImageryViewOrderUpdate,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Persist a full ordering of the campaign's views (campaign admin only)."""
    service.reorder_views(db, campaign, payload.view_ids)


@router.put("/{campaign_id}/imagery/views/{view_id}", response_model=ImageryViewOut)
def update_imagery_view(
    campaign_id: int,
    view_id: int,
    payload: ImageryViewUpdate,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Rename a view and/or replace its source membership; its canvas layouts
    follow the new eligible collection set (campaign admin only)."""
    return ImageryViewOut.from_orm(service.update_view(db, campaign, view_id, payload))


@router.delete("/{campaign_id}/imagery/views/{view_id}", status_code=204)
def delete_imagery_view(
    campaign_id: int,
    view_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Delete a view and its canvas layouts (campaign admin only)."""
    service.delete_view(db, campaign, view_id)


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

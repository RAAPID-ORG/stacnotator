from fastapi import APIRouter, Depends
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src import background
from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.canvas import service as canvas_service
from src.canvas.schemas import CanvasLayoutCreateRequest
from src.database import get_db, release
from src.imagery import registration, service
from src.imagery.schemas import (
    ImageryEditorStateCreate,
    ImageryViewCreate,
    ImageryViewOrderUpdate,
    ImageryViewOut,
    ImageryViewUpdate,
)
from src.planet import scene_search
from src.planet.schemas import PlanetSceneLayersIn, PlanetSceneSearchIn, PlanetSceneSearchOut

bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    tags=["Imagery"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


@router.put("/{campaign_id}/imagery", status_code=204)
def save_imagery(
    campaign_id: int,
    editor_state: ImageryEditorStateCreate,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    """Upsert the campaign's full imagery editor state. Used by the settings
    edit flow's Save button - reconciles adds/updates/deletes across sources,
    collections, slices, and basemaps in a single transaction."""
    service.save_imagery_editor_state(db, campaign, editor_state)
    registration.commit_and_register(db, campaign, campaign.bbox)


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


@router.post("/{campaign_id}/imagery/sources/{source_id}/refresh", status_code=204)
def refresh_source_imagery(
    campaign_id: int,
    source_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Re-run every STAC search this source was built from and re-ingest what
    comes back, so a season that has moved on picks up its newer imagery.

    Validated synchronously, then the slow per-slice tiler calls run in the
    background.
    """
    collection_ids = registration.refreshable_collection_ids(db, source_id, campaign.id)
    background.begin_status_run(campaign, registration.REGISTRATION_RUN)
    campaign.registration_errors = None
    db.commit()
    registration.spawn_background_source_refresh(campaign.id, collection_ids, list(campaign.bbox))


@router.post(
    "/{campaign_id}/imagery/sources/{source_id}/planet-scenes/search",
    response_model=PlanetSceneSearchOut,
)
def search_planet_scenes(
    campaign_id: int,
    source_id: int,
    payload: PlanetSceneSearchIn,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    """Find which of the source's dates hold Planet scenes over this extent.

    An annotator's own action, not an admin's: a scene source is set up with dates
    only, and the area to search is wherever they are standing. Nothing is stored, so
    the answer is theirs alone and stale the moment they move on. Only the covers come
    back drawable; the other dates are minted by ``mint_planet_scene_layers``.
    """
    api_key, series = scene_search.scene_source(db, campaign.id, source_id)
    # Planet is a network call away, and the connection must not sit idle in a
    # transaction across it - see planet/router.py.
    release(db)
    return scene_search.search_planet_scenes_in_view(api_key, series, payload.bbox)


@router.post(
    "/{campaign_id}/imagery/sources/{source_id}/planet-scenes/layers",
    response_model=PlanetSceneSearchOut,
)
def mint_planet_scene_layers(
    campaign_id: int,
    source_id: int,
    payload: PlanetSceneLayersIn,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    """Tile layers for the dates the annotator is opening, over the same extent.

    The search says which dates hold imagery; this is what makes one drawable. Asked
    for a few at a time - the date being opened and the next ones along - so stepping
    through a window does not wait on the hundreds of dates nobody has looked at.
    """
    api_key, series = scene_search.scene_source(db, campaign.id, source_id)
    release(db)
    return scene_search.mint_planet_scene_layers(api_key, series, payload.bbox, payload.slice_ids)


@router.post("/{campaign_id}/imagery/views", response_model=ImageryViewOut, status_code=201)
def create_imagery_view(
    campaign_id: int,
    payload: ImageryViewCreate,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Create a view with a default canvas layout showing every collection of
    its sources as a window (campaign admin only)."""
    return ImageryViewOut.model_validate(service.create_view(db, campaign, payload))


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
    return ImageryViewOut.model_validate(service.update_view(db, campaign, view_id, payload))


@router.delete("/{campaign_id}/imagery/views/{view_id}", status_code=204)
def delete_imagery_view(
    campaign_id: int,
    view_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Delete a view and its canvas layouts (campaign admin only)."""
    service.delete_view(db, campaign, view_id)

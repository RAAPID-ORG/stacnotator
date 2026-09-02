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
from src.crypto import DecryptionError, decrypt
from src.database import get_db, release
from src.imagery import registration, service
from src.imagery.models import ImagerySource
from src.imagery.schemas import (
    ApiKeyStatusOut,
    ApiKeyUpdate,
    ImageryEditorStateCreate,
    ImageryViewCreate,
    ImageryViewOrderUpdate,
    ImageryViewOut,
    ImageryViewUpdate,
    PlanetSceneLayersIn,
    PlanetSceneSearchIn,
    PlanetSceneSearchOut,
)
from src.layers import LayerOwner
from src.organizations.schemas import OrganizationApiKeyOut, OrganizationApiKeysResponse

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

    pending = result["registrations"]
    if pending:
        # Cycle-boundary clear, not a finished-work write: this commits before the
        # background thread spawns, so it cannot race finish_status_run's append.
        # Without it, stale errors from a prior failed registration would sit under
        # "registering" and then have new errors stacked on top indefinitely.
        background.begin_status_run(campaign, registration.REGISTRATION_RUN)
        campaign.registration_errors = None
    db.commit()
    if pending:
        registration.spawn_background_registration(
            LayerOwner(campaign_id=campaign.id), pending, result["bbox"]
        )
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


@router.post("/{campaign_id}/imagery/sources/{source_id}/refresh")
def refresh_source_imagery(
    campaign_id: int,
    source_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Re-run every STAC search this source was built from and re-ingest what
    comes back, so a season that has moved on picks up its newer imagery.

    Same shape as the per-collection refresh: validate synchronously, then hand
    the slow per-slice tiler calls to a background run.
    """
    collection_ids = registration.refreshable_collection_ids(db, source_id, campaign.id)
    bbox = [
        campaign.settings.bbox_west,
        campaign.settings.bbox_south,
        campaign.settings.bbox_east,
        campaign.settings.bbox_north,
    ]
    background.begin_status_run(campaign, registration.REGISTRATION_RUN)
    campaign.registration_errors = None
    db.commit()
    registration.spawn_background_source_refresh(campaign.id, collection_ids, bbox)
    return {"registration_status": "registering"}


def _planet_scene_source(
    db: Session, campaign: Campaign, source_id: int
) -> tuple[str, list[service.PlanetSceneSeries]]:
    """The key to search with and the series to search, or the reason neither works."""
    source = db.get(ImagerySource, source_id)
    if source is None or source.campaign_id != campaign.id:
        raise HTTPException(status_code=404, detail="Imagery source not found")
    # A shared key with no host bound reads as no key at all - see ImagerySource. The
    # search itself would be safe (Planet's client pins the API host), but the layers it
    # mints are rendered through the proxy, which would refuse the key a moment later.
    key = source.provider_key
    if key is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "No usable Planet API key is configured for this source. A shared "
                "organization key also needs the tile host it may be sent to."
            ),
        )
    try:
        api_key = decrypt(key.ciphertext)
    except DecryptionError as e:
        raise HTTPException(
            status_code=500, detail="The source's Planet API key could not be read"
        ) from e

    series = service.planet_scene_series(db, source)
    if not series:
        raise HTTPException(status_code=400, detail="This source has no Planet scene series")
    return api_key, series


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
    api_key, series = _planet_scene_source(db, campaign, source_id)
    # Planet is a network call away, and the connection must not sit idle in a
    # transaction across it - see planet/router.py.
    release(db)
    return service.search_planet_scenes_in_view(api_key, series, payload.bbox)


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
    api_key, series = _planet_scene_source(db, campaign, source_id)
    release(db)
    return service.mint_planet_scene_layers(api_key, series, payload.bbox, payload.slice_ids)


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


@router.get("/{campaign_id}/imagery/organization-keys", response_model=OrganizationApiKeysResponse)
def list_campaign_organization_keys(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_admin),
):
    """The shared provider keys this campaign's organization has set up, so the
    imagery editor can offer them instead of asking for the secret again."""
    return OrganizationApiKeysResponse(
        items=[
            OrganizationApiKeyOut.model_validate(key) for key in service.organization_keys(campaign)
        ]
    )


@router.put("/{campaign_id}/imagery/basemaps/{basemap_id}/key", response_model=ApiKeyStatusOut)
def set_basemap_api_key(
    campaign_id: int,
    basemap_id: int,
    body: ApiKeyUpdate,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Point a basemap at a provider key: a literal one (encrypted here) or one
    of the organization's shared keys. Campaign admin only, write-only."""
    basemap = service.set_basemap_api_key(
        db,
        campaign,
        basemap_id,
        value=body.value,
        organization_api_key_id=body.organization_api_key_id,
    )
    db.commit()
    return ApiKeyStatusOut(
        has_api_key=True, organization_api_key_id=basemap.organization_api_key_id
    )


@router.put("/{campaign_id}/imagery/sources/{source_id}/key", response_model=ApiKeyStatusOut)
def set_source_api_key(
    campaign_id: int,
    source_id: int,
    body: ApiKeyUpdate,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """As above, for an imagery source."""
    source = service.set_source_api_key(
        db,
        campaign,
        source_id,
        value=body.value,
        organization_api_key_id=body.organization_api_key_id,
    )
    db.commit()
    return ApiKeyStatusOut(has_api_key=True, organization_api_key_id=source.organization_api_key_id)

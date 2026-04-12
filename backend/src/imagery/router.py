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
    ImageryCollectionUpdate,
    ImageryEditorStateCreate,
    ImagerySourceUpdate,
    ImageryViewAddRequest,
    ImageryViewUpdate,
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


@router.patch("/{campaign_id}/imagery/collections/{collection_id}")
def update_collection(
    campaign_id: int,
    collection_id: int,
    body: ImageryCollectionUpdate,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    return service.update_collection(
        db=db,
        collection_id=collection_id,
        campaign_id=campaign_id,
        updates=body.model_dump(exclude_none=True),
    )


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


@router.put("/{campaign_id}/imagery/collections/{collection_id}/viz-params")
def update_viz_params(
    campaign_id: int,
    collection_id: int,
    body: dict,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Update viz params for a collection and rebuild tile URLs.

    Body supports per-visualization params:
      {
        "visualizations": {
          "True Color": { "assets": [...], "rescale": "0,3000" },
          "NDVI": { "assets": ["B08"], "expression": "...", "colormap_name": "rdylgn" }
        },
        "cover_visualizations": { ... }  // optional overrides for cover slice
      }
    """
    service.update_collection_viz_params(
        db,
        collection_id,
        viz_by_name=body.get("visualizations", {}),
        cover_viz_by_name=body.get("cover_visualizations"),
    )
    db.commit()
    return {"status": "updated"}


@router.put("/{campaign_id}/imagery/collections/{collection_id}/tile-urls")
def update_tile_urls(
    campaign_id: int,
    collection_id: int,
    body: dict,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Update raw tile URLs for XYZ/manual collections.

    Body: { "tile_urls": { "True Color": "https://...", "NDVI": "https://..." } }
    """
    service.update_collection_tile_urls(
        db,
        collection_id,
        tile_urls_by_viz=body.get("tile_urls", {}),
    )
    db.commit()
    return {"status": "updated"}


# View endpoints


@router.post("/{campaign_id}/imagery/views")
def add_view(
    campaign_id: int,
    body: ImageryViewAddRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Add a new imagery view to an existing campaign."""
    return service.add_view(
        db=db,
        campaign_id=campaign_id,
        name=body.name,
        collection_refs=[r.model_dump() for r in body.collection_refs],
    )


@router.patch("/{campaign_id}/imagery/views/{view_id}")
def update_view(
    campaign_id: int,
    view_id: int,
    body: ImageryViewUpdate,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Update an imagery view (name, collection_refs)."""
    updates = body.model_dump(exclude_none=True)
    if "collection_refs" in updates:
        updates["collection_refs"] = [
            r.model_dump() if hasattr(r, "model_dump") else r for r in updates["collection_refs"]
        ]
    return service.update_view(
        db=db,
        view_id=view_id,
        campaign_id=campaign_id,
        updates=updates,
    )


@router.put("/{campaign_id}/imagery/views/reorder")
def reorder_views(
    campaign_id: int,
    body: dict,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Reorder views. Body: { "view_ids": [3, 1, 2] } - new display order."""
    view_ids = body.get("view_ids", [])
    service.reorder_views(db=db, campaign_id=campaign_id, view_ids=view_ids)
    return {"status": "updated"}


@router.delete("/{campaign_id}/imagery/views/{view_id}", status_code=204)
def delete_view(
    campaign_id: int,
    view_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Delete an imagery view."""
    service.delete_view(db=db, view_id=view_id, campaign_id=campaign_id)
    return

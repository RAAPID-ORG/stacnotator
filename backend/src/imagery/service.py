import logging
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from src.campaigns.models import Campaign, CampaignUser, CanvasLayout
from src.imagery.models import (
    Basemap,
    CollectionStacConfig,
    ImageryCollection,
    ImagerySlice,
    ImagerySource,
    ImageryView,
    SliceTileUrl,
    VisualizationTemplate,
)
from src.imagery.schemas import (
    BasemapCreate,
    CanvasLayoutCreate,
    ImageryEditorStateCreate,
    ImagerySourceCreate,
    ImageryViewCreate,
)
from src.imagery.stac_registration import register_collection_slices

logger = logging.getLogger(__name__)


# ============================================================================
# Imagery Creation (new model)
# ============================================================================


def create_imagery_from_editor_state(
    db: Session,
    *,
    campaign: Campaign,
    editor_state: ImageryEditorStateCreate,
) -> dict:
    """
    Persist the full imagery editor state (sources, views, basemaps) for a campaign.
    Handles frontend-to-DB id mapping so views can reference DB-assigned collection/source ids.

    Returns dict with keys 'sources', 'views', 'basemaps' containing ORM objects.
    Does NOT commit - caller is responsible for commit.
    """
    if not campaign.settings:
        raise HTTPException(status_code=404, detail="Campaign settings not found")

    bbox = [
        campaign.settings.bbox_west,
        campaign.settings.bbox_south,
        campaign.settings.bbox_east,
        campaign.settings.bbox_north,
    ]

    # Mapping: frontend temp id -> DB id
    source_id_map: dict[str, int] = {}  # fe_source_id -> db source id
    collection_id_map: dict[str, int] = {}  # fe_collection_id -> db collection id

    created_sources: list[ImagerySource] = []
    for src_idx, src_create in enumerate(editor_state.sources):
        source = _create_source(db, campaign.id, src_create, src_idx, bbox)
        db.flush()

        # Build id map using index as frontend key (frontend sends ordered lists)
        source_id_map[str(src_idx)] = source.id
        for col_idx, col in enumerate(source.collections):
            collection_id_map[f"{src_idx}:{col_idx}"] = col.id

        created_sources.append(source)

    created_basemaps = _create_basemaps(db, campaign.id, editor_state.basemaps)
    db.flush()

    created_views = _create_views(
        db,
        campaign.id,
        editor_state.views,
        editor_state.sources,
        source_id_map,
        collection_id_map,
    )
    db.flush()

    return {
        "sources": created_sources,
        "views": created_views,
        "basemaps": created_basemaps,
    }


def _create_source(
    db: Session,
    campaign_id: int,
    src: ImagerySourceCreate,
    src_idx: int,
    bbox: list[float],
) -> ImagerySource:
    """Create a single ImagerySource with all its children."""
    source = ImagerySource(
        campaign_id=campaign_id,
        name=src.name,
        crosshair_hex6=src.crosshair_hex6,
        default_zoom=src.default_zoom,
        display_order=src_idx,
    )
    db.add(source)
    db.flush()

    # Visualization templates
    for viz_idx, viz in enumerate(src.visualizations):
        db.add(
            VisualizationTemplate(
                source_id=source.id,
                name=viz.name,
                display_order=viz_idx,
            )
        )

    # Collections
    for col_idx, col_create in enumerate(src.collections):
        collection = ImageryCollection(
            source_id=source.id,
            name=col_create.name,
            cover_slice_index=col_create.cover_slice_index,
            display_order=col_idx,
        )
        db.add(collection)
        db.flush()

        # STAC config
        if col_create.stac_config:
            # Capture viz URL templates (with {searchId} placeholders) so we can
            # re-register later when the campaign bbox changes.
            viz_url_templates = (
                [
                    {"viz_name": vu.visualization_name, "url_template": vu.tile_url}
                    for vu in col_create.slices[0].tile_urls
                ]
                if col_create.slices and col_create.slices[0].tile_urls
                else None
            )
            db.add(
                CollectionStacConfig(
                    collection_id=collection.id,
                    registration_url=col_create.stac_config.registration_url,
                    search_body=col_create.stac_config.search_body,
                    viz_url_templates=viz_url_templates,
                    catalog_url=col_create.stac_config.catalog_url,
                    stac_collection_id=col_create.stac_config.stac_collection_id,
                    tile_provider=col_create.stac_config.tile_provider,
                    viz_params=(
                        col_create.stac_config.viz_params.model_dump(exclude_none=True)
                        if col_create.stac_config.viz_params
                        else None
                    ),
                )
            )

        # Slices
        for sl_idx, sl_create in enumerate(col_create.slices):
            slice_obj = ImagerySlice(
                collection_id=collection.id,
                name=sl_create.name,
                start_date=sl_create.start_date,
                end_date=sl_create.end_date,
                display_order=sl_idx,
            )
            db.add(slice_obj)
            db.flush()

            # Direct tile URLs (manual XYZ or stac_browser)
            for tile in sl_create.tile_urls:
                db.add(
                    SliceTileUrl(
                        slice_id=slice_obj.id,
                        visualization_name=tile.visualization_name,
                        tile_url=tile.tile_url,
                        tile_provider=tile.tile_provider,
                    )
                )

        # STAC registration: resolve tile URLs for all slices
        if col_create.stac_config and col_create.slices:
            _register_stac_collection(db, collection, col_create, src, bbox)

    db.flush()
    db.refresh(source)
    return source


def _register_stac_collection(
    db: Session,
    collection: ImageryCollection,
    col_create,
    src_create: ImagerySourceCreate,
    bbox: list[float],
) -> None:
    """Register STAC mosaics for a collection's slices and persist resolved tile URLs."""
    stac = col_create.stac_config
    if not stac:
        return

    # Build viz URL templates from the collection data
    viz_templates = (
        [
            {"viz_name": vu.visualization_name, "url_template": vu.tile_url}
            for vu in col_create.slices[0].tile_urls
        ]
        if col_create.slices and col_create.slices[0].tile_urls
        else []
    )

    # If no tile_urls on slices, try to use viz URLs from the stac config's first slice
    # (the frontend sends viz URL templates as tile_urls with {searchId} placeholders)
    if not viz_templates:
        return

    slice_descriptors = [
        {"index": i, "start_date": s.start_date, "end_date": s.end_date}
        for i, s in enumerate(col_create.slices)
    ]

    try:
        results = register_collection_slices(
            registration_url=stac.registration_url,
            search_body=stac.search_body,
            bbox=bbox,
            slices=slice_descriptors,
            viz_url_templates=viz_templates,
        )

        # Persist resolved URLs
        db_slices = (
            db.query(ImagerySlice)
            .filter(ImagerySlice.collection_id == collection.id)
            .order_by(ImagerySlice.display_order)
            .all()
        )

        for result in results:
            idx = result["slice_index"]
            if idx < len(db_slices):
                # Clear any template URLs and replace with resolved ones
                db.query(SliceTileUrl).filter(SliceTileUrl.slice_id == db_slices[idx].id).delete()
                for tile in result["tile_urls"]:
                    db.add(
                        SliceTileUrl(
                            slice_id=db_slices[idx].id,
                            visualization_name=tile["viz_name"],
                            tile_url=tile["url"],
                        )
                    )
    except Exception:
        logger.warning(
            "STAC registration failed for collection %s - tile URLs left as templates",
            collection.name,
            exc_info=True,
        )


# ============================================================================
# STAC Re-registration (bbox change)
# ============================================================================


def re_register_stac_collections(db: Session, campaign_id: int, bbox: list[float]) -> int:
    """
    Re-register STAC mosaics for every STAC-based collection in a campaign
    using a new bounding box.  Returns the number of collections updated.

    Requires that ``viz_url_templates`` was previously persisted on each
    ``CollectionStacConfig``.  Collections without stored templates are skipped.
    """
    sources = db.query(ImagerySource).filter(ImagerySource.campaign_id == campaign_id).all()

    updated = 0
    for source in sources:
        for collection in source.collections:
            stac = collection.stac_config
            if not stac or not stac.viz_url_templates:
                continue

            slices = (
                db.query(ImagerySlice)
                .filter(ImagerySlice.collection_id == collection.id)
                .order_by(ImagerySlice.display_order)
                .all()
            )
            if not slices:
                continue

            slice_descriptors = [
                {"index": i, "start_date": s.start_date, "end_date": s.end_date}
                for i, s in enumerate(slices)
            ]

            try:
                results = register_collection_slices(
                    registration_url=stac.registration_url,
                    search_body=stac.search_body,
                    bbox=bbox,
                    slices=slice_descriptors,
                    viz_url_templates=stac.viz_url_templates,
                )

                for result in results:
                    idx = result["slice_index"]
                    if idx < len(slices):
                        db.query(SliceTileUrl).filter(
                            SliceTileUrl.slice_id == slices[idx].id
                        ).delete()
                        for tile in result["tile_urls"]:
                            db.add(
                                SliceTileUrl(
                                    slice_id=slices[idx].id,
                                    visualization_name=tile["viz_name"],
                                    tile_url=tile["url"],
                                )
                            )
                updated += 1
            except Exception:
                logger.warning(
                    "STAC re-registration failed for collection %s (id=%s)",
                    collection.name,
                    collection.id,
                    exc_info=True,
                )

    return updated


def _create_basemaps(
    db: Session,
    campaign_id: int,
    basemaps: list[BasemapCreate],
) -> list[Basemap]:
    created = []
    for bm in basemaps:
        obj = Basemap(campaign_id=campaign_id, name=bm.name, url=bm.url)
        db.add(obj)
        created.append(obj)
    return created


def _create_views(
    db: Session,
    campaign_id: int,
    views: list[ImageryViewCreate],
    source_creates: list[ImagerySourceCreate],
    source_id_map: dict[str, int],
    collection_id_map: dict[str, int],
) -> list[ImageryView]:
    """
    Create views and map frontend temp ids to DB ids in collection_refs.

    The frontend sends collection_refs with source_id / collection_id as frontend temp strings.
    We map them to DB-assigned integer ids.
    """
    created = []
    for view_idx, view_create in enumerate(views):
        mapped_refs = []
        for ref in view_create.collection_refs:
            # Frontend sends source_id and collection_id as temp identifiers.
            # We need to map them to the DB-assigned integer ids.
            fe_source_id = ref.source_id
            fe_collection_id = ref.collection_id

            # Look up db ids
            db_source_id = source_id_map.get(fe_source_id)
            if db_source_id is None:
                # Try to find by iterating source_creates and matching
                for s_idx, s in enumerate(source_creates):
                    if s.name == fe_source_id or str(s_idx) == fe_source_id:
                        db_source_id = source_id_map.get(str(s_idx))
                        break

            # For collection, find by composite key
            db_collection_id = None
            for key, val in collection_id_map.items():
                s_idx_str, c_idx_str = key.split(":")
                if source_id_map.get(s_idx_str) == db_source_id:
                    # Check if the collection index matches
                    s_idx = int(s_idx_str)
                    c_idx = int(c_idx_str)
                    if s_idx < len(source_creates):
                        src_cols = source_creates[s_idx].collections
                        if c_idx < len(src_cols):
                            col = src_cols[c_idx]
                            if col.name == fe_collection_id or str(c_idx) == fe_collection_id:
                                db_collection_id = val
                                break

            if db_source_id and db_collection_id:
                mapped_refs.append(
                    {
                        "collection_id": db_collection_id,
                        "source_id": db_source_id,
                        "show_as_window": ref.show_as_window,
                    }
                )

        view = ImageryView(
            campaign_id=campaign_id,
            name=view_create.name,
            display_order=view_idx,
            collection_refs=mapped_refs,
        )
        db.add(view)
        db.flush()

        # Build default view layout data for window collections
        # Windows are placed in rows below the main canvas (which ends at y=36).
        # With a 60-col grid and w=10, we fit 6 windows per row.
        window_refs = [r for r in mapped_refs if r.get("show_as_window")]
        COLS_PER_ROW = 6
        WINDOW_W = 10
        WINDOW_H = 11
        START_Y = 36  # directly below the main canvas
        view_layout_data = []
        for w_idx, ref in enumerate(window_refs):
            row = w_idx // COLS_PER_ROW
            col = w_idx % COLS_PER_ROW
            view_layout_data.append(
                {
                    "i": str(ref["collection_id"]),
                    "x": col * WINDOW_W,
                    "y": START_Y + row * WINDOW_H,
                    "w": WINDOW_W,
                    "h": WINDOW_H,
                }
            )

        # Create default canvas layout for this view
        canvas_layout = CanvasLayout(
            layout_data=view_layout_data,
            user_id=None,
            campaign_id=campaign_id,
            view_id=view.id,
            is_default=True,
        )
        db.add(canvas_layout)

        created.append(view)

    return created


# ============================================================================
# Canvas Layout Management
# ============================================================================


def create_new_canvas_layout(
    db: Session,
    campaign_id: int,
    layout_data: CanvasLayoutCreate,
    user_id: UUID,
    view_id: int | None = None,
    should_be_default: bool = False,
) -> dict:
    """Create or update canvas layouts for a view."""

    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail=f"Campaign {campaign_id} not found")

    if view_id is not None:
        view = (
            db.query(ImageryView)
            .filter(ImageryView.id == view_id, ImageryView.campaign_id == campaign_id)
            .first()
        )
        if not view:
            raise HTTPException(
                status_code=404, detail=f"View {view_id} not found in campaign {campaign_id}"
            )

    if should_be_default:
        has_admin_access = (
            db.query(CampaignUser)
            .filter(
                CampaignUser.campaign_id == campaign_id,
                CampaignUser.user_id == user_id,
                CampaignUser.is_admin,
            )
            .first()
        )
        if not has_admin_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only campaign admins can modify default layouts",
            )

    result = {}

    if should_be_default:
        existing_main_layout = (
            db.query(CanvasLayout)
            .filter(
                CanvasLayout.campaign_id == campaign_id,
                CanvasLayout.view_id.is_(None),
                CanvasLayout.is_default,
                CanvasLayout.user_id.is_(None),
            )
            .first()
        )
        if not existing_main_layout:
            raise HTTPException(
                status_code=404,
                detail=f"Default main canvas layout not found for campaign {campaign_id}",
            )

        existing_main_layout.layout_data = layout_data.main_layout_data
        flag_modified(existing_main_layout, "layout_data")
        result["main_layout"] = existing_main_layout

        if layout_data.view_layout_data is not None:
            if view_id is None:
                raise HTTPException(
                    status_code=400,
                    detail="view_id is required when providing view_layout_data",
                )

            existing_view_layout = (
                db.query(CanvasLayout)
                .filter(
                    CanvasLayout.campaign_id == campaign_id,
                    CanvasLayout.view_id == view_id,
                    CanvasLayout.is_default,
                    CanvasLayout.user_id.is_(None),
                )
                .first()
            )
            if not existing_view_layout:
                raise HTTPException(
                    status_code=404,
                    detail=f"Default canvas layout not found for view {view_id}",
                )

            existing_view_layout.layout_data = layout_data.view_layout_data
            flag_modified(existing_view_layout, "layout_data")
            result["view_layout"] = existing_view_layout
    else:
        main_layout = (
            db.query(CanvasLayout)
            .filter(
                CanvasLayout.user_id == user_id,
                CanvasLayout.campaign_id == campaign_id,
                CanvasLayout.view_id.is_(None),
            )
            .first()
        )

        if main_layout:
            main_layout.layout_data = layout_data.main_layout_data
            flag_modified(main_layout, "layout_data")
        else:
            main_layout = CanvasLayout(
                user_id=user_id,
                campaign_id=campaign_id,
                view_id=None,
                layout_data=layout_data.main_layout_data,
                is_default=False,
            )
            db.add(main_layout)

        result["main_layout"] = main_layout

        if layout_data.view_layout_data is not None:
            if view_id is None:
                raise HTTPException(
                    status_code=400,
                    detail="view_id is required when providing view_layout_data",
                )

            view_layout = (
                db.query(CanvasLayout)
                .filter(
                    CanvasLayout.user_id == user_id,
                    CanvasLayout.campaign_id == campaign_id,
                    CanvasLayout.view_id == view_id,
                )
                .first()
            )

            if view_layout:
                view_layout.layout_data = layout_data.view_layout_data
                flag_modified(view_layout, "layout_data")
            else:
                view_layout = CanvasLayout(
                    user_id=user_id,
                    campaign_id=campaign_id,
                    view_id=view_id,
                    layout_data=layout_data.view_layout_data,
                    is_default=False,
                )
                db.add(view_layout)

            result["view_layout"] = view_layout

    db.commit()

    if "main_layout" in result:
        db.refresh(result["main_layout"])
    if "view_layout" in result:
        db.refresh(result["view_layout"])

    return result


# ============================================================================
# Deletion
# ============================================================================


def update_source(db: Session, source_id: int, campaign_id: int, updates: dict) -> ImagerySource:
    """Update display settings (crosshair_hex6, default_zoom) for an imagery source."""
    source = (
        db.query(ImagerySource)
        .filter(ImagerySource.id == source_id, ImagerySource.campaign_id == campaign_id)
        .first()
    )
    if not source:
        raise HTTPException(
            status_code=404,
            detail=f"Source {source_id} not found in campaign {campaign_id}",
        )
    for key, value in updates.items():
        if value is not None and hasattr(source, key):
            setattr(source, key, value)
    db.commit()
    db.refresh(source)
    return source


def delete_source(db: Session, source_id: int, campaign_id: int) -> None:
    source = (
        db.query(ImagerySource)
        .filter(ImagerySource.id == source_id, ImagerySource.campaign_id == campaign_id)
        .first()
    )
    if not source:
        raise HTTPException(
            status_code=404,
            detail=f"Source {source_id} not found in campaign {campaign_id}",
        )
    db.delete(source)
    db.commit()

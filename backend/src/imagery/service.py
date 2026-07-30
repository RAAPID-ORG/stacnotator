from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from src.auth.models import User
from src.campaigns.models import Campaign
from src.canvas.service import new_default_view_layout, sync_view_layouts
from src.config import get_settings
from src.crypto import encrypt
from src.imagery.models import (
    Basemap,
    CollectionStacConfig,
    CollectionVizConfig,
    ImageryCollection,
    ImagerySlice,
    ImagerySource,
    ImageryView,
    SliceTileUrl,
    VisualizationTemplate,
)
from src.imagery.registration import RegistrationSpec
from src.imagery.schemas import (
    BasemapCreate,
    ImageryCollectionCreate,
    ImageryEditorStateCreate,
    ImagerySourceCreate,
)
from src.imagery.tile_urls import update_collection_viz_params


def set_basemap_api_key(db: Session, campaign_id: int, basemap_id: int, value: str) -> Basemap:
    """Store the AES-256-GCM-encrypted provider key for a basemap (campaign-scoped lookup)."""
    basemap = db.get(Basemap, basemap_id)
    if basemap is None or basemap.campaign_id != campaign_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Basemap not found")
    basemap.encrypted_api_key = encrypt(value)
    return basemap


def set_source_api_key(db: Session, campaign_id: int, source_id: int, value: str) -> ImagerySource:
    """Store the AES-256-GCM-encrypted provider key for an imagery source."""
    source = db.get(ImagerySource, source_id)
    if source is None or source.campaign_id != campaign_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")
    source.encrypted_api_key = encrypt(value)
    return source


def _registration_spec(
    collection: ImageryCollection,
    col_create: ImageryCollectionCreate,
    src_create: ImagerySourceCreate,
) -> RegistrationSpec:
    """Snapshot the plain fields `_register_all_stac_browser_collections` needs
    for one collection, decoupling the deferred registration from the ORM
    objects and request session that produced it."""
    assert col_create.stac_config is not None
    return RegistrationSpec(
        collection_id=collection.id,
        collection_name=collection.name,
        stac_config=col_create.stac_config,
        has_dedicated_cover=col_create.has_dedicated_cover,
        cover_slice_index=col_create.cover_slice_index,
        source_viz_names=[v.name for v in src_create.visualizations],
    )


def _upsert_viz_configs(
    db: Session,
    collection_id: int,
    visualizations,
    has_cover: bool,
) -> None:
    """Upsert CollectionVizConfig rows to match the given visualization list.

    Inserts new rows, updates existing ones (matched by name), and deletes any
    rows whose names are no longer present — leaving the table holding exactly
    the supplied visualizations.
    """
    if not visualizations:
        db.execute(
            delete(CollectionVizConfig).where(CollectionVizConfig.collection_id == collection_id)
        )
        return

    incoming_names = {v.name for v in visualizations}

    db.execute(
        delete(CollectionVizConfig).where(
            CollectionVizConfig.collection_id == collection_id,
            CollectionVizConfig.name.notin_(incoming_names),
        )
    )

    existing = {
        row.name: row
        for row in db.execute(
            select(CollectionVizConfig).where(CollectionVizConfig.collection_id == collection_id)
        )
        .scalars()
        .all()
    }

    for i, v in enumerate(visualizations):
        render = v.viz_params.model_dump(exclude_none=True)
        cover_render = (
            v.cover_viz_params.model_dump(exclude_none=True)
            if has_cover and v.cover_viz_params
            else None
        )
        if v.name in existing:
            row = existing[v.name]
            row.display_order = i
            row.render_params = render
            row.cover_render_params = cover_render
        else:
            db.add(
                CollectionVizConfig(
                    collection_id=collection_id,
                    name=v.name,
                    display_order=i,
                    render_params=render,
                    cover_render_params=cover_render,
                )
            )


# ============================================================================
# Imagery Creation
# ============================================================================


def _authorize_tilers(user: User, editor_state: ImageryEditorStateCreate) -> None:
    """Reject the whole save up front (before any writes) if the user names a tiler they
    may not use: unknown tiler => 400, ungranted extra => 403."""
    settings = get_settings()
    for src in editor_state.sources:
        for col in src.collections:
            stac = col.stac_config
            if not stac or not stac.catalog_url:
                continue
            name = stac.tiler or settings.DEFAULT_TILER
            if name is not None and name not in settings.TILERS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown tiler '{name}' for collection '{col.name}'",
                )
            if name is not None and not user.can_use_tiler(name):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        f"You are not authorized to use tiler '{name}' (collection '{col.name}')"
                    ),
                )


def create_imagery_from_editor_state(
    db: Session,
    *,
    campaign: Campaign,
    editor_state: ImageryEditorStateCreate,
    user: User,
) -> dict:
    """Persist the full imagery editor state (sources, collections, slices,
    views, basemaps) for a freshly created campaign.

    A campaign with no existing imagery reduces the save/reconcile flow to pure
    creation, so this is a thin entry point over `save_imagery_editor_state`.
    Returns the same dict (keys 'sources', 'views', 'basemaps',
    'pending_registrations', 'bbox'). Does NOT commit - caller commits and then
    hands 'pending_registrations' to spawn_background_mosaic_registration.
    """
    return save_imagery_editor_state(db, campaign=campaign, editor_state=editor_state, user=user)


def save_imagery_editor_state(
    db: Session,
    *,
    campaign: Campaign,
    editor_state: ImageryEditorStateCreate,
    user: User,
) -> dict:
    """Upsert the full imagery editor state in a single transaction.

    Reconciliation rules per entity (sources, collections, slices, views,
    basemaps): payload entry with `id` set → update in place; without `id` →
    create; in DB but missing from payload → delete. A collection only lands in
    the returned `pending_registrations` when fields that affect its mosaic
    (search_query, max_cloud_cover, viz_params, slice date list) actually
    changed; pure metadata edits (rename, cover_slice_index) skip the expensive
    re-search and rebake viz params into the existing URLs instead.

    Caller commits, then hands `pending_registrations` to
    spawn_background_mosaic_registration - the actual STAC calls run off the
    request path so this transaction isn't held open across them.
    """
    if not campaign.settings:
        raise HTTPException(status_code=404, detail="Campaign settings not found")

    _authorize_tilers(user, editor_state)

    bbox = [
        campaign.settings.bbox_west,
        campaign.settings.bbox_south,
        campaign.settings.bbox_east,
        campaign.settings.bbox_north,
    ]

    existing_sources: dict[int, ImagerySource] = {s.id: s for s in campaign.imagery_sources}
    existing_views: dict[int, ImageryView] = {v.id: v for v in campaign.imagery_views}

    payload_source_ids = {s.id for s in editor_state.sources if s.id is not None}
    payload_view_ids = {v.id for v in editor_state.views if v.id is not None}

    deleted_collection_ids: set[int] = set()
    deleted_source_ids: set[int] = set()

    # Delete sources missing from payload. Cascade handles their collections.
    for s_id, s in list(existing_sources.items()):
        if s_id not in payload_source_ids:
            for col in s.collections:
                deleted_collection_ids.add(col.id)
            db.delete(s)
            deleted_source_ids.add(s_id)
            del existing_sources[s_id]

    # Within each retained source, delete collections missing from payload.
    for src_create in editor_state.sources:
        if src_create.id is None or src_create.id not in existing_sources:
            continue
        existing_src = existing_sources[src_create.id]
        payload_col_ids = {c.id for c in src_create.collections if c.id is not None}
        for col in list(existing_src.collections):
            if col.id not in payload_col_ids:
                deleted_collection_ids.add(col.id)
                db.delete(col)

    # Prune view collection_refs for anything we just deleted; without this the
    # JSONB column would carry dangling refs into the view-upsert phase.
    if deleted_source_ids or deleted_collection_ids:
        for view in campaign.imagery_views:
            cleaned = [
                r
                for r in (view.collection_refs or [])
                if r.get("source_id") not in deleted_source_ids
                and r.get("collection_id") not in deleted_collection_ids
            ]
            if cleaned != view.collection_refs:
                view.collection_refs = cleaned
                flag_modified(view, "collection_refs")

    db.flush()

    # Upsert sources. New ones go through the existing _create_source helper so
    # the STAC pending-registration list works identically to campaign create.
    # Map keys: "<src_idx>" for sources, "<src_idx>:<col_idx>" for collections.
    # Pre-populated with existing DB IDs so refs can use either real IDs or
    # positional temp IDs interchangeably.
    source_id_map: dict[str, int] = {str(s.id): s.id for s in campaign.imagery_sources}
    collection_id_map: dict[str, int] = {
        str(c.id): c.id for s in campaign.imagery_sources for c in s.collections
    }
    pending_registrations: list[RegistrationSpec] = []

    for src_idx, src_create in enumerate(editor_state.sources):
        if src_create.id and src_create.id in existing_sources:
            db_src = existing_sources[src_create.id]
            pending = _update_source_in_place(db, db_src, src_create, src_idx, bbox)
            pending_registrations.extend(pending)
            source_id_map[str(src_idx)] = db_src.id
            # Pair every collection by index - order of db_src.collections matches
            # the payload after _update_source_in_place runs.
            for col_idx, col in enumerate(db_src.collections):
                collection_id_map[f"{src_idx}:{col_idx}"] = col.id
        else:
            db_src, pending = _create_source(db, campaign.id, src_create, src_idx, bbox)
            pending_registrations.extend(pending)
            source_id_map[str(src_idx)] = db_src.id
            for col_idx, col in enumerate(db_src.collections):
                collection_id_map[f"{src_idx}:{col_idx}"] = col.id

    db.flush()

    # Delete views missing from payload.
    for v_id, v in list(existing_views.items()):
        if v_id not in payload_view_ids:
            db.delete(v)
            del existing_views[v_id]
    db.flush()

    # Upsert views.
    for view_idx, view_create in enumerate(editor_state.views):
        mapped_refs = _resolve_view_refs(
            view_create.collection_refs,
            source_id_map,
            collection_id_map,
            editor_state.sources,
        )
        if view_create.id and view_create.id in existing_views:
            db_view = existing_views[view_create.id]
            old_window_ids = {
                r["collection_id"]
                for r in (db_view.collection_refs or [])
                if r.get("show_as_window")
            }
            db_view.name = view_create.name
            db_view.display_order = view_idx
            db_view.collection_refs = mapped_refs
            flag_modified(db_view, "collection_refs")
            new_window_ids = {r["collection_id"] for r in mapped_refs if r.get("show_as_window")}
            sync_view_layouts(
                db,
                db_view.id,
                campaign.id,
                window_collection_ids=new_window_ids,
                added_collection_ids=list(new_window_ids - old_window_ids),
            )
        else:
            new_view = ImageryView(
                campaign_id=campaign.id,
                name=view_create.name,
                display_order=view_idx,
                collection_refs=mapped_refs,
            )
            db.add(new_view)
            db.flush()
            window_ids = [r["collection_id"] for r in mapped_refs if r.get("show_as_window")]
            db.add(new_default_view_layout(campaign.id, new_view.id, window_ids))

    # Basemaps: replace wholesale (small list, no inbound FKs).
    db.execute(delete(Basemap).where(Basemap.campaign_id == campaign.id))
    db.flush()
    created_basemaps = _create_basemaps(db, campaign.id, editor_state.basemaps)

    db.flush()

    return {
        "sources": campaign.imagery_sources,
        "views": campaign.imagery_views,
        "basemaps": created_basemaps,
        "pending_registrations": pending_registrations,
        "bbox": bbox,
    }


def _resolve_view_refs(
    refs,
    source_id_map: dict[str, int],
    collection_id_map: dict[str, int],
    source_creates: list[ImagerySourceCreate],
) -> list[dict]:
    """Resolve view collection_refs (strings from the frontend) to DB IDs.

    Accepts either real numeric IDs (existing entities) or positional keys
    ("<src_idx>" / "<src_idx>:<col_idx>") for newly-created entities. Drops
    refs that don't resolve - defensive against stale payloads.
    """
    out: list[dict] = []
    for ref in refs:
        db_source_id = source_id_map.get(ref.source_id)
        db_collection_id = collection_id_map.get(ref.collection_id)
        if db_source_id is None or db_collection_id is None:
            # Fallback: positional lookup for the campaign-create flow that
            # references entities by index.
            for s_idx, s in enumerate(source_creates):
                if str(s_idx) == ref.source_id:
                    db_source_id = source_id_map.get(str(s_idx))
                    for c_idx, _ in enumerate(s.collections):
                        if (
                            str(c_idx) == ref.collection_id
                            or f"{s_idx}:{c_idx}" == ref.collection_id
                        ):
                            db_collection_id = collection_id_map.get(f"{s_idx}:{c_idx}")
                            break
                    break
        if db_source_id and db_collection_id:
            out.append(
                {
                    "collection_id": db_collection_id,
                    "source_id": db_source_id,
                    "show_as_window": ref.show_as_window,
                }
            )
    return out


def _stac_config_changed(existing: CollectionStacConfig | None, incoming) -> bool:
    """Cheap deep-compare of fields that require mosaic re-registration.

    Compares the FULL set of viz configs (all names + render_params + cover_render_params)
    so that changes to viz[1..n] correctly trigger re-registration (Quirk 3 fix).
    """
    if existing is None:
        return True

    existing_viz_configs = existing.collection.viz_configs if existing.collection else []
    existing_set = {
        vc.name: (vc.render_params, vc.cover_render_params) for vc in existing_viz_configs
    }
    incoming_set = {
        v.name: (
            v.viz_params.model_dump(exclude_none=True),
            v.cover_viz_params.model_dump(exclude_none=True) if v.cover_viz_params else None,
        )
        for v in (incoming.visualizations or [])
    }

    return (
        existing_set != incoming_set
        or existing.max_cloud_cover != incoming.max_cloud_cover
        or existing.search_query != incoming.search_query
        or existing.cover_search_query != incoming.cover_search_query
        or existing.tile_provider != incoming.tiler
        or existing.internal_storage != incoming.internal_storage
    )


def _update_source_in_place(
    db: Session,
    db_src: ImagerySource,
    src_create: ImagerySourceCreate,
    src_idx: int,
    bbox: list[float],
) -> list[RegistrationSpec]:
    """Update source metadata + viz templates, then reconcile collections.
    Returns pending STAC registrations from any new or re-registered collections."""
    db_src.name = src_create.name
    db_src.crosshair_hex6 = src_create.crosshair_hex6
    db_src.default_zoom = src_create.default_zoom
    db_src.display_order = src_idx

    # Reconcile visualization templates by name.
    existing_viz = {v.name: v for v in db_src.visualizations}
    payload_names = [v.name for v in src_create.visualizations]
    removed_viz_names = {name for name in existing_viz if name not in payload_names}
    for name, viz in list(existing_viz.items()):
        if name not in payload_names:
            db.delete(viz)
    for viz_idx, viz in enumerate(src_create.visualizations):
        if viz.name in existing_viz:
            existing_viz[viz.name].display_order = viz_idx
        else:
            db.add(VisualizationTemplate(source_id=db_src.id, name=viz.name, display_order=viz_idx))

    # Remove CollectionVizConfig rows for viz names that disappeared from the source.
    if removed_viz_names:
        collection_ids = [col.id for col in db_src.collections]
        if collection_ids:
            db.execute(
                delete(CollectionVizConfig).where(
                    CollectionVizConfig.collection_id.in_(collection_ids),
                    CollectionVizConfig.name.in_(removed_viz_names),
                )
            )

    pending: list[RegistrationSpec] = []
    for col_idx, col_create in enumerate(src_create.collections):
        existing_col = (
            next((c for c in db_src.collections if c.id == col_create.id), None)
            if col_create.id
            else None
        )
        if existing_col:
            pending_entry = _update_collection_in_place(
                db, existing_col, col_create, col_idx, src_create, bbox
            )
            if pending_entry:
                pending.append(pending_entry)
        else:
            _, pending_entry = _create_collection_record(
                db, db_src, src_create, col_create, col_idx, bbox
            )
            if pending_entry:
                pending.append(pending_entry)

    db.flush()
    db.refresh(db_src)
    return pending


def _update_collection_in_place(
    db: Session,
    db_col: ImageryCollection,
    col_create: ImageryCollectionCreate,
    col_idx: int,
    src_create: ImagerySourceCreate,
    bbox: list[float],
) -> RegistrationSpec | None:
    """Update a collection's metadata, slices, and stac_config. Returns a
    RegistrationSpec if mosaic re-search is required."""
    db_col.name = col_create.name
    db_col.cover_slice_index = col_create.cover_slice_index
    db_col.has_dedicated_cover = col_create.has_dedicated_cover
    db_col.display_order = col_idx

    needs_reregistration = False
    has_cover = bool(col_create.has_dedicated_cover)

    if col_create.stac_config:
        if db_col.stac_config is None:
            # Collection just gained a stac_config (unusual).
            db.add(
                CollectionStacConfig(
                    collection_id=db_col.id,
                    catalog_url=col_create.stac_config.catalog_url,
                    stac_collection_id=col_create.stac_config.stac_collection_id,
                    tile_provider=col_create.stac_config.tiler,
                    max_cloud_cover=col_create.stac_config.max_cloud_cover,
                    search_query=col_create.stac_config.search_query,
                    cover_search_query=(
                        col_create.stac_config.cover_search_query if has_cover else None
                    ),
                    internal_storage=col_create.stac_config.internal_storage,
                )
            )
            needs_reregistration = True
        else:
            if _stac_config_changed(db_col.stac_config, col_create.stac_config):
                needs_reregistration = True
            db_col.stac_config.tile_provider = col_create.stac_config.tiler
            db_col.stac_config.max_cloud_cover = col_create.stac_config.max_cloud_cover
            db_col.stac_config.internal_storage = col_create.stac_config.internal_storage
            db_col.stac_config.search_query = col_create.stac_config.search_query
            db_col.stac_config.cover_search_query = (
                col_create.stac_config.cover_search_query if has_cover else None
            )
            flag_modified(db_col.stac_config, "search_query")
            flag_modified(db_col.stac_config, "cover_search_query")
        _upsert_viz_configs(db, db_col.id, col_create.stac_config.visualizations, has_cover)

    # Reconcile slices.
    payload_slice_ids = {s.id for s in col_create.slices if s.id is not None}
    existing_slices = {s.id: s for s in db_col.slices}
    for sl_id, sl in list(existing_slices.items()):
        if sl_id not in payload_slice_ids:
            db.delete(sl)
            needs_reregistration = True

    for sl_idx, sl_create in enumerate(col_create.slices):
        if sl_create.id and sl_create.id in existing_slices:
            db_sl = existing_slices[sl_create.id]
            if db_sl.start_date != sl_create.start_date or db_sl.end_date != sl_create.end_date:
                needs_reregistration = True
            db_sl.name = sl_create.name
            db_sl.start_date = sl_create.start_date
            db_sl.end_date = sl_create.end_date
            db_sl.display_order = sl_idx
            # Replace tile_urls only for manual collections; STAC ones get
            # rebuilt by the re-registration / viz-params rebake below.
            if col_create.stac_config is None:
                for tu in list(db_sl.tile_urls):
                    db.delete(tu)
                # Flush the deletes first: the unit of work emits same-table
                # INSERTs before DELETEs, which would trip the (slice_id,
                # visualization_name) unique constraint on unchanged names.
                db.flush()
                for t in sl_create.tile_urls:
                    db.add(
                        SliceTileUrl(
                            slice_id=db_sl.id,
                            visualization_name=t.visualization_name,
                            tile_url=t.tile_url,
                        )
                    )
        else:
            new_sl = ImagerySlice(
                collection_id=db_col.id,
                name=sl_create.name,
                start_date=sl_create.start_date,
                end_date=sl_create.end_date,
                display_order=sl_idx,
            )
            db.add(new_sl)
            db.flush()
            for t in sl_create.tile_urls:
                db.add(
                    SliceTileUrl(
                        slice_id=new_sl.id,
                        visualization_name=t.visualization_name,
                        tile_url=t.tile_url,
                    )
                )
            needs_reregistration = True

    db.flush()
    db.refresh(db_col)

    if not col_create.stac_config:
        return None

    # A newly added (or removed) visualization name has no tile URLs yet, and the
    # cheap viz-params compare above only inspects the first viz - so reconcile the
    # full set here to force a rebuild when the visualization names change.
    incoming_viz_names = {v.name for v in col_create.stac_config.visualizations}
    existing_viz_names = {tu.visualization_name for sl in db_col.slices for tu in sl.tile_urls}
    if incoming_viz_names != existing_viz_names:
        needs_reregistration = True

    if needs_reregistration and col_create.stac_config.catalog_url:
        # Drop existing tile URLs so the registration step rebuilds them fresh.
        for sl in db_col.slices:
            for tu in list(sl.tile_urls):
                db.delete(tu)
        db.flush()
        return _registration_spec(db_col, col_create, src_create)

    # No search/slice changes - just rebake viz params into existing URLs.
    viz_by_name = {
        v.name: v.viz_params.model_dump(exclude_none=True)
        for v in col_create.stac_config.visualizations
    }
    cover_viz_by_name = {
        v.name: v.cover_viz_params.model_dump(exclude_none=True)
        for v in col_create.stac_config.visualizations
        if v.cover_viz_params
    }
    update_collection_viz_params(db, db_col.id, viz_by_name, cover_viz_by_name or None)
    return None


def _create_source(
    db: Session,
    campaign_id: int,
    src: ImagerySourceCreate,
    src_idx: int,
    bbox: list[float],
) -> tuple[ImagerySource, list[RegistrationSpec]]:
    """Create a single ImagerySource with all its children.
    Returns (source, pending_registrations)."""
    pending: list[RegistrationSpec] = []
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
        _, pending_entry = _create_collection_record(db, source, src, col_create, col_idx, bbox)
        if pending_entry:
            pending.append(pending_entry)

    db.flush()
    db.refresh(source)
    return source, pending


def _create_collection_record(
    db: Session,
    source: ImagerySource,
    src_create: ImagerySourceCreate,
    col_create: ImageryCollectionCreate,
    col_idx: int,
    bbox: list[float],
) -> tuple[ImageryCollection, RegistrationSpec | None]:
    """Persist a single collection (stac_config, slices, tile_urls) for a source.

    Returns (collection, pending_registration_spec). The second item is a
    RegistrationSpec for `registration._register_all_stac_browser_collections`,
    or None if the collection doesn't need deferred registration.
    """
    collection = ImageryCollection(
        source_id=source.id,
        name=col_create.name,
        cover_slice_index=col_create.cover_slice_index,
        has_dedicated_cover=col_create.has_dedicated_cover,
        display_order=col_idx,
    )
    db.add(collection)
    db.flush()

    has_cover = bool(col_create.has_dedicated_cover)

    if col_create.stac_config:
        db.add(
            CollectionStacConfig(
                collection_id=collection.id,
                catalog_url=col_create.stac_config.catalog_url,
                stac_collection_id=col_create.stac_config.stac_collection_id,
                tile_provider=col_create.stac_config.tiler,
                max_cloud_cover=col_create.stac_config.max_cloud_cover,
                search_query=col_create.stac_config.search_query,
                cover_search_query=(
                    col_create.stac_config.cover_search_query if has_cover else None
                ),
                internal_storage=col_create.stac_config.internal_storage,
            )
        )
        _upsert_viz_configs(db, collection.id, col_create.stac_config.visualizations, has_cover)

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
        for tile in sl_create.tile_urls:
            db.add(
                SliceTileUrl(
                    slice_id=slice_obj.id,
                    visualization_name=tile.visualization_name,
                    tile_url=tile.tile_url,
                )
            )

    pending_entry: RegistrationSpec | None = None
    if (
        col_create.stac_config
        and col_create.stac_config.catalog_url
        and col_create.stac_config.stac_collection_id
        and col_create.slices
    ):
        pending_entry = _registration_spec(collection, col_create, src_create)
    return collection, pending_entry


def _create_basemaps(
    db: Session,
    campaign_id: int,
    basemaps: list[BasemapCreate],
) -> list[Basemap]:
    created = []
    for bm in basemaps:
        obj = Basemap(
            campaign_id=campaign_id,
            name=bm.name,
            url=bm.url,
            max_native_zoom=bm.max_native_zoom,
        )
        db.add(obj)
        created.append(obj)
    return created

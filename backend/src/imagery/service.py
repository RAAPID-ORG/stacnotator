import logging
import threading
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from src.auth.models import User
from src.campaigns.models import Campaign
from src.canvas.service import new_default_view_layout, sync_view_layouts
from src.config import get_settings
from src.crypto import encrypt
from src.database import SessionLocal
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
from src.imagery.schemas import (
    BasemapCreate,
    ImageryCollectionCreate,
    ImageryEditorStateCreate,
    ImagerySourceCreate,
    ImageryViewCreate,
)
from src.imagery.tile_urls import _slice_viz_params, update_collection_viz_params
from src.tiling import providers

logger = logging.getLogger(__name__)


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


def _payload_has_dedicated_cover(col_create: ImageryCollectionCreate) -> bool:
    return bool(col_create.has_dedicated_cover)


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
    """
    Persist the full imagery editor state (sources, views, basemaps) for a campaign.
    Handles frontend-to-DB id mapping so views can reference DB-assigned collection/source ids.

    Returns dict with keys 'sources', 'views', 'basemaps' containing ORM objects.
    Does NOT commit - caller is responsible for commit.
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

    # Mapping: frontend temp id -> DB id
    source_id_map: dict[str, int] = {}  # fe_source_id -> db source id
    collection_id_map: dict[str, int] = {}  # fe_collection_id -> db collection id

    # Track stac_browser collections that need mosaic registration
    pending_registrations: list[tuple[ImageryCollection, object, ImagerySourceCreate]] = []

    created_sources: list[ImagerySource] = []
    for src_idx, src_create in enumerate(editor_state.sources):
        source, pending = _create_source(db, campaign.id, src_create, src_idx, bbox)
        db.flush()

        # Build id map using index as frontend key (frontend sends ordered lists)
        source_id_map[str(src_idx)] = source.id
        for col_idx, col in enumerate(source.collections):
            collection_id_map[f"{src_idx}:{col_idx}"] = col.id

        pending_registrations.extend(pending)
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
        "pending_registrations": pending_registrations,
        "bbox": bbox,
    }


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
    pending_registrations: list[tuple] = []

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
) -> list[tuple]:
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

    pending: list[tuple] = []
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
) -> tuple | None:
    """Update a collection's metadata, slices, and stac_config. Returns a
    pending-registration tuple if mosaic re-search is required."""
    db_col.name = col_create.name
    db_col.cover_slice_index = col_create.cover_slice_index
    db_col.has_dedicated_cover = col_create.has_dedicated_cover
    db_col.display_order = col_idx

    needs_reregistration = False
    has_cover = _payload_has_dedicated_cover(col_create)

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
        return (db_col, col_create, src_create)

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
) -> tuple[ImagerySource, list[tuple]]:
    """Create a single ImagerySource with all its children.
    Returns (source, pending_registrations)."""
    pending: list[tuple] = []
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
) -> tuple[ImageryCollection, tuple | None]:
    """Persist a single collection (stac_config, slices, tile_urls) for a source.

    Returns (collection, pending_stac_browser_entry). The second item is a tuple
    suitable for `_register_all_stac_browser_collections`, or None if the
    collection doesn't need deferred registration.
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

    has_cover = _payload_has_dedicated_cover(col_create)

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

    pending_entry: tuple | None = None
    if (
        col_create.stac_config
        and col_create.stac_config.catalog_url
        and col_create.stac_config.stac_collection_id
        and col_create.slices
    ):
        pending_entry = (collection, col_create, src_create)
    return collection, pending_entry


def _sanitize_stac_error(e: Exception) -> str:
    """Extract a user-facing error message from a STAC registration exception.

    Only exposes information about the STAC query / HTTP response, never
    internal paths, credentials, or stack traces.
    """
    import httpx
    from fastapi import HTTPException

    if isinstance(e, HTTPException):
        # register_mosaic_sync raises HTTPException with a curated detail
        # (e.g. "No items found ..."); surface the detail alone.
        return str(e.detail)
    if isinstance(e, httpx.HTTPStatusError):
        status = e.response.status_code
        # Try to extract a message from the response body
        try:
            body = e.response.json()
            detail = body.get("detail") or body.get("message") or body.get("description", "")
            if detail:
                return f"HTTP {status}: {detail}"
        except Exception:
            logger.debug("Could not parse tile server error response", exc_info=True)
        return f"HTTP {status} from tile server"
    # Generic: only expose the exception type + first line
    msg = str(e).split("\n")[0]
    # Strip file paths
    if "/" in msg and ("site-packages" in msg or "/app/" in msg):
        return f"Registration failed ({type(e).__name__})"
    return msg[:200] if msg else f"Registration failed ({type(e).__name__})"


MPC_REGISTER_URL = "https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register"


@dataclass(frozen=True)
class _SliceRef:
    """Plain snapshot of the slice fields registration needs. Captured before the
    read transaction is released so the parallel-HTTP phase never dereferences a
    session-bound ORM object (which would reopen a transaction, off-thread)."""

    id: int
    name: str
    start_date: str
    end_date: str


def _register_all_stac_browser_collections(
    db: Session,
    pending: list[tuple],
    bbox: list[float],
    campaign_id: int,
) -> list[dict]:
    """Register mosaics for all stac_browser collections in parallel with retries.
    Returns a list of error dicts for failed slices (empty on full success).

    Each slice's vizs are routed per provider (MPC direct vs a configured hosted
    titiler-pgstac tiler) and the absolute tile URL is baked into the SliceTileUrl rows.

    The DB connection is released (commit) after the read phase and before the slow
    parallel STAC calls, then re-acquired for the writes - otherwise the transaction
    sits idle across the calls and Postgres reaps it at idle_in_transaction_session_timeout.
    """
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed

    MAX_WORKERS = 16
    MAX_RETRIES = 2

    # Build a flat list of tasks
    tasks: list[dict] = []
    for collection, col_create, src_create in pending:
        stac = col_create.stac_config

        # Validate viz name parity between source and stac_config
        source_names = [v.name for v in src_create.visualizations]
        stac_names = [v.name for v in stac.visualizations]
        if set(source_names) != set(stac_names):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Visualization name mismatch in collection '{collection.name}': "
                    f"source has {source_names}, stac_config has {stac_names}"
                ),
            )

        # Per-visualization params dicts for URL baking
        viz_params_by_name: dict[str, dict] = {
            v.name: v.viz_params.model_dump(exclude_none=True) for v in stac.visualizations
        }
        cover_viz_params_by_name: dict[str, dict] = {
            v.name: v.cover_viz_params.model_dump(exclude_none=True)
            for v in stac.visualizations
            if v.cover_viz_params
        }
        # Custom search queries
        search_query = stac.search_query
        cover_search_query = stac.cover_search_query

        db_slices = (
            db.execute(
                select(ImagerySlice)
                .where(ImagerySlice.collection_id == collection.id)
                .order_by(ImagerySlice.display_order)
            )
            .scalars()
            .all()
        )

        for sl_idx, db_slice in enumerate(db_slices):
            is_cover = col_create.has_dedicated_cover and sl_idx == col_create.cover_slice_index

            # Effective per-viz params for this slice (cover override if present)
            slice_viz_by_name: dict[str, dict] = {
                name: (
                    cover_viz_params_by_name[name]
                    if is_cover and name in cover_viz_params_by_name
                    else params
                )
                for name, params in viz_params_by_name.items()
            }

            # Route each viz to a provider ("mpc" direct vs a hosted tiler).
            provider_by_viz = {
                name: providers.select_provider(stac.catalog_url, p)
                for name, p in slice_viz_by_name.items()
            }
            any_uses_mpc = any(v == "mpc" for v in provider_by_viz.values())
            any_needs_hosted = any(v == "hosted" for v in provider_by_viz.values())

            tasks.append(
                {
                    "slice": _SliceRef(
                        id=db_slice.id,
                        name=db_slice.name,
                        start_date=db_slice.start_date,
                        end_date=db_slice.end_date,
                    ),
                    "stac": stac,
                    "viz_params_by_name": slice_viz_by_name,
                    "any_uses_mpc": any_uses_mpc,
                    "any_needs_hosted": any_needs_hosted,
                    "collection_name": collection.name,
                    "tiler_name": stac.tiler or get_settings().DEFAULT_TILER,
                    "search_query": cover_search_query
                    if (is_cover and cover_search_query)
                    else search_query,
                }
            )

    if not tasks:
        return []

    # Resolve each hosted tiler once; MPC-only collections resolve none.
    tilers_by_name: dict[str, object] = {}
    for name in {t["tiler_name"] for t in tasks if t["any_needs_hosted"]}:
        try:
            tilers_by_name[name] = providers.resolve_tiler(name)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Unknown tiler '{name}'") from None

    logger.info(
        "Registering %d mosaic slices in parallel (%d need MPC, %d need hosted)",
        len(tasks),
        sum(1 for t in tasks if t["any_uses_mpc"]),
        sum(1 for t in tasks if t["any_needs_hosted"]),
    )

    # Everything registration needs is now snapshotted into `tasks`; release the
    # read transaction (returns the connection to the pool) so it isn't held idle
    # across the slow parallel STAC calls below. The write phase re-acquires.
    db.commit()

    # Collect user-facing error messages (no internal details)
    registration_errors: list[dict] = []

    def _register_one_with_retry(task: dict) -> tuple[int, str | None, str | None]:
        """Returns (slice_id, mpc_search_id_or_none, hosted_search_id_or_none).

        A slice can need MPC, a hosted tiler, or both depending on the mix of
        per-visualization params. If a required registration fails after retries, the
        corresponding result is None and an error is recorded.
        """
        slice_ref = task["slice"]
        stac = task["stac"]
        dt_range = f"{slice_ref.start_date}T00:00:00Z/{slice_ref.end_date}T23:59:59Z"
        custom_query = task.get("search_query")

        def _run(fn, label: str):
            last_error = ""
            for attempt in range(MAX_RETRIES + 1):
                try:
                    return fn()
                except Exception as e:
                    last_error = _sanitize_stac_error(e)
                    if attempt < MAX_RETRIES:
                        time.sleep(1 * (attempt + 1))
                        continue
                    logger.warning(
                        "%s registration failed after %d retries for %s slice %s (%s)",
                        label,
                        MAX_RETRIES,
                        task["collection_name"],
                        slice_ref.name,
                        dt_range,
                        exc_info=True,
                    )
                    registration_errors.append(
                        {
                            "collection": task["collection_name"],
                            "slice": slice_ref.name,
                            "datetime": dt_range,
                            "error": last_error,
                        }
                    )
                    return None

        mpc_search_id = None
        hosted_search_id = None
        if task["any_uses_mpc"]:
            mpc_search_id = _run(
                lambda: _register_mpc_slice(stac, slice_ref, bbox, custom_query), "MPC"
            )
        if task["any_needs_hosted"]:
            hosted_search_id = _run(
                lambda: _register_hosted_slice(
                    stac,
                    slice_ref,
                    bbox,
                    custom_query,
                    campaign_id,
                    tilers_by_name[task["tiler_name"]],
                ),
                "Hosted tiler",
            )
        return slice_ref.id, mpc_search_id, hosted_search_id

    # Execute all in parallel. slice_id -> (mpc_search_id | None, hosted_search_id | None)
    results: dict[int, tuple[str | None, str | None]] = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_register_one_with_retry, t): t for t in tasks}
        for future in as_completed(futures):
            slice_id, mpc_search_id, hosted_search_id = future.result()
            results[slice_id] = (mpc_search_id, hosted_search_id)

    succeeded = sum(1 for _, (m, h) in results.items() if (m is not None or h is not None))
    logger.info("Mosaic registration complete: %d/%d slices succeeded", succeeded, len(tasks))

    task_by_slice: dict[int, dict] = {t["slice"].id: t for t in tasks}

    # Emit one SliceTileUrl per visualization, routed per provider.
    for slice_id, (mpc_search_id, hosted_search_id) in results.items():
        task = task_by_slice[slice_id]
        stac = task["stac"]
        for viz_name, params in task["viz_params_by_name"].items():
            if providers.select_provider(stac.catalog_url, params) == "mpc":
                if mpc_search_id is None:
                    continue
                tile_url = providers.build_tile_url(
                    "mpc", mpc_search_id, params, collection_id=stac.stac_collection_id
                )
                provider_name, ref = "mpc", mpc_search_id
            else:
                if hosted_search_id is None:
                    continue
                tile_url = providers.build_tile_url(
                    "hosted",
                    hosted_search_id,
                    params,
                    tiler=tilers_by_name[task["tiler_name"]],
                )
                provider_name, ref = task["tiler_name"], hosted_search_id
            db.add(
                SliceTileUrl(
                    slice_id=slice_id,
                    visualization_name=viz_name,
                    tile_url=tile_url,
                    tile_provider=provider_name,
                    mosaic_id=ref,
                )
            )

    return registration_errors


def spawn_background_mosaic_registration(
    campaign_id: int,
    pending_registrations: list[tuple],
    bbox: list[float],
) -> None:
    """Run mosaic registration on a daemon thread with its own DB session.

    Registration makes many slow parallel STAC calls; doing it inline holds the
    request's write transaction open across them and trips the
    idle-in-transaction backstop. The request commits the entity reconciliation
    (and marks the campaign `registering`) first, then calls this to rebuild the
    tile URLs and flip `registration_status` to ready/failed when done.

    Collection ids are captured now, while the ORM objects are still attached to
    the request session; the thread re-fetches them against its own session so
    it never touches a detached or cross-thread instance.
    """
    reg_specs = [
        (col.id, col_create, src_create) for col, col_create, src_create in pending_registrations
    ]

    def _run() -> None:
        bg_db = SessionLocal()
        try:
            logger.info("Background mosaic registration started for campaign %d", campaign_id)
            pending = [
                (col, col_create, src_create)
                for col_id, col_create, src_create in reg_specs
                if (col := bg_db.get(ImageryCollection, col_id)) is not None
            ]
            errors = _register_all_stac_browser_collections(bg_db, pending, bbox, campaign_id)
            bg_campaign = bg_db.get(Campaign, campaign_id)
            if bg_campaign:
                bg_campaign.registration_status = "failed" if errors else "ready"
                if errors:
                    # Merge with any existing errors (embeddings may have written some).
                    bg_campaign.registration_errors = (
                        bg_campaign.registration_errors or []
                    ) + errors
                bg_db.commit()
            if errors:
                logger.warning(
                    "Mosaic registration for campaign %d: %d errors", campaign_id, len(errors)
                )
            else:
                logger.info("Mosaic registration completed for campaign %d", campaign_id)
        except Exception as exc:
            logger.exception("Mosaic registration failed for campaign %d", campaign_id)
            try:
                bg_campaign = bg_db.get(Campaign, campaign_id)
                if bg_campaign:
                    bg_campaign.registration_status = "failed"
                    bg_campaign.registration_errors = (bg_campaign.registration_errors or []) + [
                        {"error": str(exc)}
                    ]
                    bg_db.commit()
            except Exception:
                logger.warning("Failed to persist registration error status", exc_info=True)
        finally:
            bg_db.close()

    threading.Thread(target=_run, daemon=True).start()


def _resolved_search_body(search_query: dict | None, bbox: list[float], db_slice) -> dict:
    """Deepcopy the CQL2-JSON query and inject bbox + this slice's datetime.

    Shared by MPC and hosted-tiler registration so both register the identical search.
    """
    import copy

    if not search_query:
        raise ValueError(
            "search_query is required for registration. "
            "The frontend must provide the full CQL2-JSON query."
        )
    body = copy.deepcopy(search_query)
    body["bbox"] = bbox
    _inject_datetime_into_query(
        body,
        f"{db_slice.start_date}T00:00:00Z",
        f"{db_slice.end_date}T23:59:59Z",
    )
    body.setdefault("filterLang", "cql2-json")
    return body


def _register_mpc_slice(stac, db_slice, bbox: list[float], search_query: dict | None = None) -> str:
    """Register a single slice mosaic via MPC's own tiler. Returns its searchid."""
    import httpx

    body = _resolved_search_body(search_query, bbox, db_slice)
    resp = httpx.post(MPC_REGISTER_URL, json=body, timeout=30)
    resp.raise_for_status()
    return resp.json()["searchid"]


def _register_hosted_slice(stac, db_slice, bbox, search_query, campaign_id, tiler) -> str:
    """Ingest the slice's AOI into the hosted tiler's pgstac, then register the search.

    Returns the tiler's search id. The tiler runs the ingest server-side (the backend never
    writes to the tiler DB); ingest is skipped for tilers that serve only pre-loaded data.
    """
    dt_range = f"{db_slice.start_date}T00:00:00Z/{db_slice.end_date}T23:59:59Z"
    if tiler.allows_ingest:
        providers.ingest_on_tiler(
            tiler,
            stac.catalog_url,
            stac.stac_collection_id,
            bbox,
            dt_range,
            stac.max_cloud_cover,
        )
    body = _resolved_search_body(search_query, bbox, db_slice)
    return providers.register_on_tiler(
        tiler, body, campaign_id, internal_storage=stac.internal_storage
    )


def _inject_datetime_into_query(body: dict, start: str, end: str) -> None:
    """Replace datetime placeholders in a CQL2-JSON filter body,
    or inject a datetime filter if none exists."""
    import json

    body_str = json.dumps(body)
    if "{sliceStart}" in body_str or "{sliceEnd}" in body_str:
        body_str = body_str.replace("{sliceStart}", start)
        body_str = body_str.replace("{sliceEnd}", end)
        body.clear()
        body.update(json.loads(body_str))
        return

    # If no placeholder, ensure datetime is set at top level for pystac_client compatibility
    if "datetime" not in body:
        body["datetime"] = f"{start}/{end}"


# ============================================================================
# STAC Re-registration (bbox change)
# ============================================================================


def re_register_stac_collections(db: Session, campaign_id: int, bbox: list[float]) -> int:
    """Re-register every stac_browser collection in a campaign with a new bbox.

    Returns the number of collections updated.
    """

    sources = (
        db.execute(select(ImagerySource).where(ImagerySource.campaign_id == campaign_id))
        .scalars()
        .all()
    )

    updated = 0
    for source in sources:
        for collection in source.collections:
            stac = collection.stac_config
            if not stac or not stac.catalog_url:
                continue

            slices = (
                db.execute(
                    select(ImagerySlice)
                    .where(ImagerySlice.collection_id == collection.id)
                    .order_by(ImagerySlice.display_order)
                )
                .scalars()
                .all()
            )
            if not slices:
                continue

            collection_updated = False
            for sl_idx, sl in enumerate(slices):
                is_cover = collection.has_dedicated_cover and sl_idx == collection.cover_slice_index
                custom_query = (
                    stac.cover_search_query
                    if (is_cover and stac.cover_search_query)
                    else stac.search_query
                )

                # Register once per provider this slice uses (shared across its vizs); "mpc"
                # or a configured tiler name. Each provider is isolated so one failing
                # doesn't drop the other.
                refs: dict[str, str] = {}
                for provider in {tu.tile_provider for tu in sl.tile_urls if tu.tile_provider}:
                    try:
                        if provider == "mpc":
                            refs[provider] = _register_mpc_slice(stac, sl, bbox, custom_query)
                        else:
                            refs[provider] = _register_hosted_slice(
                                stac,
                                sl,
                                bbox,
                                custom_query,
                                campaign_id,
                                providers.resolve_tiler(provider),
                            )
                    except Exception:
                        logger.warning(
                            "STAC re-registration failed for collection %s slice %s provider %s",
                            collection.name,
                            sl.name,
                            provider,
                            exc_info=True,
                        )

                # Rebuild each visualization's URL with its own params + the slice's new ref.
                for tu in sl.tile_urls:
                    ref = refs.get(tu.tile_provider)
                    if ref is None:
                        continue
                    params = _slice_viz_params(stac, tu.visualization_name, is_cover)
                    if tu.tile_provider == "mpc":
                        tu.tile_url = providers.build_tile_url(
                            "mpc", ref, params, collection_id=stac.stac_collection_id
                        )
                    else:
                        tu.tile_url = providers.build_tile_url(
                            "hosted", ref, params, tiler=providers.resolve_tiler(tu.tile_provider)
                        )
                    tu.mosaic_id = ref
                    collection_updated = True

            if collection_updated:
                updated += 1

    return updated


def refresh_collection_imagery(
    db: Session,
    collection_id: int,
    bbox: list[float],
) -> dict:
    """Re-search STAC catalog with stored params, update mosaic items.

    Returns dict with status and registered_at.
    """
    from datetime import datetime as dt

    collection = db.execute(
        select(ImageryCollection).where(ImageryCollection.id == collection_id)
    ).scalar_one_or_none()
    if not collection or not collection.stac_config:
        raise HTTPException(status_code=404, detail="Collection not found or no STAC config")

    stac = collection.stac_config
    if not stac.catalog_url or not stac.stac_collection_id:
        raise HTTPException(status_code=400, detail="Collection is not a STAC browser collection")

    slices = (
        db.execute(
            select(ImagerySlice)
            .where(ImagerySlice.collection_id == collection.id)
            .order_by(ImagerySlice.display_order)
        )
        .scalars()
        .all()
    )

    refreshed_count = 0
    for sl in slices:
        # Re-ingest the slice's AOI into the hosted tiler's pgstac; the registered search
        # auto-picks-up new items, so the tile URL is unchanged. MPC manages its own; direct
        # URLs and ingest-incapable tilers (pre-loaded data) have nothing to refresh.
        hosted_tu = next(
            (
                tu
                for tu in sl.tile_urls
                if tu.tile_provider and tu.tile_provider != "mpc" and tu.mosaic_id
            ),
            None,
        )
        if not hosted_tu:
            continue
        tiler = providers.resolve_tiler(hosted_tu.tile_provider)
        if not tiler.allows_ingest:
            continue

        dt_range = f"{sl.start_date}T00:00:00Z/{sl.end_date}T23:59:59Z"
        try:
            providers.ingest_on_tiler(
                tiler,
                stac.catalog_url,
                stac.stac_collection_id,
                bbox,
                dt_range,
                stac.max_cloud_cover,
            )
            refreshed_count += 1
        except Exception:
            logger.warning("Refresh failed for slice %s", sl.name, exc_info=True)

    db.flush()
    return {
        "status": "refreshed",
        "slices_updated": refreshed_count,
        "registered_at": dt.utcnow().isoformat(),
    }


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

        window_ids = [r["collection_id"] for r in mapped_refs if r.get("show_as_window")]
        db.add(new_default_view_layout(campaign_id, view.id, window_ids))

        created.append(view)

    return created


# ============================================================================
# Deletion
# ============================================================================

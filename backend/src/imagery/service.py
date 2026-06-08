import logging
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from src.campaigns.constants import (
    VIEW_LAYOUT_COLS_PER_ROW,
    VIEW_LAYOUT_START_Y,
    VIEW_LAYOUT_WINDOW_H,
    VIEW_LAYOUT_WINDOW_W,
)
from src.campaigns.models import Campaign, CampaignUser, CanvasLayout
from src.imagery.models import (
    Basemap,
    CollectionStacConfig,
    ImageryCollection,
    ImagerySlice,
    ImagerySource,
    ImageryView,
    MosaicItem,
    MosaicRegistration,
    SliceTileUrl,
    VisualizationTemplate,
)
from src.imagery.schemas import (
    BasemapCreate,
    CanvasLayoutCreate,
    ImageryCollectionCreate,
    ImageryEditorStateCreate,
    ImagerySourceCreate,
    ImageryViewCreate,
)
from src.tiling.router import build_viz_query_string, register_mosaic_sync
from src.tiling.stac_client import _is_mpc


def _bbox_to_wkt(west: float, south: float, east: float, north: float) -> str:
    """Convert bbox to WKT POLYGON for PostGIS ST_GeomFromText."""
    return (
        f"SRID=4326;POLYGON(({west} {south},{east} {south},"
        f"{east} {north},{west} {north},{west} {south}))"
    )


logger = logging.getLogger(__name__)


def _payload_has_dedicated_cover(col_create: ImageryCollectionCreate) -> bool:
    return bool(col_create.has_dedicated_cover)


def _serialize_visualizations(stac_config, has_cover: bool) -> list[dict] | None:
    """Full per-visualization params list for CollectionStacConfig.visualizations.

    One entry per source visualization so a roundtrip-save preserves each viz's
    params independently (the legacy viz_params blob only holds the first viz).
    """
    if not stac_config or not stac_config.visualizations:
        return None
    return [
        {
            "name": v.name,
            "viz_params": v.viz_params.model_dump(exclude_none=True),
            "cover_viz_params": (
                v.cover_viz_params.model_dump(exclude_none=True)
                if has_cover and v.cover_viz_params
                else None
            ),
        }
        for v in stac_config.visualizations
    ]


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
) -> dict:
    """Upsert the full imagery editor state in a single transaction.

    Reconciliation rules per entity (sources, collections, slices, views,
    basemaps): payload entry with `id` set → update in place; without `id` →
    create; in DB but missing from payload → delete. STAC mosaic registration
    only fires when fields that affect it (search_query, max_cloud_cover,
    viz_params, slice date list) actually changed; pure metadata edits
    (rename, cover_slice_index) skip the expensive re-search.

    Caller commits.
    """
    if not campaign.settings:
        raise HTTPException(status_code=404, detail="Campaign settings not found")

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
            _sync_view_layouts(
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
            window_refs = [r for r in mapped_refs if r.get("show_as_window")]
            db.add(
                CanvasLayout(
                    layout_data=[
                        {
                            "i": str(ref["collection_id"]),
                            **_layout_window_for(idx, VIEW_LAYOUT_START_Y),
                        }
                        for idx, ref in enumerate(window_refs)
                    ],
                    user_id=None,
                    campaign_id=campaign.id,
                    view_id=new_view.id,
                    is_default=True,
                )
            )

    # Basemaps: replace wholesale (small list, no inbound FKs).
    db.execute(delete(Basemap).where(Basemap.campaign_id == campaign.id))
    db.flush()
    created_basemaps = _create_basemaps(db, campaign.id, editor_state.basemaps)

    db.flush()

    registration_errors: list[dict] = []
    if pending_registrations:
        registration_errors = _register_all_stac_browser_collections(
            db, pending_registrations, bbox
        )

    return {
        "sources": campaign.imagery_sources,
        "views": campaign.imagery_views,
        "basemaps": created_basemaps,
        "pending_registrations": pending_registrations,
        "registration_errors": registration_errors,
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
            # references entities by index (matches the legacy _create_views).
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
    """Cheap deep-compare of fields that require mosaic re-registration."""
    if existing is None:
        return True
    first_viz = incoming.visualizations[0] if incoming.visualizations else None
    new_viz_params = first_viz.viz_params.model_dump(exclude_none=True) if first_viz else None
    new_cover_viz_params = (
        first_viz.cover_viz_params.model_dump(exclude_none=True)
        if first_viz and first_viz.cover_viz_params
        else None
    )
    return (
        existing.viz_params != new_viz_params
        or existing.cover_viz_params != new_cover_viz_params
        or existing.max_cloud_cover != incoming.max_cloud_cover
        or existing.search_query != incoming.search_query
        or existing.cover_search_query != incoming.cover_search_query
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
    for name, viz in list(existing_viz.items()):
        if name not in payload_names:
            db.delete(viz)
    for viz_idx, viz in enumerate(src_create.visualizations):
        if viz.name in existing_viz:
            existing_viz[viz.name].display_order = viz_idx
        else:
            db.add(VisualizationTemplate(source_id=db_src.id, name=viz.name, display_order=viz_idx))

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
            first_viz = (
                col_create.stac_config.visualizations[0]
                if col_create.stac_config.visualizations
                else None
            )
            db.add(
                CollectionStacConfig(
                    collection_id=db_col.id,
                    catalog_url=col_create.stac_config.catalog_url,
                    stac_collection_id=col_create.stac_config.stac_collection_id,
                    viz_params=(
                        first_viz.viz_params.model_dump(exclude_none=True) if first_viz else None
                    ),
                    cover_viz_params=(
                        first_viz.cover_viz_params.model_dump(exclude_none=True)
                        if has_cover and first_viz and first_viz.cover_viz_params
                        else None
                    ),
                    visualizations=_serialize_visualizations(col_create.stac_config, has_cover),
                    max_cloud_cover=col_create.stac_config.max_cloud_cover,
                    search_query=col_create.stac_config.search_query,
                    cover_search_query=(
                        col_create.stac_config.cover_search_query if has_cover else None
                    ),
                )
            )
            needs_reregistration = True
        else:
            if _stac_config_changed(db_col.stac_config, col_create.stac_config):
                needs_reregistration = True
            first_viz = (
                col_create.stac_config.visualizations[0]
                if col_create.stac_config.visualizations
                else None
            )
            db_col.stac_config.viz_params = (
                first_viz.viz_params.model_dump(exclude_none=True) if first_viz else None
            )
            db_col.stac_config.cover_viz_params = (
                first_viz.cover_viz_params.model_dump(exclude_none=True)
                if has_cover and first_viz and first_viz.cover_viz_params
                else None
            )
            db_col.stac_config.visualizations = _serialize_visualizations(
                col_create.stac_config, has_cover
            )
            db_col.stac_config.max_cloud_cover = col_create.stac_config.max_cloud_cover
            db_col.stac_config.search_query = col_create.stac_config.search_query
            db_col.stac_config.cover_search_query = (
                col_create.stac_config.cover_search_query if has_cover else None
            )
            flag_modified(db_col.stac_config, "search_query")
            flag_modified(db_col.stac_config, "cover_search_query")
            flag_modified(db_col.stac_config, "visualizations")

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
        first_viz = (
            col_create.stac_config.visualizations[0]
            if col_create.stac_config.visualizations
            else None
        )
        db.add(
            CollectionStacConfig(
                collection_id=collection.id,
                catalog_url=col_create.stac_config.catalog_url,
                stac_collection_id=col_create.stac_config.stac_collection_id,
                viz_params=(
                    first_viz.viz_params.model_dump(exclude_none=True) if first_viz else None
                ),
                cover_viz_params=(
                    first_viz.cover_viz_params.model_dump(exclude_none=True)
                    if has_cover and first_viz and first_viz.cover_viz_params
                    else None
                ),
                visualizations=_serialize_visualizations(col_create.stac_config, has_cover),
                max_cloud_cover=col_create.stac_config.max_cloud_cover,
                search_query=col_create.stac_config.search_query,
                cover_search_query=(
                    col_create.stac_config.cover_search_query if has_cover else None
                ),
            )
        )

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
MPC_TILES_BASE = "https://planetarycomputer.microsoft.com/api/data/v1/mosaic/{searchId}/tiles/WebMercatorQuad/{z}/{x}/{y}"


def _register_all_stac_browser_collections(
    db: Session,
    pending: list[tuple],
    bbox: list[float],
) -> list[dict]:
    """Register mosaics for all stac_browser collections in parallel with retries.
    Returns a list of error dicts for failed slices (empty on full success).

    Persists MosaicRegistration + MosaicItem rows to DB and bakes viz params
    into the stored tile URLs so the frontend doesn't need to build them.
    """
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from datetime import datetime as dt

    MAX_WORKERS = 16
    MAX_RETRIES = 2

    # Build a flat list of tasks
    tasks: list[dict] = []
    for collection, col_create, src_create in pending:
        stac = col_create.stac_config
        is_mpc = _is_mpc(stac.catalog_url or "")

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

            # Per-viz MPC eligibility: MPC catalog + first-valid compositing + no masking
            def _mpc_eligible(p: dict, is_mpc: bool = is_mpc) -> bool:
                comp = p.get("compositing")
                return is_mpc and (not comp or comp == "first") and not p.get("mask_layer")

            any_uses_mpc = any(_mpc_eligible(p) for p in slice_viz_by_name.values())
            any_needs_local = any(not _mpc_eligible(p) for p in slice_viz_by_name.values())

            tasks.append(
                {
                    "db_slice": db_slice,
                    "stac": stac,
                    "viz_params_by_name": slice_viz_by_name,
                    "any_uses_mpc": any_uses_mpc,
                    "any_needs_local": any_needs_local,
                    "collection_name": collection.name,
                    "search_query": cover_search_query
                    if (is_cover and cover_search_query)
                    else search_query,
                }
            )

    if not tasks:
        return

    total_mpc = sum(1 for t in tasks if t["any_uses_mpc"])
    total_local = sum(1 for t in tasks if t["any_needs_local"])
    logger.info(
        "Registering %d mosaic slices in parallel (%d need MPC, %d need local)",
        len(tasks),
        total_mpc,
        total_local,
    )

    # Collect user-facing error messages (no internal details)
    registration_errors: list[dict] = []

    def _register_one_with_retry(task: dict) -> tuple[int, str | None, dict | None]:
        """Returns (slice_id, mpc_search_id_or_none, local_result_or_none).

        A slice can need MPC, local, or both depending on the mix of
        per-visualization params. If a required registration fails after
        retries, the corresponding result is None and an error is recorded.
        """
        db_slice = task["db_slice"]
        stac = task["stac"]
        need_mpc = task["any_uses_mpc"]
        need_local = task["any_needs_local"]
        dt_range = f"{db_slice.start_date}T00:00:00Z/{db_slice.end_date}T23:59:59Z"
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
                        db_slice.name,
                        dt_range,
                        exc_info=True,
                    )
                    registration_errors.append(
                        {
                            "collection": task["collection_name"],
                            "slice": db_slice.name,
                            "datetime": dt_range,
                            "error": last_error,
                        }
                    )
                    return None

        mpc_search_id = None
        local_result = None
        if need_mpc:
            mpc_search_id = _run(
                lambda: _register_mpc_slice(stac, db_slice, bbox, custom_query), "MPC"
            )
        if need_local:
            local_result = _run(
                lambda: register_mosaic_sync(
                    catalog_url=stac.catalog_url,
                    collection_id=stac.stac_collection_id,
                    bbox=bbox,
                    datetime_range=dt_range,
                    search_query=custom_query,
                ),
                "Local mosaic",
            )
        return db_slice.id, mpc_search_id, local_result

    # Execute all in parallel
    # slice_id -> (mpc_search_id | None, local_result | None)
    results: dict[int, tuple[str | None, dict | None]] = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_register_one_with_retry, t): t for t in tasks}
        for future in as_completed(futures):
            slice_id, mpc_search_id, local_result = future.result()
            results[slice_id] = (mpc_search_id, local_result)

    succeeded = sum(
        1 for _, (mpc_id, local) in results.items() if (mpc_id is not None or local is not None)
    )
    logger.info(
        "Mosaic registration complete: %d/%d slices succeeded",
        succeeded,
        len(tasks),
    )

    # Build lookups
    task_by_slice: dict[int, dict] = {t["db_slice"].id: t for t in tasks}

    def _mpc_eligible_params(p: dict, is_mpc_catalog: bool) -> bool:
        comp = p.get("compositing")
        return is_mpc_catalog and (not comp or comp == "first") and not p.get("mask_layer")

    # Persist tile URLs and mosaic registrations
    for slice_id, (mpc_search_id, local_result) in results.items():
        task = task_by_slice[slice_id]
        viz_params_by_name: dict[str, dict] = task["viz_params_by_name"]
        stac = task["stac"]
        is_mpc_catalog = _is_mpc(stac.catalog_url or "")

        # Persist local mosaic registration + items once per slice (shared across vizs)
        local_mosaic_id = None
        if local_result is not None:
            local_mosaic_id = local_result["mosaic_id"]
            item_refs = local_result["item_refs"]

            db_slice = task["db_slice"]
            datetime_range = f"{db_slice.start_date}T00:00:00Z/{db_slice.end_date}T23:59:59Z"
            existing_reg = db.execute(
                select(MosaicRegistration).where(MosaicRegistration.mosaic_id == local_mosaic_id)
            ).scalar_one_or_none()
            if existing_reg:
                existing_reg.item_count = len(item_refs)
                existing_reg.assets_info = local_result.get("assets")
                existing_reg.status = "ready" if item_refs else "empty"
                existing_reg.registered_at = dt.utcnow()
                existing_reg.error_message = None
                db.execute(delete(MosaicItem).where(MosaicItem.mosaic_id == local_mosaic_id))
            else:
                db.add(
                    MosaicRegistration(
                        mosaic_id=local_mosaic_id,
                        catalog_url=stac.catalog_url,
                        stac_collection_id=stac.stac_collection_id,
                        bbox=bbox,
                        datetime_range=datetime_range,
                        max_cloud_cover=stac.max_cloud_cover,
                        item_count=len(item_refs),
                        assets_info=local_result.get("assets"),
                        status="ready" if item_refs else "empty",
                        registered_at=dt.utcnow(),
                    )
                )
            db.flush()

            for ref in item_refs:
                db.add(
                    MosaicItem(
                        mosaic_id=local_mosaic_id,
                        item_id=ref["id"],
                        href=ref["href"],
                        bbox_west=ref["bbox"][0],
                        bbox_south=ref["bbox"][1],
                        bbox_east=ref["bbox"][2],
                        bbox_north=ref["bbox"][3],
                        datetime=ref.get("datetime", ""),
                        cloud_cover=ref.get("cloud_cover"),
                        geom=_bbox_to_wkt(
                            ref["bbox"][0], ref["bbox"][1], ref["bbox"][2], ref["bbox"][3]
                        ),
                        stac_item=ref.get("stac_item"),
                    )
                )

        # Emit one SliceTileUrl per visualization, routed per viz
        for viz_name, params in viz_params_by_name.items():
            uses_mpc = _mpc_eligible_params(params, is_mpc_catalog)

            if uses_mpc:
                if mpc_search_id is None:
                    # MPC registration failed for this slice - skip
                    continue
                base_url = (
                    MPC_TILES_BASE.replace("{searchId}", mpc_search_id)
                    + f"?collection={stac.stac_collection_id}&pixel_selection=first"
                )
                viz_qs = build_viz_query_string(params, for_mpc=True)
                tile_url = f"{base_url}&{viz_qs}" if viz_qs else base_url
                db.add(
                    SliceTileUrl(
                        slice_id=slice_id,
                        visualization_name=viz_name,
                        tile_url=tile_url,
                        tile_provider="mpc",
                    )
                )
            else:
                if local_mosaic_id is None:
                    # Local mosaic registration failed for this slice - skip
                    continue
                base_url = f"/api/stac/mosaic/{local_mosaic_id}/tiles/{{z}}/{{x}}/{{y}}.png"
                viz_qs = build_viz_query_string(params)
                tile_url = f"{base_url}?{viz_qs}" if viz_qs else base_url
                db.add(
                    SliceTileUrl(
                        slice_id=slice_id,
                        visualization_name=viz_name,
                        tile_url=tile_url,
                        tile_provider="self_hosted",
                        mosaic_id=local_mosaic_id,
                    )
                )

    return registration_errors


def _register_mpc_slice(stac, db_slice, bbox: list[float], search_query: dict | None = None) -> str:
    """Register a single slice mosaic via MPC. Returns searchid.

    The search_query is the CQL2-JSON body built by the frontend.
    Bbox and datetime ({sliceDatetime} placeholder) are injected.
    """
    import copy

    import httpx

    if not search_query:
        raise ValueError(
            "search_query is required for MPC registration. "
            "The frontend must provide the full CQL2-JSON query."
        )

    search_body = copy.deepcopy(search_query)
    search_body["bbox"] = bbox
    _inject_datetime_into_query(
        search_body,
        f"{db_slice.start_date}T00:00:00Z",
        f"{db_slice.end_date}T23:59:59Z",
    )
    if "filterLang" not in search_body:
        search_body["filterLang"] = "cql2-json"

    resp = httpx.post(MPC_REGISTER_URL, json=search_body, timeout=30)
    resp.raise_for_status()
    return resp.json()["searchid"]


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
    from datetime import datetime as dt

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
                viz_params = (
                    stac.cover_viz_params
                    if (is_cover and stac.cover_viz_params)
                    else stac.viz_params
                )
                dt_range = f"{sl.start_date}T00:00:00Z/{sl.end_date}T23:59:59Z"

                for tu in sl.tile_urls:
                    try:
                        if tu.tile_provider == "self_hosted":
                            result = register_mosaic_sync(
                                catalog_url=stac.catalog_url,
                                collection_id=stac.stac_collection_id,
                                bbox=bbox,
                                datetime_range=dt_range,
                                search_query=custom_query,
                            )
                            mosaic_id = result["mosaic_id"]
                            item_refs = result["item_refs"]

                            reg = db.execute(
                                select(MosaicRegistration).where(
                                    MosaicRegistration.mosaic_id == mosaic_id
                                )
                            ).scalar_one_or_none()
                            if reg:
                                reg.item_count = len(item_refs)
                                reg.assets_info = result.get("assets")
                                reg.status = "ready" if item_refs else "empty"
                                reg.registered_at = dt.utcnow()
                                reg.error_message = None
                                db.execute(
                                    delete(MosaicItem).where(MosaicItem.mosaic_id == mosaic_id)
                                )
                            else:
                                db.add(
                                    MosaicRegistration(
                                        mosaic_id=mosaic_id,
                                        catalog_url=stac.catalog_url,
                                        stac_collection_id=stac.stac_collection_id,
                                        bbox=bbox,
                                        datetime_range=dt_range,
                                        max_cloud_cover=stac.max_cloud_cover,
                                        item_count=len(item_refs),
                                        assets_info=result.get("assets"),
                                        status="ready" if item_refs else "empty",
                                        registered_at=dt.utcnow(),
                                    )
                                )
                            db.flush()
                            for ref in item_refs:
                                db.add(
                                    MosaicItem(
                                        mosaic_id=mosaic_id,
                                        item_id=ref["id"],
                                        href=ref["href"],
                                        bbox_west=ref["bbox"][0],
                                        bbox_south=ref["bbox"][1],
                                        bbox_east=ref["bbox"][2],
                                        bbox_north=ref["bbox"][3],
                                        datetime=ref.get("datetime", ""),
                                        cloud_cover=ref.get("cloud_cover"),
                                        geom=_bbox_to_wkt(
                                            ref["bbox"][0],
                                            ref["bbox"][1],
                                            ref["bbox"][2],
                                            ref["bbox"][3],
                                        ),
                                        stac_item=ref.get("stac_item"),
                                    )
                                )
                            base_url = f"/api/stac/mosaic/{mosaic_id}/tiles/{{z}}/{{x}}/{{y}}.png"
                            viz_qs = build_viz_query_string(viz_params)
                            tu.tile_url = f"{base_url}?{viz_qs}" if viz_qs else base_url
                            tu.mosaic_id = mosaic_id
                            collection_updated = True

                        elif tu.tile_provider == "mpc":
                            mpc_search_id = _register_mpc_slice(stac, sl, bbox, custom_query)
                            base_url = (
                                MPC_TILES_BASE.replace("{searchId}", mpc_search_id)
                                + f"?collection={stac.stac_collection_id}&pixel_selection=first"
                            )
                            viz_qs = build_viz_query_string(viz_params, for_mpc=True)
                            tu.tile_url = f"{base_url}&{viz_qs}" if viz_qs else base_url
                            collection_updated = True

                    except Exception:
                        logger.warning(
                            "STAC re-registration failed for collection %s slice %s",
                            collection.name,
                            sl.name,
                            exc_info=True,
                        )

            if collection_updated:
                updated += 1

    return updated


def update_collection_viz_params(
    db: Session,
    collection_id: int,
    viz_by_name: dict[str, dict] | None = None,
    cover_viz_by_name: dict[str, dict] | None = None,
) -> None:
    """Rebuild tile URLs with new per-visualization params (no STAC re-search needed).

    viz_by_name: { "True Color": {assets: [...], rescale: ...}, "NDVI": {...} }
    cover_viz_by_name: optional overrides for cover slice (same shape)

    Updates the stac_config (stores first viz's params for backward compat)
    and reconstructs the query-string portion of all SliceTileUrl rows.
    """
    from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

    if not viz_by_name:
        return

    collection = db.execute(
        select(ImageryCollection).where(ImageryCollection.id == collection_id)
    ).scalar_one_or_none()
    if not collection or not collection.stac_config:
        return

    stac = collection.stac_config
    # Store first viz params on stac_config for backward compat / display
    first_params = next(iter(viz_by_name.values()), None)
    stac.viz_params = first_params
    first_cover = (
        next(iter((cover_viz_by_name or {}).values()), None) if cover_viz_by_name else None
    )
    stac.cover_viz_params = first_cover if collection.has_dedicated_cover else None
    # Keep the authoritative per-viz list in sync so a load roundtrip preserves
    # each visualization's params independently.
    stac.visualizations = [
        {
            "name": name,
            "viz_params": params,
            "cover_viz_params": (
                (cover_viz_by_name or {}).get(name) if collection.has_dedicated_cover else None
            ),
        }
        for name, params in viz_by_name.items()
    ]
    flag_modified(stac, "visualizations")

    slices = (
        db.execute(
            select(ImagerySlice)
            .where(ImagerySlice.collection_id == collection.id)
            .order_by(ImagerySlice.display_order)
        )
        .scalars()
        .all()
    )

    for sl_idx, sl in enumerate(slices):
        is_cover = collection.has_dedicated_cover and sl_idx == collection.cover_slice_index

        # A visualization added after this collection was first registered has no
        # tile URL row yet. Clone one from any sibling on the same slice (same
        # provider / mosaic) so every viz becomes switchable - the rebuild loop
        # below then bakes its own params into the cloned URL.
        existing_names = {tu.visualization_name for tu in sl.tile_urls}
        template = sl.tile_urls[0] if sl.tile_urls else None
        if template is not None:
            for name in viz_by_name:
                if name in existing_names:
                    continue
                clone = SliceTileUrl(
                    slice_id=sl.id,
                    visualization_name=name,
                    tile_url=template.tile_url,
                    tile_provider=template.tile_provider,
                    mosaic_id=template.mosaic_id,
                )
                db.add(clone)
                sl.tile_urls.append(clone)

        for tu in sl.tile_urls:
            # Pick params for this specific visualization
            if is_cover and cover_viz_by_name and tu.visualization_name in cover_viz_by_name:
                params = cover_viz_by_name[tu.visualization_name]
            elif tu.visualization_name in viz_by_name:
                params = viz_by_name[tu.visualization_name]
            else:
                params = first_params

            if tu.tile_provider == "self_hosted" and tu.mosaic_id:
                viz_qs = build_viz_query_string(params)
                base = f"/api/stac/mosaic/{tu.mosaic_id}/tiles/{{z}}/{{x}}/{{y}}.png"
                tu.tile_url = f"{base}?{viz_qs}" if viz_qs else base
            elif tu.tile_provider == "mpc":
                viz_qs = build_viz_query_string(params, for_mpc=True)
                parsed = urlparse(tu.tile_url)
                existing = parse_qs(parsed.query, keep_blank_values=True)
                kept = {
                    k: v[0] for k, v in existing.items() if k in ("collection", "pixel_selection")
                }
                new_qs = urlencode(list(kept.items()))
                if viz_qs:
                    new_qs = f"{new_qs}&{viz_qs}" if new_qs else viz_qs
                tu.tile_url = urlunparse(parsed._replace(query=new_qs))

    db.flush()


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
    for sl_idx, sl in enumerate(slices):
        is_cover = collection.has_dedicated_cover and sl_idx == collection.cover_slice_index
        custom_query = (
            stac.cover_search_query if (is_cover and stac.cover_search_query) else stac.search_query
        )
        viz_params = (
            stac.cover_viz_params if (is_cover and stac.cover_viz_params) else stac.viz_params
        )

        # Only refresh self_hosted mosaics (MPC manages its own)
        for tu in sl.tile_urls:
            if tu.tile_provider != "self_hosted" or not tu.mosaic_id:
                continue

            dt_range = f"{sl.start_date}T00:00:00Z/{sl.end_date}T23:59:59Z"
            try:
                result = register_mosaic_sync(
                    catalog_url=stac.catalog_url,
                    collection_id=stac.stac_collection_id,
                    bbox=bbox,
                    datetime_range=dt_range,
                    search_query=custom_query,
                )
                mosaic_id = result["mosaic_id"]
                item_refs = result["item_refs"]

                # Update MosaicRegistration
                reg = db.execute(
                    select(MosaicRegistration).where(MosaicRegistration.mosaic_id == mosaic_id)
                ).scalar_one_or_none()
                if reg:
                    reg.item_count = len(item_refs)
                    reg.assets_info = result.get("assets")
                    reg.status = "ready" if item_refs else "empty"
                    reg.registered_at = dt.utcnow()
                    reg.error_message = None
                    db.execute(delete(MosaicItem).where(MosaicItem.mosaic_id == mosaic_id))
                else:
                    db.add(
                        MosaicRegistration(
                            mosaic_id=mosaic_id,
                            catalog_url=stac.catalog_url,
                            stac_collection_id=stac.stac_collection_id,
                            bbox=bbox,
                            datetime_range=dt_range,
                            max_cloud_cover=stac.max_cloud_cover,
                            item_count=len(item_refs),
                            assets_info=result.get("assets"),
                            status="ready" if item_refs else "empty",
                            registered_at=dt.utcnow(),
                        )
                    )
                db.flush()

                for ref in item_refs:
                    db.add(
                        MosaicItem(
                            mosaic_id=mosaic_id,
                            item_id=ref["id"],
                            href=ref["href"],
                            bbox_west=ref["bbox"][0],
                            bbox_south=ref["bbox"][1],
                            bbox_east=ref["bbox"][2],
                            bbox_north=ref["bbox"][3],
                            datetime=ref.get("datetime", ""),
                            cloud_cover=ref.get("cloud_cover"),
                            geom=_bbox_to_wkt(
                                ref["bbox"][0], ref["bbox"][1], ref["bbox"][2], ref["bbox"][3]
                            ),
                            stac_item=ref.get("stac_item"),
                        )
                    )

                # Rebuild tile URL with viz params
                base_url = f"/api/stac/mosaic/{mosaic_id}/tiles/{{z}}/{{x}}/{{y}}.png"
                viz_qs = build_viz_query_string(viz_params)
                tu.tile_url = f"{base_url}?{viz_qs}" if viz_qs else base_url
                tu.mosaic_id = mosaic_id

                refreshed_count += 1
            except Exception:
                logger.warning(
                    "Refresh failed for slice %s (mosaic %s)", sl.name, tu.mosaic_id, exc_info=True
                )

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


def _layout_window_for(slot: int, base_y: int) -> dict:
    """Return a layout item dict for a given linear slot (0-indexed) and base y."""
    return {
        "x": (slot % VIEW_LAYOUT_COLS_PER_ROW) * VIEW_LAYOUT_WINDOW_W,
        "y": base_y + (slot // VIEW_LAYOUT_COLS_PER_ROW) * VIEW_LAYOUT_WINDOW_H,
        "w": VIEW_LAYOUT_WINDOW_W,
        "h": VIEW_LAYOUT_WINDOW_H,
    }


def _layout_bottom(layout_data: list | None) -> int:
    """Lowest occupied grid row (max y+h) across the items, 0 when empty."""
    return max(
        (int(it.get("y", 0)) + int(it.get("h", 0)) for it in (layout_data or [])),
        default=0,
    )


def _sync_view_layouts(
    db: Session,
    view_id: int,
    campaign_id: int,
    window_collection_ids: set[int],
    added_collection_ids: list[int],
) -> None:
    """Reconcile every canvas_layout for a view against its current windows.

    ``window_collection_ids`` is the full set of collections currently shown as
    windows in the view. Any layout item for a collection outside that set is
    dropped - this is what removes the slots of deleted collections (or ones
    toggled off), so they no longer reserve grid space or push new windows below
    a source that no longer exists. Items kept hold their positions (gaps are
    fine for react-grid-layout).

    ``added_collection_ids`` are freshly-added windows; they're appended below
    everything already on the grid. We only append the *new* ones (not the full
    window set) so a window a user has personally hidden - present in the view
    but absent from their layout - stays hidden.
    """
    valid = {str(cid) for cid in window_collection_ids}

    # The page chrome (main map / controls / minimap / timeseries) lives in the
    # view_id=NULL "main" layout and shares the same grid as the windows on the
    # client. New windows must clear it, so index each user's chrome bottom (with
    # the campaign default as the fallback for users without a personal main).
    main_layouts = (
        db.execute(
            select(CanvasLayout).where(
                CanvasLayout.campaign_id == campaign_id,
                CanvasLayout.view_id.is_(None),
            )
        )
        .scalars()
        .all()
    )
    chrome_bottom_by_user = {ml.user_id: _layout_bottom(ml.layout_data) for ml in main_layouts}
    default_chrome_bottom = chrome_bottom_by_user.get(None, VIEW_LAYOUT_START_Y)

    layouts = (
        db.execute(select(CanvasLayout).where(CanvasLayout.view_id == view_id)).scalars().all()
    )
    for layout in layouts:
        original = layout.layout_data or []
        items = [it for it in original if it.get("i") in valid]
        present = {it.get("i") for it in items}
        to_add = [cid for cid in added_collection_ids if str(cid) not in present]
        if to_add:
            chrome_bottom = chrome_bottom_by_user.get(layout.user_id, default_chrome_bottom)
            # Stack new windows below both the kept windows and the page chrome,
            # so they never overlap an existing item in the merged grid.
            base_y = max(
                max(
                    (int(it.get("y", 0)) + int(it.get("h", 0)) for it in items),
                    default=VIEW_LAYOUT_START_Y,
                ),
                chrome_bottom,
            )
            for offset, cid in enumerate(to_add):
                items.append({"i": str(cid), **_layout_window_for(offset, base_y)})
        if items != original:
            layout.layout_data = items
            flag_modified(layout, "layout_data")


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

        # Windows arrange in rows under the main canvas; gaps are kept on later
        # edits so user customizations survive collection changes (see _sync_view_layouts).
        window_refs = [r for r in mapped_refs if r.get("show_as_window")]
        view_layout_data = [
            {"i": str(ref["collection_id"]), **_layout_window_for(idx, VIEW_LAYOUT_START_Y)}
            for idx, ref in enumerate(window_refs)
        ]

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

    campaign = db.execute(select(Campaign).where(Campaign.id == campaign_id)).scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail=f"Campaign {campaign_id} not found")

    if view_id is not None:
        view = db.execute(
            select(ImageryView).where(
                ImageryView.id == view_id, ImageryView.campaign_id == campaign_id
            )
        ).scalar_one_or_none()
        if not view:
            raise HTTPException(
                status_code=404, detail=f"View {view_id} not found in campaign {campaign_id}"
            )

    if should_be_default:
        has_admin_access = db.execute(
            select(CampaignUser).where(
                CampaignUser.campaign_id == campaign_id,
                CampaignUser.user_id == user_id,
                CampaignUser.is_admin,
            )
        ).scalar_one_or_none()
        if not has_admin_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only campaign admins can modify default layouts",
            )

    result = {}

    if should_be_default:
        existing_main_layout = db.execute(
            select(CanvasLayout).where(
                CanvasLayout.campaign_id == campaign_id,
                CanvasLayout.view_id.is_(None),
                CanvasLayout.is_default,
                CanvasLayout.user_id.is_(None),
            )
        ).scalar_one_or_none()
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

            existing_view_layout = db.execute(
                select(CanvasLayout).where(
                    CanvasLayout.campaign_id == campaign_id,
                    CanvasLayout.view_id == view_id,
                    CanvasLayout.is_default,
                    CanvasLayout.user_id.is_(None),
                )
            ).scalar_one_or_none()
            if not existing_view_layout:
                raise HTTPException(
                    status_code=404,
                    detail=f"Default canvas layout not found for view {view_id}",
                )

            existing_view_layout.layout_data = layout_data.view_layout_data
            flag_modified(existing_view_layout, "layout_data")
            result["view_layout"] = existing_view_layout
    else:
        main_layout = db.execute(
            select(CanvasLayout).where(
                CanvasLayout.user_id == user_id,
                CanvasLayout.campaign_id == campaign_id,
                CanvasLayout.view_id.is_(None),
            )
        ).scalar_one_or_none()

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

            view_layout = db.execute(
                select(CanvasLayout).where(
                    CanvasLayout.user_id == user_id,
                    CanvasLayout.campaign_id == campaign_id,
                    CanvasLayout.view_id == view_id,
                )
            ).scalar_one_or_none()

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

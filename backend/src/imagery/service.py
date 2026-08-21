from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from src.campaigns.models import Campaign
from src.canvas.service import new_default_view_layout, sync_view_layouts
from src.crypto import encrypt
from src.imagery.models import (
    Basemap,
    CollectionStacConfig,
    CollectionVizConfig,
    ImageryCollection,
    ImageryGenerationSeries,
    ImagerySlice,
    ImagerySource,
    ImageryView,
    SliceTileUrl,
    VisualizationTemplate,
)
from src.imagery.registration import RegistrationSpec
from src.imagery.schemas import (
    BasemapCreate,
    CollectionStacConfigCreate,
    ImageryCollectionCreate,
    ImageryEditorStateCreate,
    ImagerySourceCreate,
    ImageryViewCreate,
    ImageryViewUpdate,
)
from src.imagery.tile_urls import update_collection_viz_params
from src.organizations.models import Organization, OrganizationApiKey
from src.tilers import providers, registry


def organization_keys(campaign: Campaign) -> list[OrganizationApiKey]:
    """The shared keys this campaign may point its imagery at: its own
    organization's, and only those."""
    return sorted(campaign.project.organization.api_keys, key=lambda k: k.name.lower())


def _apply_api_key(
    target: Basemap | ImagerySource,
    campaign: Campaign,
    value: str | None,
    organization_api_key_id: int | None,
) -> None:
    """Point the layer at one key source and clear the other, so there is never
    a question of which of the two applies."""
    if organization_api_key_id is not None:
        if all(k.id != organization_api_key_id for k in organization_keys(campaign)):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Organization API key not found"
            )
        target.encrypted_api_key = None
        target.organization_api_key_id = organization_api_key_id
        return
    target.encrypted_api_key = encrypt(value or "")
    target.organization_api_key_id = None


def set_basemap_api_key(
    db: Session,
    campaign: Campaign,
    basemap_id: int,
    *,
    value: str | None,
    organization_api_key_id: int | None,
) -> Basemap:
    """Set where a basemap's provider key comes from (campaign-scoped lookup)."""
    basemap = db.get(Basemap, basemap_id)
    if basemap is None or basemap.campaign_id != campaign.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Basemap not found")
    _apply_api_key(basemap, campaign, value, organization_api_key_id)
    return basemap


def set_source_api_key(
    db: Session,
    campaign: Campaign,
    source_id: int,
    *,
    value: str | None,
    organization_api_key_id: int | None,
) -> ImagerySource:
    """Set where an imagery source's provider key comes from."""
    source = db.get(ImagerySource, source_id)
    if source is None or source.campaign_id != campaign.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")
    _apply_api_key(source, campaign, value, organization_api_key_id)
    return source


def _registration_spec(
    collection: ImageryCollection,
    col_create: ImageryCollectionCreate,
    src_create: ImagerySourceCreate,
) -> RegistrationSpec:
    """Snapshot the plain fields `_register_all_stac_browser_collections` needs
    for one collection, decoupling the deferred registration from the ORM
    objects and request session that produced it."""
    assert col_create.stac_config is not None  # noqa: S101
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
    rows whose names are no longer present -leaving the table holding exactly
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


def _collection_providers(stac: CollectionStacConfigCreate) -> set[str]:
    """Providers a collection's tiles will actually come from, decided exactly as
    registration decides it (catalog URL + per-viz MPC eligibility). Cover overrides
    count too: they render the cover slice. A collection without visualizations still
    routes somewhere, so it is judged on empty params."""
    viz_params = [
        params.model_dump()
        for viz in stac.visualizations
        for params in (viz.viz_params, viz.cover_viz_params)
        if params is not None
    ] or [{}]
    return {providers.select_provider(stac.catalog_url, p) for p in viz_params}


def _forbidden(tiler_name: str, collection_name: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=(
            f"Your organization is not authorized to use tiler '{tiler_name}' "
            f"(collection '{collection_name}')"
        ),
    )


def _resolve_tilers(org: Organization, editor_state: ImageryEditorStateCreate) -> None:
    """Pin every collection that needs a hosted tiler to the one that will actually serve
    it, rejecting the whole save up front (before any writes) when there is none: unknown
    hosted tiler => 400, provider outside the organization's allowlist => 403, no tiler
    that can serve the catalog => 403.

    MPC-routed collections are checked against 'mpc'; the hosted tiler is only resolved
    when something actually needs it (non-first compositing, masking, a non-MPC catalog).
    A catalog that is not a platform tiler's own has to be ingested, so a tiler that
    cannot ingest is not a candidate for it however the payload was pinned.
    """
    allowed = set(org.allowed_tiler_names)
    for src in editor_state.sources:
        for col in src.collections:
            stac = col.stac_config
            if not stac or not stac.catalog_url:
                continue

            routes = _collection_providers(stac)
            if registry.MPC in routes and registry.MPC not in allowed:
                raise _forbidden(registry.MPC, col.name)
            if registry.HOSTED not in routes:
                continue

            # 'mpc' in the tiler field is not a hosted pin - the wizard offers it as a
            # discoverable tiler, and MPC routing is decided above.
            pinned = None if stac.tiler == registry.MPC else stac.tiler
            if pinned and not registry.is_known(pinned):
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown tiler '{pinned}' for collection '{col.name}'",
                )
            if pinned and pinned not in allowed:
                raise _forbidden(pinned, col.name)

            tiler = registry.serving_tiler(stac.catalog_url, pinned, allowed)
            if tiler is None:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        f"Your organization has no tiler that can serve imagery from "
                        f"'{stac.catalog_url}' (collection '{col.name}')"
                    ),
                )
            stac.tiler = tiler.name


def _validate_organization_keys(org: Organization, editor_state: ImageryEditorStateCreate) -> None:
    """Reject an unknown shared key before any writes, the way tiler pinning is checked.

    A source names a key only when it is created; the key can never be read back through
    this payload, so there is nothing to leak by naming one.
    """
    known = {key.id for key in org.api_keys}
    for src in editor_state.sources:
        if src.organization_api_key_id is not None and src.organization_api_key_id not in known:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Organization API key not found"
            )


def create_imagery_from_editor_state(
    db: Session,
    *,
    campaign: Campaign,
    editor_state: ImageryEditorStateCreate,
) -> dict:
    """Persist the full imagery editor state (sources, collections, slices,
    basemaps) for a freshly created campaign.

    A campaign with no existing imagery reduces the save/reconcile flow to pure
    creation, so this is a thin entry point over `save_imagery_editor_state`.
    Returns the same dict (keys 'sources', 'views', 'basemaps',
    'pending_registrations', 'bbox'). Does NOT commit - caller commits and then
    hands 'pending_registrations' to spawn_background_mosaic_registration.
    """
    return save_imagery_editor_state(db, campaign=campaign, editor_state=editor_state)


def save_imagery_editor_state(
    db: Session,
    *,
    campaign: Campaign,
    editor_state: ImageryEditorStateCreate,
) -> dict:
    """Upsert the full imagery editor state in a single transaction.

    Reconciliation rules per entity (sources, collections, slices, basemaps):
    payload entry with `id` set → update in place; without `id` →
    create; in DB but missing from payload → delete. Views are managed through
    the dedicated view endpoints; here they are only kept consistent (deleted
    sources leave their views, layout windows follow collection changes). A collection only lands in
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

    _resolve_tilers(campaign.project.organization, editor_state)
    _validate_organization_keys(campaign.project.organization, editor_state)

    bbox = [
        campaign.settings.bbox_west,
        campaign.settings.bbox_south,
        campaign.settings.bbox_east,
        campaign.settings.bbox_north,
    ]

    existing_sources: dict[int, ImagerySource] = {s.id: s for s in campaign.imagery_sources}

    payload_source_ids = {s.id for s in editor_state.sources if s.id is not None}

    # Window eligibility per view before any mutation, so newly-eligible
    # collections can be placed into the view layouts afterwards.
    prev_eligible: dict[int, set[int]] = {
        view.id: _eligible_collection_ids(campaign.imagery_sources, view.source_ids)
        for view in campaign.imagery_views
    }

    deleted_source_ids: set[int] = set()

    # Delete sources missing from payload. Cascade handles their collections.
    for s_id, s in list(existing_sources.items()):
        if s_id not in payload_source_ids:
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
                db.delete(col)

    # Drop deleted sources from every view's membership.
    if deleted_source_ids:
        for view in campaign.imagery_views:
            cleaned = [sid for sid in view.source_ids if sid not in deleted_source_ids]
            if cleaned != view.source_ids:
                view.source_ids = cleaned
                flag_modified(view, "source_ids")

    db.flush()

    # Upsert sources. New ones go through the existing _create_source helper so
    # the STAC pending-registration list works identically to campaign create.
    pending_registrations: list[RegistrationSpec] = []
    current_sources: list[ImagerySource] = []

    for src_idx, src_create in enumerate(editor_state.sources):
        if src_create.id and src_create.id in existing_sources:
            db_src = existing_sources[src_create.id]
            pending = _update_source_in_place(db, db_src, src_create, src_idx, bbox)
        else:
            db_src, pending = _create_source(db, campaign.id, src_create, src_idx, bbox)
        pending_registrations.extend(pending)
        current_sources.append(db_src)

    db.flush()

    # Re-sync every view's layouts against its post-edit eligible set: windows
    # of deleted collections are dropped, collections newly added to a source
    # a view contains get windows placed (in the default and personal layouts
    # alike - a user can hide them again).
    for view in campaign.imagery_views:
        new_eligible = _eligible_collection_ids(current_sources, view.source_ids)
        sync_view_layouts(
            db,
            view.id,
            campaign.id,
            window_collection_ids=new_eligible,
            added_collection_ids=sorted(new_eligible - prev_eligible.get(view.id, set())),
        )

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


def _eligible_collection_ids(sources: list[ImagerySource], source_ids: list) -> set[int]:
    """Collections a view can show as windows: every collection of its sources."""
    by_id = {s.id: s for s in sources}
    return {c.id for sid in source_ids if sid in by_id for c in by_id[sid].collections}


def _validated_source_ids(campaign: Campaign, source_ids: list[int]) -> list[int]:
    known = {s.id for s in campaign.imagery_sources}
    unknown = [sid for sid in source_ids if sid not in known]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown source ids: {unknown}")
    return list(dict.fromkeys(source_ids))


def _campaign_view(db: Session, campaign: Campaign, view_id: int) -> ImageryView:
    view = db.execute(
        select(ImageryView).where(ImageryView.id == view_id, ImageryView.campaign_id == campaign.id)
    ).scalar_one_or_none()
    if view is None:
        raise HTTPException(status_code=404, detail="View not found")
    return view


def create_view(db: Session, campaign: Campaign, payload: ImageryViewCreate) -> ImageryView:
    """Create a view plus its default canvas layout with every eligible
    collection placed as a window. Commits."""
    view = ImageryView(
        campaign_id=campaign.id,
        name=payload.name,
        display_order=len(campaign.imagery_views),
        source_ids=_validated_source_ids(campaign, payload.source_ids),
    )
    db.add(view)
    db.flush()
    eligible = _eligible_collection_ids(campaign.imagery_sources, view.source_ids)
    db.add(new_default_view_layout(campaign.id, view.id, sorted(eligible)))
    db.commit()
    db.refresh(view)
    return view


def update_view(
    db: Session, campaign: Campaign, view_id: int, payload: ImageryViewUpdate
) -> ImageryView:
    """Rename a view and/or replace its source membership, keeping its canvas
    layouts in sync with the new eligible set. Commits."""
    view = _campaign_view(db, campaign, view_id)
    if payload.name is not None:
        view.name = payload.name
    if payload.source_ids is not None:
        prev = _eligible_collection_ids(campaign.imagery_sources, view.source_ids)
        view.source_ids = _validated_source_ids(campaign, payload.source_ids)
        flag_modified(view, "source_ids")
        db.flush()
        new = _eligible_collection_ids(campaign.imagery_sources, view.source_ids)
        sync_view_layouts(
            db,
            view.id,
            campaign.id,
            window_collection_ids=new,
            added_collection_ids=sorted(new - prev),
        )
    db.commit()
    db.refresh(view)
    return view


def delete_view(db: Session, campaign: Campaign, view_id: int) -> None:
    """Delete a view; its canvas layouts go with it via cascade. Commits."""
    db.delete(_campaign_view(db, campaign, view_id))
    db.commit()


def reorder_views(db: Session, campaign: Campaign, view_ids: list[int]) -> None:
    """Persist a full ordering of the campaign's views. Commits."""
    if set(view_ids) != {v.id for v in campaign.imagery_views} or len(view_ids) != len(
        campaign.imagery_views
    ):
        raise HTTPException(status_code=400, detail="view_ids must list every view exactly once")
    order = {view_id: idx for idx, view_id in enumerate(view_ids)}
    for view in campaign.imagery_views:
        view.display_order = order[view.id]
    db.commit()


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
    db_src.max_native_zoom = src_create.max_native_zoom
    db_src.display_order = src_idx

    # Reconcile visualization templates by name.
    existing_viz = {v.name: v for v in db_src.visualizations}
    payload_names = [v.name for v in src_create.visualizations]
    removed_viz_names = {name for name in existing_viz if name not in payload_names}
    for name, viz in list(existing_viz.items()):
        if name not in payload_names:
            db.delete(viz)
    for viz_idx, viz_create in enumerate(src_create.visualizations):
        if viz_create.name in existing_viz:
            existing_viz[viz_create.name].display_order = viz_idx
        else:
            db.add(
                VisualizationTemplate(
                    source_id=db_src.id, name=viz_create.name, display_order=viz_idx
                )
            )

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

    generation_series_by_key, stale_generation_series = _reconcile_generation_series(
        db, db_src, src_create
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
                db,
                existing_col,
                col_create,
                col_idx,
                src_create,
                bbox,
                (
                    generation_series_by_key.get(col_create.generation_series_key)
                    if col_create.generation_series_key is not None
                    else None
                ),
            )
            if pending_entry:
                pending.append(pending_entry)
        else:
            _, pending_entry = _create_collection_record(
                db,
                db_src,
                src_create,
                col_create,
                col_idx,
                bbox,
                (
                    generation_series_by_key.get(col_create.generation_series_key)
                    if col_create.generation_series_key is not None
                    else None
                ),
            )
            if pending_entry:
                pending.append(pending_entry)

    db.flush()
    for series in stale_generation_series:
        db.delete(series)
    db.flush()
    db.refresh(db_src)
    return pending


def _reconcile_generation_series(
    db: Session, db_src: ImagerySource, src_create: ImagerySourceCreate
) -> tuple[dict[str, int], list[ImageryGenerationSeries]]:
    """Upsert source-level generator inputs and resolve request keys to IDs.

    This is the persistence seam for generation provenance. Collection writes
    only receive the resolved foreign key; config ownership stays here.
    """
    existing = {series.id: series for series in db_src.generation_series}
    kept: set[int] = set()
    by_key: dict[str, int] = {}
    for incoming in src_create.generation_series:
        if incoming.id is not None:
            series = existing.get(incoming.id)
            if series is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Generation series {incoming.id} does not belong to source {db_src.id}",
                )
            series.config = incoming.config.model_dump(mode="json")
            flag_modified(series, "config")
        else:
            series = ImageryGenerationSeries(
                source_id=db_src.id,
                config=incoming.config.model_dump(mode="json"),
            )
            db.add(series)
            db.flush()
        kept.add(series.id)
        by_key[incoming.key] = series.id
    return by_key, [series for series_id, series in existing.items() if series_id not in kept]


def _update_collection_in_place(
    db: Session,
    db_col: ImageryCollection,
    col_create: ImageryCollectionCreate,
    col_idx: int,
    src_create: ImagerySourceCreate,
    bbox: list[float],
    generation_series_id: int | None,
) -> RegistrationSpec | None:
    """Update a collection's metadata, slices, and stac_config. Returns a
    RegistrationSpec if mosaic re-search is required."""
    db_col.name = col_create.name
    db_col.cover_slice_index = col_create.cover_slice_index
    db_col.has_dedicated_cover = col_create.has_dedicated_cover
    db_col.display_order = col_idx
    db_col.generation_series_id = generation_series_id

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
        max_native_zoom=src.max_native_zoom,
        # The schema allows at most one of the two, so these never conflict.
        encrypted_api_key=encrypt(src.api_key) if src.api_key else None,
        organization_api_key_id=src.organization_api_key_id,
        display_order=src_idx,
    )
    db.add(source)
    db.flush()

    generation_series_by_key, _ = _reconcile_generation_series(db, source, src)

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
        _, pending_entry = _create_collection_record(
            db,
            source,
            src,
            col_create,
            col_idx,
            bbox,
            (
                generation_series_by_key.get(col_create.generation_series_key)
                if col_create.generation_series_key is not None
                else None
            ),
        )
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
    generation_series_id: int | None,
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
        generation_series_id=generation_series_id,
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

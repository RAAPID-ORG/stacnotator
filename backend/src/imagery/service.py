from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from src import storage_access
from src.campaigns.models import Campaign
from src.canvas.service import (
    default_main_layout_data,
    new_default_view_layout,
    sync_view_layouts,
)
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
from src.imagery.registration import StacRegistrationSpec, discard_for_registration
from src.imagery.schemas import (
    BasemapCreate,
    CollectionStacConfigCreate,
    ImageryCollectionCreate,
    ImageryEditorStateCreate,
    ImagerySliceCreate,
    ImagerySourceCreate,
    ImageryViewCreate,
    ImageryViewUpdate,
    ProviderKeyCreate,
)
from src.layers import LayerOwner
from src.organizations.models import Organization
from src.tilers import providers, registry
from src.visualizers.models import Visualizer


def _apply_provider_key(target: Basemap | ImagerySource, incoming: ProviderKeyCreate) -> None:
    """Point the layer at the key its entry names and clear the other, so there is
    never a question of which of the two applies. An entry naming neither keeps the
    layer's key: it is never read back, so a saved layer always arrives that way."""
    if incoming.organization_api_key_id is not None:
        target.encrypted_api_key = None
        target.organization_api_key_id = incoming.organization_api_key_id
    elif incoming.api_key is not None:
        target.encrypted_api_key = encrypt(incoming.api_key)
        target.organization_api_key_id = None


def _held_storage_access(source: ImagerySource) -> dict[str, storage_access.Held]:
    """The private-catalog access each of a source's catalogs is read with, by catalog URL.

    Taken before a save deletes anything: a series regenerated in the editor replaces its
    collections with new ones the browser never had the access for, and those carry on
    with the access their catalog already has.
    """
    out: dict[str, storage_access.Held] = {}
    for collection in source.collections:
        config = collection.stac_config
        access = storage_access.held(config)
        if config is not None and config.catalog_url and access is not None:
            out[config.catalog_url] = access
    return out


def _save_viz_configs(db: Session, collection: ImageryCollection, visualizations) -> None:
    """Leave the collection holding exactly these visualizations, matched by name."""
    existing = {row.name: row for row in collection.viz_configs}
    incoming = {v.name for v in visualizations}
    for name, row in existing.items():
        if name not in incoming:
            db.delete(row)
    for order, viz in enumerate(visualizations):
        row = existing.get(viz.name) or CollectionVizConfig(
            collection_id=collection.id, name=viz.name
        )
        db.add(row)
        row.display_order = order
        row.render_params = viz.viz_params.model_dump(exclude_none=True)
        row.cover_render_params = (
            viz.cover_viz_params.model_dump(exclude_none=True)
            if collection.has_dedicated_cover and viz.cover_viz_params
            else None
        )


# ============================================================================
# Validation, before any write
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


def _resolve_tilers(org: Organization, sources: list[ImagerySourceCreate]) -> None:
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
    for src in sources:
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


def _check_layers(
    org: Organization,
    sources: list[ImagerySourceCreate],
    basemaps: list[BasemapCreate],
) -> None:
    """Everything a save is rejected for, checked before it writes anything.

    Naming a shared key leaks nothing: it can never be read back through this payload.
    Only organizations cleared for it may point a collection at internal
    (managed-identity) storage.
    """
    _resolve_tilers(org, sources)
    known_keys = {key.id for key in org.api_keys}
    for layer in [*sources, *basemaps]:
        if layer.organization_api_key_id not in (None, *known_keys):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Organization API key not found"
            )
    if not org.allows_internal_storage and any(
        col.stac_config and col.stac_config.internal_storage
        for src in sources
        for col in src.collections
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This organization cannot mark imagery as internal storage",
        )


# ============================================================================
# Saving the editor state
# ============================================================================


@dataclass
class SavedImagery:
    """What a save leaves behind: the owner's sources after it, the sources it deleted,
    and the collections to register once the caller has committed."""

    sources: list[ImagerySource]
    deleted_source_ids: set[int]
    registrations: list[StacRegistrationSpec]


def save_imagery_editor_state(
    db: Session, campaign: Campaign, editor_state: ImageryEditorStateCreate
) -> list[StacRegistrationSpec]:
    """Reconcile a campaign's imagery with the editor's full state: sources, collections,
    slices and basemaps.

    Views are managed through their own endpoints; here they are only kept consistent -
    deleted sources leave their views, and layout windows follow collection changes.

    Does not commit. The caller commits, then hands the returned work orders to
    ``spawn_background_registration`` so the provider calls run off the request path.
    """
    organization = campaign.project.organization
    _check_layers(organization, editor_state.sources, editor_state.basemaps)

    prev_eligible = {
        view.id: _eligible_collection_ids(campaign.imagery_sources, view.source_ids)
        for view in campaign.imagery_views
    }
    saved = _save_sources(
        db,
        LayerOwner(campaign_id=campaign.id),
        campaign.imagery_sources,
        editor_state.sources,
    )

    for view in campaign.imagery_views:
        kept = [sid for sid in view.source_ids if sid not in saved.deleted_source_ids]
        if kept != view.source_ids:
            view.source_ids = kept
            flag_modified(view, "source_ids")
        # Windows of deleted collections are dropped; collections newly added to a
        # source the view shows get windows placed, in every layout - a user can hide
        # them again.
        eligible = _eligible_collection_ids(saved.sources, view.source_ids)
        sync_view_layouts(
            db,
            view.id,
            campaign.id,
            window_collection_ids=eligible,
            added_collection_ids=sorted(eligible - prev_eligible.get(view.id, set())),
        )

    _save_basemaps(
        db, LayerOwner(campaign_id=campaign.id), campaign.basemaps, editor_state.basemaps
    )
    db.flush()
    return saved.registrations


def save_visualizer_imagery(
    db: Session, visualizer: Visualizer, sources: list[ImagerySourceCreate]
) -> list[StacRegistrationSpec]:
    """Reconcile a visualizer's own imagery, by the same rules as a campaign's. A
    visualizer has no views or canvas layouts to keep in step. Does not commit."""
    if any(
        col.stac_config and col.stac_config.storage_access
        for src in sources
        for col in src.collections
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A private catalog read with a SAS token can't be published in a visualizer",
        )
    _check_layers(visualizer.project.organization, sources, [])
    saved = _save_sources(
        db, LayerOwner(visualizer_id=visualizer.id), visualizer.imagery_sources, sources
    )
    return saved.registrations


def save_visualizer_basemaps(
    db: Session, visualizer: Visualizer, basemaps: list[BasemapCreate]
) -> None:
    """Reconcile a visualizer's backdrops, exactly as a campaign's are. Does not commit."""
    _check_layers(visualizer.project.organization, [], basemaps)
    _save_basemaps(db, LayerOwner(visualizer_id=visualizer.id), visualizer.basemaps, basemaps)
    db.flush()


def _save_sources(
    db: Session,
    owner: LayerOwner,
    existing: list[ImagerySource],
    payload: list[ImagerySourceCreate],
) -> SavedImagery:
    """An entry with a known id updates that source in place, any other is created, and
    a stored source the payload leaves out is deleted - the same one level down for
    collections and slices.

    A collection is registered again only when something its tiles depend on changed
    (search, visualizations, tiler, cover, slice dates) or a past registration left a
    slice without them; a rename alone keeps its tile URLs.
    """
    by_id = {s.id: s for s in existing}
    # Taken before anything is deleted: a series regenerated in the editor replaces its
    # collections with new ones the browser never had the private-catalog access for,
    # and those carry on with the access their catalog already has.
    held_access = {s.id: _held_storage_access(s) for s in existing}

    keep = {s.id for s in payload if s.id is not None}
    deleted = {sid for sid in by_id if sid not in keep}
    for sid in deleted:
        db.delete(by_id.pop(sid))
    for src in payload:
        source = by_id.get(src.id) if src.id is not None else None
        if source is None:
            continue
        keep_cols = {c.id for c in src.collections if c.id is not None}
        for collection in list(source.collections):
            if collection.id not in keep_cols:
                db.delete(collection)
    db.flush()

    sources: list[ImagerySource] = []
    to_register: list[ImageryCollection] = []
    for order, src in enumerate(payload):
        source = by_id.get(src.id) if src.id is not None else None
        held = held_access.get(source.id, {}) if source is not None else {}
        source, changed = _save_source(db, owner, source, src, order, held)
        sources.append(source)
        to_register.extend(changed)
    db.flush()

    registrations = []
    for collection in to_register:
        if (spec := discard_for_registration(collection)) is not None:
            registrations.append(spec)
    db.flush()
    return SavedImagery(sources, deleted, registrations)


def _save_source(
    db: Session,
    owner: LayerOwner,
    source: ImagerySource | None,
    src: ImagerySourceCreate,
    order: int,
    held_access: dict[str, storage_access.Held],
) -> tuple[ImagerySource, list[ImageryCollection]]:
    """Create or update one source and its collections. Returns the source and the
    collections whose tiles have to be registered again."""
    if source is None:
        source = ImagerySource(**owner.as_columns())
        db.add(source)
    source.name = src.name
    source.crosshair_hex6 = src.crosshair_hex6
    source.default_zoom = src.default_zoom
    source.max_native_zoom = src.max_native_zoom
    source.display_order = order
    _apply_provider_key(source, src)
    db.flush()

    templates = {v.name: v for v in source.visualizations}
    wanted = [v.name for v in src.visualizations]
    for name, template in templates.items():
        if name not in wanted:
            db.delete(template)
    for viz_order, name in enumerate(wanted):
        template = templates.get(name) or VisualizationTemplate(source_id=source.id, name=name)
        db.add(template)
        template.display_order = viz_order

    series_ids, stale_series = _save_generation_series(db, source, src)
    collections = {c.id: c for c in source.collections}
    changed = []
    for col_order, col in enumerate(src.collections):
        collection = collections.get(col.id) if col.id is not None else None
        collection, needs_registration = _save_collection(
            db,
            source,
            collection,
            col,
            col_order,
            series_ids.get(col.generation_series_key or ""),
            held_access,
        )
        if needs_registration:
            changed.append(collection)
    db.flush()
    for series in stale_series:
        db.delete(series)
    db.flush()
    db.refresh(source)
    return source, changed


def _save_generation_series(
    db: Session, source: ImagerySource, src: ImagerySourceCreate
) -> tuple[dict[str, int], list[ImageryGenerationSeries]]:
    """Upsert the source's generator inputs; returns the series id each request key
    names, and the stored series no longer referenced (deleted by the caller once no
    collection points at them)."""
    existing = {series.id: series for series in source.generation_series}
    by_key: dict[str, int] = {}
    for incoming in src.generation_series:
        config = incoming.config.model_dump(mode="json")
        if incoming.id is not None:
            series = existing.get(incoming.id)
            if series is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Generation series {incoming.id} does not belong to source {source.id}",
                )
            if series.config != config:
                series.config = config
        else:
            series = ImageryGenerationSeries(source_id=source.id, config=config)
            db.add(series)
            db.flush()
        by_key[incoming.key] = series.id
    stale = [series for sid, series in existing.items() if sid not in by_key.values()]
    return by_key, stale


def _save_collection(
    db: Session,
    source: ImagerySource,
    collection: ImageryCollection | None,
    col: ImageryCollectionCreate,
    order: int,
    generation_series_id: int | None,
    held_access: dict[str, storage_access.Held],
) -> tuple[ImageryCollection, bool]:
    """Create or update one collection with its STAC search, visualizations and slices.
    Returns it and whether its tiles have to be registered again."""
    changed = collection is None
    if collection is None:
        collection = ImageryCollection(source_id=source.id)
        db.add(collection)
    elif (collection.has_dedicated_cover, collection.cover_slice_index) != (
        col.has_dedicated_cover,
        col.cover_slice_index,
    ):
        changed = True
    collection.name = col.name
    collection.cover_slice_index = col.cover_slice_index
    collection.has_dedicated_cover = col.has_dedicated_cover
    collection.display_order = order
    collection.generation_series_id = generation_series_id
    db.flush()

    if col.stac_config is not None:
        changed |= _save_stac_config(db, collection, col.stac_config, held_access)
    changed |= _save_slices(db, collection, col.slices, manual=col.stac_config is None)
    db.flush()
    db.refresh(collection)

    if col.stac_config is None:
        return collection, False
    names = {v.name for v in col.stac_config.visualizations}
    registered = {tu.visualization_name for sl in collection.slices for tu in sl.tile_urls}
    return collection, changed or registered != names


def _save_stac_config(
    db: Session,
    collection: ImageryCollection,
    incoming: CollectionStacConfigCreate,
    held_access: dict[str, storage_access.Held],
) -> bool:
    """Write the collection's STAC search and visualizations; returns whether anything
    its tiles depend on changed."""
    has_cover = collection.has_dedicated_cover
    stac = collection.stac_config
    is_new = stac is None
    if stac is None:
        stac = CollectionStacConfig(
            collection_id=collection.id,
            catalog_url=incoming.catalog_url,
            stac_collection_id=incoming.stac_collection_id,
        )
        db.add(stac)
    before = (
        stac.tile_provider,
        stac.max_cloud_cover,
        stac.search_query,
        stac.cover_search_query,
        stac.internal_storage,
        {vc.name: (vc.render_params, vc.cover_render_params) for vc in collection.viz_configs},
    )
    stac.tile_provider = incoming.tiler
    stac.max_cloud_cover = incoming.max_cloud_cover
    stac.search_query = incoming.search_query
    stac.cover_search_query = incoming.cover_search_query if has_cover else None
    stac.internal_storage = incoming.internal_storage
    _save_viz_configs(db, collection, incoming.visualizations)
    after = (
        stac.tile_provider,
        stac.max_cloud_cover,
        stac.search_query,
        stac.cover_search_query,
        stac.internal_storage,
        {
            v.name: (
                v.viz_params.model_dump(exclude_none=True),
                v.cover_viz_params.model_dump(exclude_none=True)
                if has_cover and v.cover_viz_params
                else None,
            )
            for v in incoming.visualizations
        },
    )

    # Searches carry the access they were registered with, so new access means
    # registering them again.
    if incoming.storage_access is not None:
        try:
            storage_access.check_catalog(incoming.catalog_url or stac.catalog_url)
        except storage_access.InvalidStorageAccess as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    access_changed = storage_access.store(stac, incoming.storage_access)
    if is_new:
        storage_access.inherit(stac, held_access.get(stac.catalog_url or ""))
    return is_new or access_changed or before != after


def _save_slices(
    db: Session, collection: ImageryCollection, slices: list[ImagerySliceCreate], *, manual: bool
) -> bool:
    """Reconcile the collection's slices; returns whether any date range changed.

    A manual collection's tile URLs are the payload's; a STAC collection's come from
    registration, so the payload's are only taken for a slice it creates.
    """
    existing = {sl.id: sl for sl in collection.slices}
    keep = {sl.id for sl in slices if sl.id is not None}
    changed = False
    for sid, dropped in existing.items():
        if sid not in keep:
            db.delete(dropped)
            changed = True
    for order, incoming in enumerate(slices):
        stored = existing.get(incoming.id) if incoming.id is not None else None
        is_new = stored is None
        sl = stored or ImagerySlice(collection_id=collection.id)
        db.add(sl)
        if is_new or (sl.start_date, sl.end_date) != (incoming.start_date, incoming.end_date):
            changed = True
        sl.name = incoming.name
        sl.start_date = incoming.start_date
        sl.end_date = incoming.end_date
        sl.display_order = order
        if is_new or manual:
            sl.tile_urls.clear()
            # Flush the deletes first: the unit of work emits same-table INSERTs before
            # DELETEs, which would trip the (slice_id, visualization_name) constraint.
            db.flush()
            sl.tile_urls.extend(
                SliceTileUrl(visualization_name=t.visualization_name, tile_url=t.tile_url)
                for t in incoming.tile_urls
            )
    return changed


def _save_basemaps(
    db: Session,
    owner: LayerOwner,
    existing: list[Basemap],
    basemaps: list[BasemapCreate],
) -> list[Basemap]:
    """Update by id, create the rest, delete what the payload dropped. In place rather
    than replaced, because a basemap's key is never sent back and must survive the save."""
    by_id = {bm.id: bm for bm in existing}
    keep = {bm.id for bm in basemaps if bm.id is not None}
    for basemap_id, basemap in by_id.items():
        if basemap_id not in keep:
            db.delete(basemap)
    saved = []
    for bm in basemaps:
        obj = by_id.get(bm.id) if bm.id is not None else None
        if obj is None:
            obj = Basemap(**owner.as_columns())
            db.add(obj)
        obj.name = bm.name
        obj.url = bm.url
        obj.max_native_zoom = bm.max_native_zoom
        _apply_provider_key(obj, bm)
        saved.append(obj)
    db.flush()
    return saved


# ============================================================================
# Views
# ============================================================================


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
    db.add(
        new_default_view_layout(
            campaign.id,
            view.id,
            sorted(eligible),
            main_layout_data=default_main_layout_data(db, campaign.id),
        )
    )
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

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from src import storage_access
from src.campaigns.models import Campaign
from src.canvas.service import new_default_view_layout
from src.crypto import encrypt
from src.imagery.models import (
    Basemap,
    CollectionVisualization,
    ImageryCollection,
    ImageryGenerationSeries,
    ImagerySlice,
    ImagerySource,
    ImageryView,
    SliceTemplate,
    Visualization,
)
from src.imagery.schemas import (
    BasemapCreate,
    CollectionSearchCreate,
    ImageryCollectionCreate,
    ImageryEditorStateCreate,
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
        access = storage_access.held(collection)
        if collection.catalog_url and access is not None:
            out[collection.catalog_url] = access
    return out


# ============================================================================
# Validation, before any write
# ============================================================================


def _collection_providers(col: ImageryCollectionCreate) -> set[str]:
    """Providers a collection's tiles will come from, decided as ``tiles.provider_for``
    decides it. Cover overrides count too: they draw the cover slice. A collection
    without visualizations still routes somewhere, so it is judged on empty params."""
    assert col.search is not None  # noqa: S101
    params = [
        p.model_dump()
        for r in col.visualizations
        for p in (r.params, r.cover_params)
        if p is not None
    ] or [{}]
    return {providers.select_provider(col.search.catalog_url, p) for p in params}


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
            stac = col.search
            if stac is None:
                continue

            routes = _collection_providers(col)
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
        col.search and col.search.internal_storage for src in sources for col in src.collections
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This organization cannot mark imagery as internal storage",
        )


# ============================================================================
# Saving the editor state
# ============================================================================


def save_imagery_editor_state(
    db: Session, campaign: Campaign, editor_state: ImageryEditorStateCreate
) -> None:
    """Reconcile a campaign's imagery with the editor's full state: sources, collections,
    slices and basemaps.

    A deleted source leaves the views that showed it with it (``view_sources`` cascades).

    Does not commit. The caller commits through ``registration.commit_and_register``,
    which registers whatever mosaics the save left missing.
    """
    organization = campaign.project.organization
    _check_layers(organization, editor_state.sources, editor_state.basemaps)

    _save_sources(
        db,
        LayerOwner(campaign_id=campaign.id),
        campaign.imagery_sources,
        editor_state.sources,
    )
    _save_basemaps(
        db, LayerOwner(campaign_id=campaign.id), campaign.basemaps, editor_state.basemaps
    )
    db.flush()


def save_visualizer_imagery(
    db: Session, visualizer: Visualizer, sources: list[ImagerySourceCreate]
) -> None:
    """Reconcile a visualizer's own imagery, by the same rules as a campaign's. Does
    not commit."""
    if any(col.search and col.search.storage_access for src in sources for col in src.collections):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A private catalog read with a SAS token can't be published in a visualizer",
        )
    _check_layers(visualizer.project.organization, sources, [])
    _save_sources(db, LayerOwner(visualizer_id=visualizer.id), visualizer.imagery_sources, sources)


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
) -> None:
    """An entry with a known id updates that source in place, any other is created, and
    a stored source the payload leaves out is deleted - the same one level down for
    visualizations, collections and slices.
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
    for source in by_id.values():
        db.expire(source, ["collections"])

    for order, src in enumerate(payload):
        source = by_id.get(src.id) if src.id is not None else None
        held = held_access.get(source.id, {}) if source is not None else {}
        _save_source(db, owner, source, src, order, held)
    db.flush()


def _save_source(
    db: Session,
    owner: LayerOwner,
    source: ImagerySource | None,
    src: ImagerySourceCreate,
    order: int,
    held_access: dict[str, storage_access.Held],
) -> ImagerySource:
    """Create or update one source with its visualizations and collections."""
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

    visualization_ids = _save_visualizations(db, source, src)
    series_ids, stale_series = _save_generation_series(db, source, src)
    collections = {c.id: c for c in source.collections}
    for col_order, col in enumerate(src.collections):
        _save_collection(
            db,
            source,
            collections.get(col.id) if col.id is not None else None,
            col,
            col_order,
            visualization_ids,
            series_ids.get(col.generation_series_key or ""),
            held_access,
        )
    db.flush()
    for series in stale_series:
        db.delete(series)
    db.flush()
    db.refresh(source)
    return source


def _save_visualizations(
    db: Session, source: ImagerySource, src: ImagerySourceCreate
) -> dict[str, int]:
    """Keep the visualizations the payload names - by id, else by name - delete the others
    with every parameter and template drawn with them, and add the rest. Returns the
    id each name in the payload refers to."""
    by_id = {r.id: r for r in source.visualizations}
    claimed = {r.id for r in src.visualizations if r.id is not None}
    unclaimed = {r.name: r for r in source.visualizations if r.id not in claimed}
    matched: list[Visualization | None] = []
    for incoming in src.visualizations:
        if incoming.id is None:
            matched.append(unclaimed.get(incoming.name))
        elif incoming.id in by_id:
            matched.append(by_id[incoming.id])
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Visualization {incoming.id} does not belong to source {source.id}",
            )

    kept = {r.id for r in matched if r is not None}
    for dropped in [r for r in source.visualizations if r.id not in kept]:
        for collection in source.collections:
            collection.visualizations[:] = [
                cr for cr in collection.visualizations if cr.visualization_id != dropped.id
            ]
            for sl in collection.slices:
                sl.templates[:] = [t for t in sl.templates if t.visualization_id != dropped.id]
        source.visualizations.remove(dropped)
    db.flush()

    ids: dict[str, int] = {}
    for display_order, (incoming, visualization) in enumerate(
        zip(src.visualizations, matched, strict=True)
    ):
        if visualization is None:
            visualization = Visualization()
            source.visualizations.append(visualization)
        visualization.name = incoming.name
        visualization.display_order = display_order
        db.flush()
        ids[incoming.name] = visualization.id
    return ids


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
    visualization_ids: dict[str, int],
    generation_series_id: int | None,
    held_access: dict[str, storage_access.Held],
) -> None:
    """Create or update one collection with its search, visualizations and slices.

    Mosaics are what a search registered, so a change to what is searched - the query,
    the catalog, where the cover sits - drops them; the next registration run replaces
    them. Visualization parameters are not searched and drop nothing.
    """
    if collection is None:
        collection = ImageryCollection(source_id=source.id)
        db.add(collection)
    searched_before = _searched(collection)
    collection.name = col.name
    collection.cover_slice_index = col.cover_slice_index
    collection.has_dedicated_cover = col.has_dedicated_cover
    collection.display_order = order
    collection.generation_series_id = generation_series_id
    access_changed = _save_search(collection, col.search, held_access)
    db.flush()

    by_rendering = {r.visualization_id: r for r in collection.visualizations}
    wanted = {visualization_ids[r.visualization]: r for r in col.visualizations}
    for visualization_id, row in by_rendering.items():
        if visualization_id not in wanted:
            db.delete(row)
    for visualization_id, incoming in wanted.items():
        row = by_rendering.get(visualization_id) or CollectionVisualization(
            collection_id=collection.id, visualization_id=visualization_id
        )
        db.add(row)
        row.params = incoming.params.model_dump(exclude_none=True)
        row.cover_params = (
            incoming.cover_params.model_dump(exclude_none=True)
            if col.has_dedicated_cover and incoming.cover_params
            else None
        )

    _save_slices(db, collection, col, visualization_ids)
    db.flush()
    db.refresh(collection)
    if access_changed or _searched(collection) != searched_before:
        for sl in collection.slices:
            sl.mosaics.clear()


def _searched(collection: ImageryCollection) -> tuple:
    """Everything a collection's mosaics were registered from, apart from slice dates."""
    return (
        collection.catalog_url,
        collection.stac_collection_id,
        collection.tiler,
        collection.search_query,
        collection.cover_search_query,
        collection.internal_storage,
        collection.has_dedicated_cover,
        collection.cover_slice_index,
    )


def _save_search(
    collection: ImageryCollection,
    incoming: CollectionSearchCreate | None,
    held_access: dict[str, storage_access.Held],
) -> bool:
    """Write the collection's STAC search, or clear it; returns whether the private
    catalog's access changed (searches carry the access they were registered with)."""
    if incoming is None:
        collection.catalog_url = collection.stac_collection_id = collection.tiler = None
        collection.search_query = collection.cover_search_query = None
        collection.internal_storage = False
        storage_access.clear(collection)
        return False
    is_new = collection.catalog_url is None
    collection.catalog_url = incoming.catalog_url
    collection.stac_collection_id = incoming.stac_collection_id
    collection.tiler = incoming.tiler
    collection.search_query = incoming.search_query
    collection.cover_search_query = (
        incoming.cover_search_query if collection.has_dedicated_cover else None
    )
    collection.internal_storage = incoming.internal_storage
    if incoming.storage_access is not None:
        try:
            storage_access.check_catalog(incoming.catalog_url)
        except storage_access.InvalidStorageAccess as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    changed = storage_access.store(collection, incoming.storage_access)
    if is_new:
        storage_access.inherit(collection, held_access.get(incoming.catalog_url))
    return changed


def _save_slices(
    db: Session,
    collection: ImageryCollection,
    col: ImageryCollectionCreate,
    visualization_ids: dict[str, int],
) -> None:
    """Reconcile the collection's slices. A slice whose dates moved loses its mosaics;
    a manual slice's templates are the payload's."""
    existing = {sl.id: sl for sl in collection.slices}
    keep = {sl.id for sl in col.slices if sl.id is not None}
    for sid, dropped in existing.items():
        if sid not in keep:
            db.delete(dropped)
    for order, incoming in enumerate(col.slices):
        sl = existing.get(incoming.id) if incoming.id is not None else None
        if sl is None:
            sl = ImagerySlice(collection_id=collection.id)
            db.add(sl)
        elif (sl.start_date, sl.end_date) != (incoming.start_date, incoming.end_date):
            sl.mosaics.clear()
        sl.name = incoming.name
        sl.start_date = incoming.start_date
        sl.end_date = incoming.end_date
        sl.display_order = order
        templates = {t.visualization_id: t for t in sl.templates}
        wanted = {visualization_ids[t.visualization]: t.url for t in incoming.templates}
        for visualization_id, template in templates.items():
            if visualization_id not in wanted:
                sl.templates.remove(template)
        for visualization_id, url in wanted.items():
            if visualization_id in templates:
                templates[visualization_id].url = url
            else:
                sl.templates.append(SliceTemplate(visualization_id=visualization_id, url=url))


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
    """Create a view and its default canvas layout. Commits."""
    view = ImageryView(
        campaign_id=campaign.id, name=payload.name, display_order=len(campaign.imagery_views)
    )
    view.source_ids = _validated_source_ids(campaign, payload.source_ids)
    db.add(view)
    db.flush()
    db.add(new_default_view_layout(campaign.id, view.id))
    db.commit()
    db.refresh(view)
    return view


def update_view(
    db: Session, campaign: Campaign, view_id: int, payload: ImageryViewUpdate
) -> ImageryView:
    """Rename a view and/or replace its sources. Commits."""
    view = _campaign_view(db, campaign, view_id)
    if payload.name is not None:
        view.name = payload.name
    if payload.source_ids is not None:
        view.source_ids = _validated_source_ids(campaign, payload.source_ids)
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

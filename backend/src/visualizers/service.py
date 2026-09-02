"""Visualizer CRUD and the read model the viewer page draws.

A visualizer draws on two kinds of imagery. It can register its own, set up the
same way a campaign's is and searched over the visualizer's own area; and it can
point at sources and overlays already registered by campaigns in the same
project. Both arrive at the viewer identically: as one flat, cover-free timeline
per source (see ``timeline``), which is the whole reason the two can be mixed.
"""

import secrets

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from src import background
from src.auth.models import User
from src.campaigns.models import Campaign
from src.custom_layers.models import CustomMap, VectorLayer
from src.imagery import registration
from src.imagery import service as imagery_service
from src.imagery.models import (
    Basemap,
    ImageryCollection,
    ImagerySlice,
    ImagerySource,
)
from src.imagery.registration import StacRegistrationSpec
from src.imagery.schemas import (
    BasemapOut,
    ImagerySourceCreate,
    ImagerySourceOut,
)
from src.layers import LayerOwner
from src.projects.models import Project
from src.visualizers import timeline
from src.visualizers.models import (
    Visualizer,
    VisualizerFeedback,
    VisualizerImagery,
    VisualizerOverlay,
)
from src.visualizers.schemas import (
    CampaignOptionsOut,
    LayerRestriction,
    OverlayOptionOut,
    RasterOverlayOut,
    SourceOptionOut,
    VectorOverlayOut,
    VisualizerArea,
    VisualizerBasemapOut,
    VisualizerConfigOut,
    VisualizerCreate,
    VisualizerFeedbackCreate,
    VisualizerFeedbackOut,
    VisualizerImageryCreate,
    VisualizerImageryOut,
    VisualizerListItemOut,
    VisualizerOptionsOut,
    VisualizerOverlayCreate,
    VisualizerStepOut,
    VisualizerTileOut,
    VisualizerUpdate,
    VisualizerViewOut,
)

SLUG_BYTES = 9


def _new_slug(db: Session) -> str:
    while True:
        slug = secrets.token_urlsafe(SLUG_BYTES)
        taken = db.execute(select(Visualizer.id).where(Visualizer.slug == slug)).first()
        if taken is None:
            return slug


def _source_loads():
    return (
        selectinload(Visualizer.imagery)
        .selectinload(VisualizerImagery.source)
        .options(
            selectinload(ImagerySource.visualizations),
            selectinload(ImagerySource.collections)
            .selectinload(ImageryCollection.slices)
            .selectinload(ImagerySlice.tile_urls),
        )
    )


def load(db: Session, *, visualizer_id: int | None = None, slug: str | None = None) -> Visualizer:
    stmt = select(Visualizer).options(
        selectinload(Visualizer.project),
        _source_loads(),
        selectinload(Visualizer.overlays).selectinload(VisualizerOverlay.custom_map),
        selectinload(Visualizer.overlays).selectinload(VisualizerOverlay.vector_layer),
        selectinload(Visualizer.basemaps),
    )
    stmt = (
        stmt.where(Visualizer.id == visualizer_id)
        if slug is None
        else stmt.where(Visualizer.slug == slug)
    )
    visualizer = db.execute(stmt).scalar_one_or_none()
    if visualizer is None:
        raise HTTPException(status_code=404, detail="Visualizer not found")
    return visualizer


def list_for_project(db: Session, project_id: int) -> list[VisualizerListItemOut]:
    rows = (
        db.execute(
            select(Visualizer)
            .where(Visualizer.project_id == project_id)
            .options(
                selectinload(Visualizer.imagery),
                selectinload(Visualizer.overlays),
                selectinload(Visualizer.imagery_sources),
            )
            .order_by(Visualizer.name)
        )
        .scalars()
        .all()
    )
    counts: dict[int, int] = {
        visualizer_id: total
        for visualizer_id, total in db.execute(
            select(VisualizerFeedback.visualizer_id, func.count())
            .where(VisualizerFeedback.visualizer_id.in_([v.id for v in rows]))
            .group_by(VisualizerFeedback.visualizer_id)
        ).all()
    }
    return [
        VisualizerListItemOut(
            id=v.id,
            slug=v.slug,
            name=v.name,
            description=v.description,
            is_public=v.is_public,
            imagery_count=len(v.imagery) + len(v.imagery_sources),
            overlay_count=len(v.overlays),
            feedback_count=counts.get(v.id, 0),
        )
        for v in rows
    ]


def create(db: Session, project: Project, payload: VisualizerCreate, user_id) -> Visualizer:
    visualizer = Visualizer(
        project_id=project.id,
        slug=_new_slug(db),
        name=payload.name.strip(),
        description=payload.description,
        is_public=payload.is_public,
        created_by=user_id,
    )
    _apply_area(visualizer, payload.area)
    db.add(visualizer)
    db.flush()
    _replace_layers(db, visualizer, payload.imagery, payload.overlays)
    pending = _save_own_imagery(db, visualizer, payload.own_imagery)
    imagery_service.save_visualizer_basemaps(db, visualizer=visualizer, basemaps=payload.basemaps)
    db.commit()
    _spawn_registration(visualizer.id, pending, area_out(visualizer))
    return load(db, visualizer_id=visualizer.id)


def update(db: Session, visualizer: Visualizer, payload: VisualizerUpdate) -> Visualizer:
    if payload.name is not None:
        visualizer.name = payload.name.strip()
    if payload.description is not None:
        visualizer.description = payload.description
    if payload.is_public is not None:
        visualizer.is_public = payload.is_public
    if payload.area is not None:
        _apply_area(visualizer, payload.area)
    if payload.imagery is not None or payload.overlays is not None:
        _replace_layers(
            db,
            visualizer,
            payload.imagery if payload.imagery is not None else _imagery_config(visualizer),
            payload.overlays if payload.overlays is not None else _overlay_config(visualizer),
        )
    pending = (
        _save_own_imagery(db, visualizer, payload.own_imagery)
        if payload.own_imagery is not None
        else []
    )
    if payload.basemaps is not None:
        imagery_service.save_visualizer_basemaps(
            db, visualizer=visualizer, basemaps=payload.basemaps
        )
    db.commit()
    _spawn_registration(visualizer.id, pending, area_out(visualizer))
    return load(db, visualizer_id=visualizer.id)


def delete(db: Session, visualizer: Visualizer) -> None:
    db.delete(visualizer)
    db.commit()


def _save_own_imagery(
    db: Session, visualizer: Visualizer, sources: list[ImagerySourceCreate]
) -> list[StacRegistrationSpec]:
    """Set up imagery for this visualizer alone, searched over its own area.

    An area is what a STAC search is registered over, so imagery cannot be set
    up before one is chosen - which is also why the editor asks for the area
    first.
    """
    if sources and area_out(visualizer) is None:
        raise HTTPException(
            status_code=400,
            detail="Choose the area this visualizer covers before adding imagery to it",
        )
    pending = imagery_service.save_visualizer_imagery(
        db, visualizer=visualizer, sources=sources, bbox=_bbox(visualizer)
    )
    if pending:
        background.begin_status_run(visualizer, registration.VISUALIZER_REGISTRATION_RUN)
        visualizer.registration_errors = None
    return pending


def _bbox(visualizer: Visualizer) -> list[float]:
    area = area_out(visualizer)
    return [area.west, area.south, area.east, area.north] if area else []


def _spawn_registration(
    visualizer_id: int, pending: list[StacRegistrationSpec], area: VisualizerArea | None
) -> None:
    """Off the request path, after the commit - the provider calls are slow enough
    that holding the write transaction across them trips the idle backstop."""
    if not pending or area is None:
        return
    registration.spawn_background_registration(
        LayerOwner(visualizer_id=visualizer_id),
        pending,
        [area.west, area.south, area.east, area.north],
    )


def _apply_area(visualizer: Visualizer, area: VisualizerArea | None) -> None:
    if area is None:
        return
    visualizer.bbox_west = area.west
    visualizer.bbox_south = area.south
    visualizer.bbox_east = area.east
    visualizer.bbox_north = area.north


def _replace_layers(
    db: Session,
    visualizer: Visualizer,
    imagery: list[VisualizerImageryCreate],
    overlays: list[VisualizerOverlayCreate],
) -> None:
    """The payload's lists are the whole truth; anything missing from them goes.

    Only the entries pointing at a campaign's layers, though: an overlay set up
    on this visualizer joins the list when it is created and leaves when it is
    deleted, so the pick list has no business reconciling it.
    """
    source_ids = [entry.source_id for entry in imagery]
    _assert_in_project(db, visualizer.project_id, ImagerySource, source_ids, "imagery source")
    _assert_in_project(
        db,
        visualizer.project_id,
        CustomMap,
        [o.custom_map_id for o in overlays if o.custom_map_id is not None],
        "custom map",
    )
    _assert_in_project(
        db,
        visualizer.project_id,
        VectorLayer,
        [o.vector_layer_id for o in overlays if o.vector_layer_id is not None],
        "vector layer",
    )
    if len(set(source_ids)) != len(source_ids):
        raise HTTPException(status_code=400, detail="An imagery source is listed twice")

    # Reconciled in place rather than replaced wholesale. Assigning a fresh list makes
    # SQLAlchemy delete every existing row and insert new ones in the same flush, and it
    # does not guarantee the deletes go first - so re-saving a config that keeps a
    # source it already had violates uq_visualizer_imagery_source. Keeping the row that
    # is already there sidesteps the ordering question entirely, and preserves its id.
    existing = {link.source_id: link for link in visualizer.imagery}
    kept: list[VisualizerImagery] = []
    for index, wanted in enumerate(imagery):
        link = existing.pop(wanted.source_id, None)
        if link is None:
            link = VisualizerImagery(source_id=wanted.source_id)
        link.display_order = index
        kept.append(link)
    for dropped in existing.values():
        visualizer.imagery.remove(dropped)
    visualizer.imagery = kept
    for entry in overlays:
        if (entry.custom_map_id is None) == (entry.vector_layer_id is None):
            raise HTTPException(status_code=400, detail="An overlay must name exactly one layer")

    owned = [o for o in visualizer.overlays if _is_owned(o, visualizer.id)]
    visualizer.overlays = [
        *owned,
        *(
            VisualizerOverlay(
                custom_map_id=entry.custom_map_id,
                vector_layer_id=entry.vector_layer_id,
                visible=entry.visible,
                opacity=entry.opacity,
                display_order=len(owned) + index,
            )
            for index, entry in enumerate(overlays)
        ),
    ]
    db.flush()


def _is_owned(overlay: VisualizerOverlay, visualizer_id: int) -> bool:
    layer = overlay.custom_map or overlay.vector_layer
    return layer is not None and layer.visualizer_id == visualizer_id


def _assert_in_project(db: Session, project_id: int, model, ids: list[int], label: str) -> None:
    """A visualizer may only link what its own project's campaigns own.

    Layers it set up itself never come through here: those are managed by their
    own editor, not by the pick list.
    """
    if not ids:
        return
    found = set(
        db.execute(
            select(model.id)
            .join(Campaign, Campaign.id == model.campaign_id)
            .where(Campaign.project_id == project_id, model.id.in_(ids))
        )
        .scalars()
        .all()
    )
    missing = sorted(set(ids) - found)
    if missing:
        raise HTTPException(
            status_code=400, detail=f"Unknown {label} for this project: {missing[0]}"
        )


def _imagery_config(visualizer: Visualizer) -> list[VisualizerImageryCreate]:
    return [VisualizerImageryCreate(source_id=entry.source_id) for entry in visualizer.imagery]


def _overlay_config(visualizer: Visualizer) -> list[VisualizerOverlayCreate]:
    """The linked entries, which are the only ones the pick list edits."""
    return [
        VisualizerOverlayCreate(
            custom_map_id=entry.custom_map_id,
            vector_layer_id=entry.vector_layer_id,
            visible=entry.visible,
            opacity=entry.opacity,
        )
        for entry in visualizer.overlays
        if not _is_owned(entry, visualizer.id)
    ]


def config_out(visualizer: Visualizer) -> VisualizerConfigOut:
    return VisualizerConfigOut(
        id=visualizer.id,
        slug=visualizer.slug,
        project_id=visualizer.project_id,
        name=visualizer.name,
        description=visualizer.description,
        is_public=visualizer.is_public,
        area=area_out(visualizer),
        imagery=_imagery_config(visualizer),
        overlays=_overlay_config(visualizer),
        own_imagery=[ImagerySourceOut.model_validate(s) for s in visualizer.imagery_sources],
        basemaps=[BasemapOut.model_validate(b) for b in visualizer.basemaps],
        registration_status=visualizer.registration_status,
        registration_errors=visualizer.registration_errors,
    )


def area_out(visualizer: Visualizer) -> VisualizerArea | None:
    """The stored area, or None when no area has been chosen. The column check
    keeps the four bounds all set or all null, so one test settles it."""
    if visualizer.bbox_west is None:
        return None
    return VisualizerArea(
        west=visualizer.bbox_west,
        south=visualizer.bbox_south,
        east=visualizer.bbox_east,
        north=visualizer.bbox_north,
    )


def tile_scopes(visualizer: Visualizer) -> list[str]:
    """Every scope this visualizer's tiles are served under, for its tiler token.

    A linked source or overlay is served under its campaign's scope; imagery the
    visualizer registered itself is served under its own. Handing out exactly
    these is what lets a visitor with no account fetch this visualizer's tiles
    and nothing else.
    """
    scopes = {
        entry.source.owner.tile_scope for entry in visualizer.imagery if entry.source is not None
    }
    scopes |= {source.owner.tile_scope for source in visualizer.imagery_sources}
    scopes |= {
        o.custom_map.owner.tile_scope for o in visualizer.overlays if o.custom_map is not None
    }
    return sorted(scopes)


def build_view(
    db: Session, visualizer: Visualizer, *, can_edit: bool, can_give_feedback: bool
) -> VisualizerViewOut:
    return VisualizerViewOut(
        id=visualizer.id,
        slug=visualizer.slug,
        name=visualizer.name,
        description=visualizer.description,
        is_public=visualizer.is_public,
        project_id=visualizer.project_id,
        project_name=visualizer.project.name,
        area=area_out(visualizer),
        imagery=[
            out
            for source in browsable_sources(visualizer)
            for out in _imagery_out(source, visualizer)
        ],
        basemaps=[_basemap_out(b) for b in visualizer.basemaps],
        overlays=[out for out in (_overlay_out(o) for o in visualizer.overlays) if out],
        can_edit=can_edit,
        can_give_feedback=can_give_feedback,
        registration_status=visualizer.registration_status,
    )


def _basemap_out(basemap: Basemap) -> VisualizerBasemapOut:
    return VisualizerBasemapOut(
        id=basemap.id,
        name=basemap.name,
        url=basemap.url,
        max_native_zoom=basemap.max_native_zoom,
        has_api_key=basemap.has_api_key,
        tile_proxy_base=f"/api/visualizers/{basemap.visualizer_id}/imagery/basemaps",
    )


def browsable_sources(visualizer: Visualizer) -> list[ImagerySource]:
    """Its own imagery first, then whatever it links from the project's campaigns.

    The viewer draws no distinction between the two - a source is a source once
    its intervals are flattened - so the only thing this decides is the order
    they are offered in.
    """
    linked = [entry.source for entry in visualizer.imagery if entry.source is not None]
    return [*visualizer.imagery_sources, *linked]


def tile_proxy_base(visualizer: Visualizer) -> str:
    """The backend route serving this visualizer's key-proxied slice tiles.

    Its own route even for a source linked from a campaign: that route serves
    what the visualizer publishes, where the campaign's serves everything the
    campaign has.
    """
    return f"/api/visualizers/{visualizer.id}/imagery/slices"


def _imagery_out(source: ImagerySource, visualizer: Visualizer) -> list[VisualizerImageryOut]:
    """This source as the one or two dated records a visualizer offers.

    A source with monthly composites over weekly acquisitions is two records,
    and the cadence is what distinguishes them by name.
    """
    tiles_by_slice = {
        s.id: {
            t.visualization_name: VisualizerTileOut(url=t.tile_url, provider=t.tile_provider)
            for t in s.tile_urls
        }
        for collection in source.collections
        for s in collection.slices
    }
    records = timeline.timelines(_slice_inputs(source))
    return [
        VisualizerImageryOut(
            id=f"{source.id}:{record.cadence}" if len(records) > 1 else str(source.id),
            tile_proxy_base=tile_proxy_base(visualizer),
            name=f"{source.name} {record.cadence}" if len(records) > 1 else source.name,
            visualizations=[v.name for v in source.visualizations],
            default_zoom=source.default_zoom,
            max_native_zoom=source.max_native_zoom,
            has_api_key=source.has_api_key,
            steps=[
                VisualizerStepOut(
                    slice_id=step.slice_id,
                    label=step.label,
                    start_date=step.start_date,
                    end_date=step.end_date,
                    tiles=tiles_by_slice.get(step.slice_id, {}),
                )
                for step in record.steps
                if tiles_by_slice.get(step.slice_id)
            ],
        )
        for record in records
    ]


def _slice_inputs(source: ImagerySource) -> list[timeline.SliceInput]:
    return [
        timeline.SliceInput(
            slice_id=s.id,
            name=s.name,
            start_date=s.start_date,
            end_date=s.end_date,
            is_dedicated_cover=(
                collection.has_dedicated_cover and index == collection.cover_slice_index
            ),
        )
        for collection in source.collections
        for index, s in enumerate(collection.slices)
    ]


def _overlay_out(overlay: VisualizerOverlay) -> RasterOverlayOut | VectorOverlayOut | None:
    if overlay.custom_map is not None:
        cm = overlay.custom_map
        return RasterOverlayOut(
            id=overlay.id,
            name=cm.name,
            visible=overlay.visible,
            opacity=overlay.opacity,
            campaign_id=cm.campaign_id,
            tile_url=cm.tile_url,
            render_config=cm.render_config,
            max_native_zoom=cm.max_native_zoom,
            status=cm.status,
            mlops_url=cm.mlops_url,
        )
    if overlay.vector_layer is not None:
        vl = overlay.vector_layer
        return VectorOverlayOut(
            id=overlay.id,
            name=vl.name,
            visible=overlay.visible,
            opacity=overlay.opacity,
            pmtiles_url=vl.pmtiles_url,
            source_layer=vl.source_layer,
            color=vl.color,
        )
    return None


def options(db: Session, project_id: int) -> VisualizerOptionsOut:
    """Everything in the project a visualizer could be built from."""
    campaigns = (
        db.execute(
            select(Campaign)
            .where(Campaign.project_id == project_id)
            .options(
                selectinload(Campaign.imagery_sources).options(
                    selectinload(ImagerySource.visualizations),
                    selectinload(ImagerySource.collections).options(
                        selectinload(ImageryCollection.slices),
                        selectinload(ImageryCollection.stac_config),
                    ),
                ),
                selectinload(Campaign.custom_maps),
                selectinload(Campaign.vector_layers),
                selectinload(Campaign.settings),
            )
            .order_by(Campaign.name)
        )
        .scalars()
        .all()
    )
    return VisualizerOptionsOut(
        campaigns=[
            CampaignOptionsOut(
                campaign_id=campaign.id,
                campaign_name=campaign.name,
                area=_campaign_area(campaign),
                sources=[_source_option(source) for source in campaign.imagery_sources],
                raster_overlays=[
                    OverlayOptionOut(
                        id=cm.id,
                        name=cm.name,
                        status=cm.status,
                        restriction="internal_storage" if cm.internal_storage else None,
                    )
                    for cm in campaign.custom_maps
                ],
                vector_overlays=[
                    OverlayOptionOut(id=vl.id, name=vl.name, status="ready", restriction=None)
                    for vl in campaign.vector_layers
                ],
            )
            for campaign in campaigns
        ]
    )


def _campaign_area(campaign: Campaign) -> VisualizerArea | None:
    settings = campaign.settings
    if settings is None:
        return None
    return VisualizerArea(
        west=settings.bbox_west,
        south=settings.bbox_south,
        east=settings.bbox_east,
        north=settings.bbox_north,
    )


def _source_option(source: ImagerySource) -> SourceOptionOut:
    records = timeline.timelines(_slice_inputs(source))
    steps = [step for record in records for step in record.steps]
    steps.sort(key=lambda step: step.start_date)
    return SourceOptionOut(
        id=source.id,
        name=source.name,
        step_count=len(steps),
        # What the picker will actually add. Two cadences means two entries in
        # the viewer, which is worth knowing before ticking the box.
        cadences=[record.cadence for record in records],
        visualizations=[v.name for v in source.visualizations],
        start_date=steps[0].start_date if steps else None,
        end_date=steps[-1].end_date if steps else None,
        restriction=source_restriction(source),
    )


def source_restriction(source: ImagerySource) -> LayerRestriction | None:
    """Whether serving this source's tiles spends something the organization owns.

    A key-proxied source is fetched with the org's provider credential, and an
    internal-storage one with the tiler's managed identity. Either way, publishing
    it points anonymous traffic at a credential rather than at open imagery.
    """
    if source.has_api_key:
        return "api_key"
    if any(
        c.stac_config is not None and c.stac_config.internal_storage for c in source.collections
    ):
        return "internal_storage"
    return None


def add_feedback(
    db: Session, visualizer: Visualizer, payload: VisualizerFeedbackCreate, user: User
) -> VisualizerFeedback:
    """Record a remark about one place on this map.

    The layer's name is copied in beside its id: an overlay can be taken off a
    visualizer, and the remark still has to say what it was about.
    """
    overlay = next((o for o in visualizer.overlays if o.id == payload.overlay_id), None)
    if payload.overlay_id is not None and overlay is None:
        raise HTTPException(status_code=400, detail="That layer is not on this visualizer")

    feedback = VisualizerFeedback(
        visualizer_id=visualizer.id,
        created_by=user.id,
        bbox_west=payload.area.west,
        bbox_south=payload.area.south,
        bbox_east=payload.area.east,
        bbox_north=payload.area.north,
        overlay_id=payload.overlay_id,
        layer_name=_overlay_name(overlay),
        verdict=payload.verdict,
        suggested_value=payload.suggested_value,
        suggested_label=payload.suggested_label,
        note=(payload.note or "").strip() or None,
        viewing=payload.viewing,
    )
    db.add(feedback)
    db.commit()
    return feedback


def _overlay_name(overlay: VisualizerOverlay | None) -> str | None:
    if overlay is None:
        return None
    if overlay.custom_map is not None:
        return overlay.custom_map.name
    return overlay.vector_layer.name if overlay.vector_layer else None


def list_feedback(db: Session, visualizer_id: int) -> list[VisualizerFeedbackOut]:
    rows = (
        db.execute(
            select(VisualizerFeedback)
            .where(VisualizerFeedback.visualizer_id == visualizer_id)
            .options(selectinload(VisualizerFeedback.user))
            .order_by(VisualizerFeedback.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [
        VisualizerFeedbackOut(
            id=row.id,
            created_at=row.created_at,
            author=row.user.display_name if row.user else "Deleted account",
            area=VisualizerArea(
                west=row.bbox_west,
                south=row.bbox_south,
                east=row.bbox_east,
                north=row.bbox_north,
            ),
            layer_name=row.layer_name,
            verdict=row.verdict,
            suggested_label=row.suggested_label,
            note=row.note,
            viewing=row.viewing,
        )
        for row in rows
    ]


def delete_feedback(db: Session, visualizer_id: int, feedback_id: int) -> bool:
    row = db.get(VisualizerFeedback, feedback_id)
    if row is None or row.visualizer_id != visualizer_id:
        return False
    db.delete(row)
    db.commit()
    return True


def link_owned_overlay(
    db: Session,
    visualizer: Visualizer,
    *,
    custom_map_id: int | None = None,
    vector_layer_id: int | None = None,
) -> None:
    """Put an overlay this visualizer just set up onto its overlay list.

    Everything the viewer draws hangs off that list - it is what carries how a
    layer opens, and what feedback points at - so an overlay set up here joins
    it at the moment it is created rather than waiting for the next save.
    """
    db.add(
        VisualizerOverlay(
            visualizer_id=visualizer.id,
            custom_map_id=custom_map_id,
            vector_layer_id=vector_layer_id,
            display_order=len(visualizer.overlays),
        )
    )
    db.commit()

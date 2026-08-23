"""Visualizer CRUD and the read model the viewer page draws.

A visualizer never owns imagery: it points at sources and overlays that belong
to campaigns in the same project. Everything here is either that reference
bookkeeping or the projection from those campaign rows into the flat, cover-free
shape ``VisualizerViewOut`` describes.
"""

import secrets

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.campaigns.models import Campaign
from src.custom_layers.models import CustomMap, VectorLayer
from src.imagery.models import ImageryCollection, ImagerySlice, ImagerySource
from src.projects.models import Project
from src.visualizers import timeline
from src.visualizers.models import Visualizer, VisualizerImagery, VisualizerOverlay
from src.visualizers.schemas import (
    CampaignOptionsOut,
    LayerRestriction,
    OverlayOptionOut,
    RasterOverlayOut,
    SourceOptionOut,
    VectorOverlayOut,
    VisualizerCamera,
    VisualizerConfigOut,
    VisualizerCreate,
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
            .options(selectinload(Visualizer.imagery), selectinload(Visualizer.overlays))
            .order_by(Visualizer.name)
        )
        .scalars()
        .all()
    )
    return [
        VisualizerListItemOut(
            id=v.id,
            slug=v.slug,
            name=v.name,
            description=v.description,
            is_public=v.is_public,
            imagery_count=len(v.imagery),
            overlay_count=len(v.overlays),
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
    _apply_camera(visualizer, payload.camera)
    db.add(visualizer)
    db.flush()
    _replace_layers(db, visualizer, payload.imagery, payload.overlays)
    db.commit()
    return load(db, visualizer_id=visualizer.id)


def update(db: Session, visualizer: Visualizer, payload: VisualizerUpdate) -> Visualizer:
    if payload.name is not None:
        visualizer.name = payload.name.strip()
    if payload.description is not None:
        visualizer.description = payload.description
    if payload.is_public is not None:
        visualizer.is_public = payload.is_public
    if payload.camera is not None:
        _apply_camera(visualizer, payload.camera)
    if payload.imagery is not None or payload.overlays is not None:
        _replace_layers(
            db,
            visualizer,
            payload.imagery if payload.imagery is not None else _imagery_config(visualizer),
            payload.overlays if payload.overlays is not None else _overlay_config(visualizer),
        )
    db.commit()
    return load(db, visualizer_id=visualizer.id)


def delete(db: Session, visualizer: Visualizer) -> None:
    db.delete(visualizer)
    db.commit()


def _apply_camera(visualizer: Visualizer, camera: VisualizerCamera | None) -> None:
    if camera is None:
        return
    visualizer.center_lon, visualizer.center_lat, visualizer.zoom = (
        camera.lon,
        camera.lat,
        camera.zoom,
    )


def _replace_layers(
    db: Session,
    visualizer: Visualizer,
    imagery: list[VisualizerImageryCreate],
    overlays: list[VisualizerOverlayCreate],
) -> None:
    """The payload's lists are the whole truth; anything missing from them goes.

    Layers are references, so replacing them costs nothing - there is no state
    on a visualizer layer worth preserving across an edit beyond what the
    payload already carries.
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

    visualizer.imagery = [
        VisualizerImagery(source_id=entry.source_id, display_order=index)
        for index, entry in enumerate(imagery)
    ]
    visualizer.overlays = [
        VisualizerOverlay(
            custom_map_id=entry.custom_map_id,
            vector_layer_id=entry.vector_layer_id,
            visible=entry.visible,
            opacity=entry.opacity,
            display_order=index,
        )
        for index, entry in enumerate(overlays)
    ]
    for entry in overlays:
        if (entry.custom_map_id is None) == (entry.vector_layer_id is None):
            raise HTTPException(status_code=400, detail="An overlay must name exactly one layer")
    db.flush()


def _assert_in_project(db: Session, project_id: int, model, ids: list[int], label: str) -> None:
    """A visualizer may only point at what its own project owns."""
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
    return [
        VisualizerOverlayCreate(
            custom_map_id=entry.custom_map_id,
            vector_layer_id=entry.vector_layer_id,
            visible=entry.visible,
            opacity=entry.opacity,
        )
        for entry in visualizer.overlays
    ]


def config_out(visualizer: Visualizer) -> VisualizerConfigOut:
    return VisualizerConfigOut(
        id=visualizer.id,
        slug=visualizer.slug,
        project_id=visualizer.project_id,
        name=visualizer.name,
        description=visualizer.description,
        is_public=visualizer.is_public,
        camera=_camera_out(visualizer),
        imagery=_imagery_config(visualizer),
        overlays=_overlay_config(visualizer),
    )


def _camera_out(visualizer: Visualizer) -> VisualizerCamera | None:
    if visualizer.center_lon is None or visualizer.center_lat is None or visualizer.zoom is None:
        return None
    return VisualizerCamera(
        lon=visualizer.center_lon, lat=visualizer.center_lat, zoom=visualizer.zoom
    )


def referenced_campaign_ids(visualizer: Visualizer) -> list[int]:
    """Every campaign whose tiles this visualizer needs, for the tiler token."""
    ids = {entry.source.campaign_id for entry in visualizer.imagery if entry.source}
    ids |= {o.custom_map.campaign_id for o in visualizer.overlays if o.custom_map}
    return sorted(ids)


def build_view(db: Session, visualizer: Visualizer, *, can_edit: bool) -> VisualizerViewOut:
    return VisualizerViewOut(
        id=visualizer.id,
        slug=visualizer.slug,
        name=visualizer.name,
        description=visualizer.description,
        is_public=visualizer.is_public,
        project_id=visualizer.project_id,
        project_name=visualizer.project.name,
        camera=_camera_out(visualizer),
        imagery=[_imagery_out(entry.source) for entry in visualizer.imagery if entry.source],
        overlays=[out for out in (_overlay_out(o) for o in visualizer.overlays) if out],
        can_edit=can_edit,
    )


def _imagery_out(source: ImagerySource) -> VisualizerImageryOut:
    tiles_by_slice = {
        s.id: {
            t.visualization_name: VisualizerTileOut(url=t.tile_url, provider=t.tile_provider)
            for t in s.tile_urls
        }
        for collection in source.collections
        for s in collection.slices
    }
    steps = timeline.flatten(
        [
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
    )
    return VisualizerImageryOut(
        source_id=source.id,
        campaign_id=source.campaign_id,
        name=source.name,
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
            for step in steps
            if tiles_by_slice.get(step.slice_id)
        ],
    )


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


def _source_option(source: ImagerySource) -> SourceOptionOut:
    steps = timeline.flatten(
        [
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
    )
    return SourceOptionOut(
        id=source.id,
        name=source.name,
        step_count=len(steps),
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

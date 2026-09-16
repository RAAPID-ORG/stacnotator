"""What an agent can look at, as plain data: the campaign context, default views, and
checking a requested view against that context. No database access."""

import hashlib
import json

from fastapi import HTTPException
from geoalchemy2.shape import to_shape

from src.agents.schemas import (
    BasemapContext,
    CampaignContext,
    CollectionContext,
    SliceContext,
    SourceContext,
    TimeseriesContext,
    ViewCell,
    ViewSpec,
)
from src.annotation.models import AnnotationTask
from src.campaigns.models import Campaign
from src.campaigns.schemas import LabelBase
from src.imagery.models import ImagerySource

OVERVIEW_MAX_CELLS = 16


def build_context(campaign: Campaign) -> CampaignContext:
    """Slices without tiles are left out, except on scene sources, whose layers are
    minted around each task when a view asks for them."""
    settings = campaign.settings
    sources = []
    for source in sorted(campaign.imagery_sources, key=lambda s: s.display_order):
        on_demand = is_scene_source(source)
        collections = []
        for collection in source.collections:
            slices = [s for s in collection.slices if s.tile_urls or on_demand]
            if not slices:
                continue
            cover = (
                collection.slices[collection.cover_slice_index]
                if collection.cover_slice_index < len(collection.slices)
                else None
            )
            collections.append(
                CollectionContext(
                    collection_id=collection.id,
                    name=collection.name,
                    cover_slice_id=cover.id
                    if cover is not None and (cover.tile_urls or on_demand)
                    else None,
                    slices=[
                        SliceContext(
                            slice_id=s.id, name=s.name, start_date=s.start_date, end_date=s.end_date
                        )
                        for s in slices
                    ],
                )
            )
        if collections:
            sources.append(
                SourceContext(
                    source_id=source.id,
                    name=source.name,
                    on_demand=on_demand,
                    default_zoom=source.default_zoom,
                    max_native_zoom=source.max_native_zoom,
                    visualizations=[v.name for v in source.visualizations],
                    collections=sorted(collections, key=_collection_start),
                )
            )

    return CampaignContext(
        campaign_id=campaign.id,
        project_id=campaign.project_id,
        name=campaign.name,
        mode=campaign.mode,
        bbox=(settings.bbox_west, settings.bbox_south, settings.bbox_east, settings.bbox_north),
        sample_extent_meters=settings.sample_extent_meters,
        guide_markdown=settings.guide_markdown,
        labels=[
            LabelBase(id=int(k), name=v["name"], geometry_type=v.get("geometry_type"))
            for k, v in settings.labels.items()
        ],
        form_fields=settings.form_fields,
        imagery=sources,
        basemaps=[
            BasemapContext(basemap_id=b.id, name=b.name, max_native_zoom=b.max_native_zoom)
            for b in campaign.basemaps
        ],
        timeseries=[
            TimeseriesContext(
                timeseries_id=t.id,
                name=t.name,
                group=t.window_name,
                data_source=t.data_source,
                index=t.ts_type,
                start_ym=t.start_ym,
                end_ym=t.end_ym,
            )
            for t in campaign.time_series
        ],
    )


def is_scene_source(source: ImagerySource) -> bool:
    return any(series.config.get("kind") == "planet_scenes" for series in source.generation_series)


def _collection_start(collection: CollectionContext) -> str:
    return min(s.start_date for s in collection.slices)


def default_views(context: CampaignContext) -> list[ViewSpec]:
    """The most recent period covers of the first source plus the time series, and a
    basemap pair at two zooms for the surroundings. The agent asks for detail from there."""
    views = []
    first_source = context.imagery[:1]
    covers = [
        ViewCell(slice_id=c.cover_slice_id)
        for source in first_source
        for c in source.collections
        if c.cover_slice_id is not None
    ][-OVERVIEW_MAX_CELLS:]
    timeseries = [
        ViewCell(
            timeseries_ids=[t.timeseries_id for t in context.timeseries][:8],
            remove_cloudy=True,
        )
    ]
    zoom = context.imagery[0].default_zoom if context.imagery else 15
    if covers:
        views.append(
            ViewSpec(
                cells=covers + (timeseries if context.timeseries else []),
                columns=min(4, len(covers)),
                cell_px=320,
                zoom=zoom,
            )
        )
    elif context.timeseries:
        views.append(ViewSpec(cells=timeseries, columns=2, cell_px=512, zoom=zoom))
    if context.basemaps:
        basemap = context.basemaps[0].basemap_id
        views.append(
            ViewSpec(
                cells=[
                    ViewCell(basemap_id=basemap, zoom=max(1, zoom - 3)),
                    ViewCell(basemap_id=basemap, zoom=min(22, zoom + 1)),
                ],
                columns=2,
                cell_px=512,
                zoom=zoom,
            )
        )
    return views


def check_view(context: CampaignContext, view: ViewSpec) -> None:
    """Reject ids and visualizations the campaign does not have, before a host
    is asked to draw them."""
    slice_vizzes = {
        s.slice_id: source.visualizations
        for source in context.imagery
        for c in source.collections
        for s in c.slices
    }
    basemaps = {b.basemap_id for b in context.basemaps}
    series = {t.timeseries_id for t in context.timeseries}
    for cell in view.cells:
        if cell.slice_id is not None:
            vizzes = slice_vizzes.get(cell.slice_id)
            if vizzes is None:
                raise HTTPException(422, f"slice {cell.slice_id} is not in this campaign")
            if cell.visualization is not None and cell.visualization not in vizzes:
                raise HTTPException(
                    422, f"slice {cell.slice_id} has no visualization {cell.visualization!r}"
                )
        if cell.basemap_id is not None and cell.basemap_id not in basemaps:
            raise HTTPException(422, f"basemap {cell.basemap_id} is not in this campaign")
        for ts_id in cell.timeseries_ids or []:
            if ts_id not in series:
                raise HTTPException(422, f"time series {ts_id} is not in this campaign")


def view_key(view: ViewSpec) -> str:
    canonical = json.dumps(view.model_dump(mode="json", exclude_none=True), sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()


def task_point(task: AnnotationTask) -> tuple[float, float, str]:
    """(lat, lon, wkt) of a task; polygons are represented by their centroid."""
    shape = to_shape(task.geometry.geometry)
    centroid = shape.centroid
    return centroid.y, centroid.x, shape.wkt

"""Deep-copy a campaign inside its project.

The full setup is always copied: settings, imagery sources/collections/slices
with their registered tile URLs (pgstac/MPC mosaic searches are content
addressed, so both campaigns can safely point at the same mosaics), basemaps,
views, default canvas layouts, time series and overlay layers. Tasks,
annotations and personal canvas layouts are opt-in. Soft task claims are
runtime state of the original campaign and are never copied.
"""

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.annotation.models import (
    Annotation,
    AnnotationGeometry,
    AnnotationTask,
    AnnotationTaskAssignment,
    Embedding,
)
from src.campaigns.models import Campaign, TaskSet
from src.canvas.models import CanvasLayout
from src.imagery.models import ImageryView
from src.timeseries.models import TimeSeries


def clone_row(obj, **overrides):
    """New instance carrying every mapped column of ``obj`` except primary
    keys; FKs onto the duplicated parents come in as overrides."""
    mapper = sa_inspect(type(obj))
    pk_keys = {mapper.get_property_by_column(col).key for col in mapper.primary_key}
    data = {
        prop.key: getattr(obj, prop.key) for prop in mapper.column_attrs if prop.key not in pk_keys
    }
    data.update(overrides)
    return type(obj)(**data)


def remapped_layout_data(layout_data: list[dict], collection_id_map: dict[int, int]) -> list[dict]:
    """Rewrite imagery-window keys (stringified collection ids) onto the
    duplicated collections; chrome and timeseries keys pass through. Items
    whose collection did not survive the copy are dropped."""
    out: list[dict] = []
    for item in layout_data:
        key = item.get("i", "")
        if key.isdigit():
            new_id = collection_id_map.get(int(key))
            if new_id is None:
                continue
            out.append({**item, "i": str(new_id)})
        else:
            out.append(dict(item))
    return out


def duplicate_campaign(
    db: Session,
    campaign: Campaign,
    *,
    include_tasks: bool,
    include_annotations: bool,
    include_user_layouts: bool,
) -> Campaign:
    """Create the duplicate in one transaction and commit. Returns the new
    campaign row. Annotations linked to a task are only copied when the tasks
    are copied too; without them only free (open-mode) annotations carry over.
    """
    dup = Campaign(
        name=f"{campaign.name} (copy)",
        project_id=campaign.project_id,
        mode=campaign.mode,
        registration_status=campaign.registration_status,
        # Embeddings hang off tasks; without tasks there is nothing pending.
        embedding_status=campaign.embedding_status if include_tasks else "ready",
        registration_errors=campaign.registration_errors,
    )
    db.add(dup)
    db.flush()

    db.add(clone_row(campaign.settings, campaign_id=dup.id))

    # Imagery tree. Ids are remapped level by level so views, layouts and
    # annotation slice references can follow.
    source_map: dict[int, int] = {}
    collection_map: dict[int, int] = {}
    slice_map: dict[int, int] = {}
    for src in campaign.imagery_sources:
        new_src = clone_row(src, campaign_id=dup.id)
        db.add(new_src)
        db.flush()
        source_map[src.id] = new_src.id
        for viz in src.visualizations:
            db.add(clone_row(viz, source_id=new_src.id))
        for col in src.collections:
            new_col = clone_row(col, source_id=new_src.id)
            db.add(new_col)
            db.flush()
            collection_map[col.id] = new_col.id
            if col.stac_config is not None:
                db.add(clone_row(col.stac_config, collection_id=new_col.id))
            for viz_config in col.viz_configs:
                db.add(clone_row(viz_config, collection_id=new_col.id))
            for sl in col.slices:
                new_slice = clone_row(sl, collection_id=new_col.id)
                db.add(new_slice)
                db.flush()
                slice_map[sl.id] = new_slice.id
                for tile_url in sl.tile_urls:
                    db.add(clone_row(tile_url, slice_id=new_slice.id))

    for basemap in campaign.basemaps:
        db.add(clone_row(basemap, campaign_id=dup.id))
    for series in db.scalars(select(TimeSeries).where(TimeSeries.campaign_id == campaign.id)):
        db.add(clone_row(series, campaign_id=dup.id))
    for custom_map in campaign.custom_maps:
        db.add(clone_row(custom_map, campaign_id=dup.id))
    for vector_layer in campaign.vector_layers:
        db.add(clone_row(vector_layer, campaign_id=dup.id))

    view_map: dict[int, int] = {}
    for view in campaign.imagery_views:
        new_view = ImageryView(
            campaign_id=dup.id,
            name=view.name,
            display_order=view.display_order,
            source_ids=[source_map[sid] for sid in view.source_ids if sid in source_map],
        )
        db.add(new_view)
        db.flush()
        view_map[view.id] = new_view.id

    layout_filter = CanvasLayout.user_id.is_(None) & CanvasLayout.is_default
    if include_user_layouts:
        layout_filter = layout_filter | CanvasLayout.user_id.is_not(None)
    layouts = db.scalars(
        select(CanvasLayout).where(CanvasLayout.campaign_id == campaign.id, layout_filter)
    ).all()
    for layout in layouts:
        if layout.view_id is not None and layout.view_id not in view_map:
            continue
        db.add(
            CanvasLayout(
                campaign_id=dup.id,
                view_id=view_map[layout.view_id] if layout.view_id is not None else None,
                user_id=layout.user_id,
                is_default=layout.is_default,
                layout_data=remapped_layout_data(layout.layout_data, collection_map),
            )
        )

    # Tasks and annotations may reference the same geometry row; copy each
    # referenced geometry exactly once so the duplicate is fully independent.
    geometry_map: dict[int, int] = {}

    def cloned_geometry_id(old_id: int) -> int:
        if old_id not in geometry_map:
            geometry = db.get(AnnotationGeometry, old_id)
            assert geometry is not None  # noqa: S101 - NOT NULL FK on every referrer
            new_geometry = AnnotationGeometry(geometry=geometry.geometry)
            db.add(new_geometry)
            db.flush()
            geometry_map[old_id] = new_geometry.id
        return geometry_map[old_id]

    task_map: dict[int, int] = {}
    if include_tasks:
        set_map: dict[int, int] = {}
        for task_set in db.scalars(select(TaskSet).where(TaskSet.campaign_id == campaign.id)):
            new_set = clone_row(task_set, campaign_id=dup.id)
            db.add(new_set)
            db.flush()
            set_map[task_set.id] = new_set.id

        tasks = db.scalars(
            select(AnnotationTask).where(AnnotationTask.campaign_id == campaign.id)
        ).all()
        for task in tasks:
            new_task = clone_row(
                task,
                campaign_id=dup.id,
                geometry_id=cloned_geometry_id(task.geometry_id),
                task_set_id=set_map[task.task_set_id],
            )
            db.add(new_task)
            db.flush()
            task_map[task.id] = new_task.id

        task_ids = list(task_map)
        assignments = db.scalars(
            select(AnnotationTaskAssignment).where(AnnotationTaskAssignment.task_id.in_(task_ids))
        ).all()
        for assignment in assignments:
            if include_annotations:
                # Full clone: the copied annotations keep the statuses true.
                db.add(clone_row(assignment, task_id=task_map[assignment.task_id]))
            elif assignment.claimed_at is None:
                # Explicit assignments are setup - keep them, reset progress.
                # Soft claims are runtime state and die with the annotations.
                db.add(
                    clone_row(assignment, task_id=task_map[assignment.task_id], status="pending")
                )

        for embedding in db.scalars(
            select(Embedding).where(Embedding.annotation_task_id.in_(task_ids))
        ):
            db.add(clone_row(embedding, annotation_task_id=task_map[embedding.annotation_task_id]))

    if include_annotations:
        annotations = db.scalars(
            select(Annotation).where(Annotation.campaign_id == campaign.id)
        ).all()
        for annotation in annotations:
            if annotation.annotation_task_id is not None:
                new_task_id = task_map.get(annotation.annotation_task_id)
                if new_task_id is None:
                    continue
            else:
                new_task_id = None
            db.add(
                clone_row(
                    annotation,
                    campaign_id=dup.id,
                    geometry_id=cloned_geometry_id(annotation.geometry_id),
                    annotation_task_id=new_task_id,
                    imagery_slice_id=(
                        slice_map.get(annotation.imagery_slice_id)
                        if annotation.imagery_slice_id is not None
                        else None
                    ),
                )
            )

    db.commit()
    db.refresh(dup)
    return dup

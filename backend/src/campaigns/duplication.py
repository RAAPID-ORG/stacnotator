"""Deep-copy a campaign inside its project.

The full setup is always copied: settings, imagery sources/collections/slices
with their registered tile URLs (pgstac/MPC mosaic searches are content
addressed, so both campaigns can safely point at the same mosaics), basemaps,
views, default canvas layouts, time series and overlay layers. Tasks,
annotations and personal canvas layouts are opt-in. Task claims are runtime
state of the original campaign and are never copied.
"""

from collections.abc import Sequence

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.annotation.models import (
    Annotation,
    AnnotationGeometry,
    AnnotationTask,
    AnnotationTaskAssignment,
    Embedding,
)
from src.campaigns.models import Campaign, TaskSet
from src.canvas.models import CanvasLayout
from src.imagery.models import (
    ImageryCollection,
    ImageryGenerationSeries,
    ImagerySlice,
    ImagerySource,
    ImageryView,
)
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


def insert_all[Row](db: Session, rows: list[Row]) -> list[Row]:
    """Insert a whole level of the copy in one flush. Flushing per row is what
    turns duplicating a campaign with thousands of slices or tasks into
    thousands of round trips; SQLAlchemy batches these and still hands each
    object back its own primary key."""
    db.add_all(rows)
    db.flush()
    return rows


def id_map(originals: Sequence, copies: Sequence) -> dict[int, int]:
    """old id -> new id, for rows cloned in the same order."""
    return {original.id: copy.id for original, copy in zip(originals, copies, strict=True)}


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


def _duplicate_imagery(
    db: Session, campaign: Campaign, dup: Campaign
) -> tuple[dict[int, int], dict[int, int], dict[int, int]]:
    """Copy sources, collections and slices with everything hanging off them.

    Read and written one level at a time: each level is fetched in a single
    query (children eagerly, so walking them costs nothing) and inserted in a
    single flush, which keeps the cost proportional to the depth of the tree
    rather than to the number of rows. Returns the old->new id maps for the
    levels that views, layouts and annotations refer to.
    """
    sources = list(
        db.scalars(
            select(ImagerySource)
            .where(ImagerySource.campaign_id == campaign.id)
            .options(selectinload(ImagerySource.visualizations))
        )
    )
    source_map = id_map(
        sources, insert_all(db, [clone_row(s, campaign_id=dup.id) for s in sources])
    )
    for source in sources:
        for viz in source.visualizations:
            db.add(clone_row(viz, source_id=source_map[source.id]))

    series = list(
        db.scalars(
            select(ImageryGenerationSeries).where(ImageryGenerationSeries.source_id.in_(source_map))
        )
    )
    # Copied so the duplicate owns its own authoring input; sharing the
    # original's rows would leave it holding a dangling reference the day the
    # original campaign is deleted.
    series_map = id_map(
        series, insert_all(db, [clone_row(s, source_id=source_map[s.source_id]) for s in series])
    )

    collections = list(
        db.scalars(
            select(ImageryCollection)
            .where(ImageryCollection.source_id.in_(source_map))
            .options(
                selectinload(ImageryCollection.stac_config),
                selectinload(ImageryCollection.viz_configs),
            )
        )
    )
    collection_map = id_map(
        collections,
        insert_all(
            db,
            [
                clone_row(
                    col,
                    source_id=source_map[col.source_id],
                    generation_series_id=(
                        series_map.get(col.generation_series_id)
                        if col.generation_series_id is not None
                        else None
                    ),
                )
                for col in collections
            ],
        ),
    )
    for col in collections:
        if col.stac_config is not None:
            db.add(clone_row(col.stac_config, collection_id=collection_map[col.id]))
        for viz_config in col.viz_configs:
            db.add(clone_row(viz_config, collection_id=collection_map[col.id]))

    slices = list(
        db.scalars(
            select(ImagerySlice)
            .where(ImagerySlice.collection_id.in_(collection_map))
            .options(selectinload(ImagerySlice.tile_urls))
        )
    )
    slice_map = id_map(
        slices,
        insert_all(
            db, [clone_row(sl, collection_id=collection_map[sl.collection_id]) for sl in slices]
        ),
    )
    for sl in slices:
        for tile_url in sl.tile_urls:
            db.add(clone_row(tile_url, slice_id=slice_map[sl.id]))

    return source_map, collection_map, slice_map


def _duplicate_geometries(db: Session, geometry_ids: set[int]) -> dict[int, int]:
    """Copy the given geometries, returning old id -> new id."""
    if not geometry_ids:
        return {}
    originals = list(
        db.scalars(select(AnnotationGeometry).where(AnnotationGeometry.id.in_(geometry_ids)))
    )
    return id_map(
        originals, insert_all(db, [AnnotationGeometry(geometry=g.geometry) for g in originals])
    )


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

    source_map, collection_map, slice_map = _duplicate_imagery(db, campaign, dup)

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

    tasks = (
        list(db.scalars(select(AnnotationTask).where(AnnotationTask.campaign_id == campaign.id)))
        if include_tasks
        else []
    )
    annotations = (
        list(db.scalars(select(Annotation).where(Annotation.campaign_id == campaign.id)))
        if include_annotations
        else []
    )

    # Every geometry the copy will reference is cloned exactly once, one insert
    # per level rather than a round trip per shape. Tasks and their annotations
    # share a geometry row, which is what the accumulated map preserves.
    geometry_map = _duplicate_geometries(db, {task.geometry_id for task in tasks})

    task_map: dict[int, int] = {}
    if include_tasks:
        task_sets = list(db.scalars(select(TaskSet).where(TaskSet.campaign_id == campaign.id)))
        set_map = id_map(
            task_sets, insert_all(db, [clone_row(ts, campaign_id=dup.id) for ts in task_sets])
        )

        task_map = id_map(
            tasks,
            insert_all(
                db,
                [
                    clone_row(
                        task,
                        campaign_id=dup.id,
                        geometry_id=geometry_map[task.geometry_id],
                        task_set_id=set_map[task.task_set_id],
                        claimed_by_user_id=None,
                        claimed_at=None,
                    )
                    for task in tasks
                ],
            ),
        )

        task_ids = list(task_map)
        assignments = db.scalars(
            select(AnnotationTaskAssignment).where(AnnotationTaskAssignment.task_id.in_(task_ids))
        ).all()
        for assignment in assignments:
            # An assignment is setup, so it is always copied. Progress rides on
            # the annotations, which means it comes along only when they do.
            db.add(clone_row(assignment, task_id=task_map[assignment.task_id]))

        for embedding in db.scalars(
            select(Embedding).where(Embedding.annotation_task_id.in_(task_ids))
        ):
            db.add(clone_row(embedding, annotation_task_id=task_map[embedding.annotation_task_id]))

    # An annotation made on a task only comes along when its task did.
    copied = [
        annotation
        for annotation in annotations
        if annotation.annotation_task_id is None or annotation.annotation_task_id in task_map
    ]
    geometry_map |= _duplicate_geometries(db, {a.geometry_id for a in copied} - set(geometry_map))
    for annotation in copied:
        db.add(
            clone_row(
                annotation,
                campaign_id=dup.id,
                geometry_id=geometry_map[annotation.geometry_id],
                annotation_task_id=(
                    task_map[annotation.annotation_task_id]
                    if annotation.annotation_task_id is not None
                    else None
                ),
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

"""Deep-copy a campaign, into its own project or into another one.

The full setup is always copied: settings, imagery sources/collections/slices
with their registered tile URLs (pgstac/MPC mosaic searches are content
addressed, so both campaigns can safely point at the same mosaics), basemaps,
views, default canvas layouts, time series and overlay layers. Tasks,
annotations and personal canvas layouts are opt-in. Task claims are runtime
state of the original campaign and are never copied.

Copying into another project drops everything that names a user - annotations,
task assignments and personal layouts - because the people on the source
project need not be on the target one. See ``CopyPlan``.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import exists, select
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session, selectinload

from src.annotation.models import (
    Annotation,
    AnnotationGeometry,
    AnnotationTask,
    AnnotationTaskAssignment,
    Embedding,
)
from src.auth.constants import AGENT_ISSUER
from src.auth.models import User
from src.campaigns.models import Campaign, TaskSet
from src.canvas.models import CanvasLayout
from src.custom_layers.models import CustomMap
from src.imagery.models import (
    CollectionStacConfig,
    ImageryCollection,
    ImageryGenerationSeries,
    ImagerySlice,
    ImagerySource,
    ImageryView,
    SliceTileUrl,
)
from src.organizations.models import Organization
from src.projects.models import Project
from src.timeseries.models import TimeSeries


@dataclass(frozen=True)
class CopyPlan:
    """Where the copy lands and what it is allowed to carry there.

    Inside the same project everything the caller asked for is copied. Into
    another project, anything naming a user is dropped: those users need not
    be on the target project, and an assignment or annotation attributed to
    someone who cannot open the campaign is worse than none. Across
    organizations the shared provider keys go too - they belong to the source
    organization, and a campaign elsewhere must not spend them.
    """

    project_id: int
    name: str
    tasks: bool
    annotations: bool
    assignments: bool
    user_layouts: bool
    shared_api_keys: bool


def plan_copy(
    campaign: Campaign,
    target_project: Project | None,
    *,
    include_tasks: bool,
    include_annotations: bool,
    include_user_layouts: bool,
    include_assignments: bool = True,
) -> CopyPlan:
    """``target_project`` None (or the campaign's own project) is a plain
    in-project duplicate. Assignments only ever ride along with the tasks they
    are on."""
    if target_project is None or target_project.id == campaign.project_id:
        return CopyPlan(
            project_id=campaign.project_id,
            # Only a same-project copy needs to be told apart from its original.
            name=f"{campaign.name} (copy)",
            tasks=include_tasks,
            annotations=include_annotations,
            assignments=include_tasks and include_assignments,
            user_layouts=include_user_layouts,
            shared_api_keys=True,
        )
    return CopyPlan(
        project_id=target_project.id,
        name=campaign.name,
        tasks=include_tasks,
        annotations=False,
        assignments=False,
        user_layouts=False,
        shared_api_keys=target_project.organization_id == campaign.project.organization_id,
    )


def unmet_org_requirements(
    db: Session, campaign: Campaign, organization: Organization
) -> list[str]:
    """What the campaign's imagery needs that ``organization`` is not granted.

    Tiler access and internal-storage reads are granted per organization, so a
    copy into another one can land pointing at a tiler its new owner may not
    use. Nothing about such a copy looks wrong; its tiles simply never arrive.
    """
    collections = (
        select(ImageryCollection.id)
        .join(ImagerySource, ImagerySource.id == ImageryCollection.source_id)
        .where(ImagerySource.campaign_id == campaign.id)
    )
    # What the collections are pinned to, plus what registration actually
    # resolved them to: a campaign can be either side of a registration run.
    pinned = db.scalars(
        select(CollectionStacConfig.tile_provider).where(
            CollectionStacConfig.collection_id.in_(collections)
        )
    )
    registered = db.scalars(
        select(SliceTileUrl.tile_provider)
        .join(ImagerySlice, ImagerySlice.id == SliceTileUrl.slice_id)
        .where(ImagerySlice.collection_id.in_(collections))
    )
    allowed = set(organization.allowed_tiler_names)
    used = {name for name in (*pinned, *registered) if name}
    missing = [f"tiler '{name}'" for name in sorted(used - allowed)]

    if not organization.allows_internal_storage and (
        db.scalar(
            select(
                exists().where(
                    CollectionStacConfig.collection_id.in_(collections),
                    CollectionStacConfig.internal_storage,
                )
            )
        )
        or db.scalar(
            select(exists().where(CustomMap.campaign_id == campaign.id, CustomMap.internal_storage))
        )
    ):
        missing.append("internal storage")
    return missing


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


def _key_overrides(keep_shared_keys: bool) -> dict:
    """A layer's own encrypted key travels with the copy; a pointer at the
    organization's shared key only does while the organization stays the same."""
    return {} if keep_shared_keys else {"organization_api_key_id": None}


def _duplicate_imagery(
    db: Session, campaign: Campaign, dup: Campaign, *, keep_shared_keys: bool
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
        sources,
        insert_all(
            db,
            [clone_row(s, campaign_id=dup.id, **_key_overrides(keep_shared_keys)) for s in sources],
        ),
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
    target_project: Project | None = None,
    include_tasks: bool,
    include_annotations: bool,
    include_user_layouts: bool,
    include_assignments: bool = True,
) -> Campaign:
    """Create the duplicate in one transaction and commit. Returns the new
    campaign row. Annotations linked to a task are only copied when the tasks
    are copied too; without them only free (open-mode) annotations carry over.

    ``target_project`` sends the copy to another project, which narrows what it
    may carry (see ``CopyPlan``); the caller is responsible for checking the
    user administers it.
    """
    plan = plan_copy(
        campaign,
        target_project,
        include_tasks=include_tasks,
        include_annotations=include_annotations,
        include_user_layouts=include_user_layouts,
        include_assignments=include_assignments,
    )
    dup = Campaign(
        name=plan.name,
        project_id=plan.project_id,
        mode=campaign.mode,
        registration_status=campaign.registration_status,
        # Embeddings hang off tasks; without tasks there is nothing pending.
        embedding_status=campaign.embedding_status if plan.tasks else "ready",
        registration_errors=campaign.registration_errors,
    )
    db.add(dup)
    db.flush()

    db.add(clone_row(campaign.settings, campaign_id=dup.id))

    source_map, collection_map, slice_map = _duplicate_imagery(
        db, campaign, dup, keep_shared_keys=plan.shared_api_keys
    )

    for basemap in campaign.basemaps:
        db.add(clone_row(basemap, campaign_id=dup.id, **_key_overrides(plan.shared_api_keys)))
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
    if plan.user_layouts:
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
        if plan.tasks
        else []
    )
    annotations = (
        list(db.scalars(select(Annotation).where(Annotation.campaign_id == campaign.id)))
        if plan.annotations
        else []
    )

    # Every geometry the copy will reference is cloned exactly once, one insert
    # per level rather than a round trip per shape. Tasks and their annotations
    # share a geometry row, which is what the accumulated map preserves.
    geometry_map = _duplicate_geometries(db, {task.geometry_id for task in tasks})

    task_map: dict[int, int] = {}
    if plan.tasks:
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
        if plan.assignments:
            # What a labelling agent holds never travels: an agent is registered for one
            # campaign, so in the copy the task would sit with an account that cannot work
            # it. Those tasks arrive free for anyone to take.
            query = (
                select(AnnotationTaskAssignment)
                .join(User, User.id == AnnotationTaskAssignment.user_id)
                .where(AnnotationTaskAssignment.task_id.in_(task_ids), User.issuer != AGENT_ISSUER)
            )
            for assignment in db.scalars(query).all():
                # An assignment is setup, so it is copied with the tasks.
                # Progress rides on the annotations, which means it comes along
                # only when they do.
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

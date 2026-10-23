import logging
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import ARRAY, Text, and_, cast, delete, exists, func, or_, select, update
from sqlalchemy.orm import Session, joinedload, selectinload

from src.annotation.forms import campaign_form_fields
from src.annotation.models import Annotation
from src.auth.models import User
from src.campaigns.models import Campaign
from src.campaigns.policy import _reject_anyone_kind_if_private
from src.campaigns.schemas import (
    CampaignListItemOut,
    CampaignSettingsCreate,
    CampaignUpdate,
    LabelBase,
    LabellingPolicy,
    default_labelling_policy,
)
from src.canvas.service import new_default_main_layout
from src.custom_layers.service import revoke_campaign_private_searches
from src.imagery.models import (
    ImageryCollection,
    ImagerySlice,
    ImagerySource,
    ImageryView,
)
from src.imagery.registration import commit_and_register, drop_mosaics
from src.imagery.service import save_imagery_editor_state
from src.organizations.service import active_organization_ids
from src.projects.access import VISIBILITY_ORGANIZATION, VISIBILITY_PUBLIC
from src.projects.models import Project, ProjectUser
from src.projects.viewer import ViewerStanding
from src.tasks import embeddings
from src.tasks.models import Task, TaskSet
from src.tasks.task_sets import DEFAULT_TASK_SET_NAME
from src.timeseries.service import add_timeseries

logger = logging.getLogger(__name__)


# ============================================================================
# Campaign Management
# ============================================================================


def list_campaigns_with_user_roles(db: Session, user: User) -> list[CampaignListItemOut]:
    """Every campaign the user can open, with their roles on its project."""
    campaigns = db.scalars(
        select(Campaign).options(joinedload(Campaign.project)).order_by(Campaign.created_at.desc())
    ).all()
    standing = ViewerStanding(db, user)
    items = [(campaign, standing.flags(campaign.project)) for campaign in campaigns]
    return [
        CampaignListItemOut.for_viewer(campaign, campaign.project, flags)
        for campaign, flags in items
        if flags.has_access
    ]


def visible_campaign_ids(db: Session, user: User) -> list[int]:
    """Ids of the campaigns list_campaigns_with_user_roles returns, in one query,
    for scoping a tiler token."""
    if user.is_platform_admin:
        return list(db.scalars(select(Campaign.id)).all())

    stmt = (
        select(Campaign.id)
        .join(Project, Project.id == Campaign.project_id)
        .outerjoin(
            ProjectUser,
            and_(ProjectUser.project_id == Project.id, ProjectUser.user_id == user.id),
        )
        .where(
            or_(
                Project.visibility == VISIBILITY_PUBLIC,
                ProjectUser.user_id.is_not(None),
                and_(
                    Project.visibility == VISIBILITY_ORGANIZATION,
                    Project.organization_id.in_(active_organization_ids(user.id)),
                ),
            )
        )
        .distinct()
    )
    return list(db.scalars(stmt).all())


# Eager-load options covering every relationship that CampaignOut(+Full) serializes.
# Without these, Pydantic serialization lazy-loads each relationship one row at a
# time - on large campaigns (thousands of slices) that turns a single
# response into thousands of cross-region round-trips.
_CAMPAIGN_FULL_LOAD_OPTIONS = (
    joinedload(Campaign.project),
    selectinload(Campaign.canvas_layouts),
    selectinload(Campaign.time_series),
    selectinload(Campaign.basemaps),
    selectinload(Campaign.custom_maps),
    # Serialized by CampaignOut, so omitting it lazy-loads at serialization time
    # rather than saving a query.
    selectinload(Campaign.vector_layers),
    selectinload(Campaign.imagery_sources).options(
        selectinload(ImagerySource.visualizations),
        selectinload(ImagerySource.collections).options(
            selectinload(ImageryCollection.visualizations),
            selectinload(ImageryCollection.slices).options(
                selectinload(ImagerySlice.mosaics), selectinload(ImagerySlice.templates)
            ),
        ),
    ),
    selectinload(Campaign.imagery_views).options(
        selectinload(ImageryView.canvas_layouts), selectinload(ImageryView.sources)
    ),
)


def get_campaign_summary(db: Session, campaign_id: int) -> Campaign:
    """Load only what `CampaignSummaryOut` serializes: the row and its project.

    Deliberately not `_CAMPAIGN_FULL_LOAD_OPTIONS` - that chain walks the imagery tree
    in about a dozen sequential queries, which the pages using this never read.
    """
    campaign = db.execute(
        select(Campaign).options(joinedload(Campaign.project)).where(Campaign.id == campaign_id)
    ).scalar_one_or_none()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign


def get_campaign_full(db: Session, campaign_id: int) -> Campaign:
    """Load a campaign with every relationship that CampaignOut serializes."""
    campaign = (
        db.execute(
            select(Campaign).options(*_CAMPAIGN_FULL_LOAD_OPTIONS).where(Campaign.id == campaign_id)
        )
        .unique()
        .scalar_one_or_none()
    )
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign


def create_campaign(
    db: Session,
    *,
    name: str,
    default_work_mode: str,
    project_id: int,
    settings: CampaignSettingsCreate,
    user_id: UUID,
    imagery_editor_state=None,
    timeseries_configs: list | None = None,
    labelling_policy: LabellingPolicy | None = None,
) -> Campaign:
    """
    Create a new campaign with default layout and settings, optionally imagery/timeseries.
    Membership lives on the owning project, not the campaign.

    Args:
        db: Database session
        name: Campaign name
        default_work_mode: The work mode the annotation page opens in
        project_id: Owning project; its is_public flag governs the default
            labelling policy and the 'anyone' audience check
        settings: Campaign configuration settings
        user_id: ID of the creating user (used for imagery editor state)
        imagery_editor_state: Optional imagery editor state to persist
        timeseries_configs: Optional list of timeseries configurations to create
        labelling_policy: Who may label what; defaults to default_labelling_policy()
            when omitted (matches current unified behavior)

    Returns:
        Created campaign with all relationships loaded
    """
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    is_public = project.visibility == VISIBILITY_PUBLIC
    resolved_policy = labelling_policy or default_labelling_policy(is_public=is_public)
    _reject_anyone_kind_if_private(resolved_policy, is_public)

    campaign = Campaign(
        name=name,
        default_work_mode=default_work_mode,
        project_id=project_id,
        guide_markdown="# Campaign Guide\n\nWelcome! This guide helps annotators understand the campaign goals and labeling conventions.\n",
        labelling_policy=resolved_policy.model_dump(mode="json"),
        **settings.to_orm(),
    )
    db.add(campaign)
    db.flush()  # Get campaign.id

    db.add(TaskSet(campaign_id=campaign.id, name=DEFAULT_TASK_SET_NAME))
    db.add(new_default_main_layout(campaign.id))
    db.flush()
    db.refresh(campaign)

    if timeseries_configs:
        add_timeseries(db, campaign.id, timeseries_configs)
        db.refresh(campaign)

    if imagery_editor_state:
        save_imagery_editor_state(db, campaign, imagery_editor_state)
    campaign.registration_status = "ready"
    campaign.embedding_status = "ready"
    commit_and_register(db, campaign, campaign.bbox)
    embeddings.start_embedding_run(db, campaign)
    return get_campaign_full(db, campaign.id)


def update_campaign(db: Session, campaign: Campaign, changes: CampaignUpdate) -> Campaign:
    """Change what was sent and leave the rest. Labels, form fields and the task
    output each guard the annotations already made against them; a new area
    registers the imagery again, a new embedding year fetches embeddings again."""
    sent = changes.model_fields_set
    if "task_output" in sent and changes.task_output is not None:
        _check_task_output_change(db, campaign, changes.task_output)
    if "labels" in sent and changes.labels is not None:
        _check_label_changes(db, campaign, changes.labels)
        campaign.labels = [label.model_dump() for label in changes.labels]
    if "form_fields" in sent and changes.form_fields is not None:
        _apply_form_field_changes(db, campaign, changes.form_fields)
        campaign.form_fields = [field.model_dump() for field in changes.form_fields]
    if "labelling_policy" in sent and changes.labelling_policy is not None:
        _reject_anyone_kind_if_private(changes.labelling_policy, campaign.is_public)
        campaign.labelling_policy = changes.labelling_policy.model_dump(mode="json")
    for field in (
        "name",
        "guide_markdown",
        "sample_extent_meters",
        "research_sharing",
        "task_output",
    ):
        if field in sent:
            setattr(campaign, field, getattr(changes, field))

    recompute_embeddings = "embedding_year" in sent and changes.embedding_year not in (
        None,
        campaign.embedding_year,
    )
    if "embedding_year" in sent:
        campaign.embedding_year = changes.embedding_year
    if recompute_embeddings:
        db.execute(update(Task).where(Task.campaign_id == campaign.id).values(embedding=None))

    if changes.bbox is not None and changes.bbox != campaign.bbox:
        if campaign.registration_status == "registering":
            raise HTTPException(
                status_code=409,
                detail="Wait for imagery registration to finish before changing the area",
            )
        campaign.bbox_west, campaign.bbox_south, campaign.bbox_east, campaign.bbox_north = (
            changes.bbox
        )
        drop_mosaics(campaign.imagery_sources)
        commit_and_register(db, campaign, campaign.bbox)
    db.commit()
    if recompute_embeddings:
        embeddings.start_embedding_run(db, campaign)
    return get_campaign_full(db, campaign.id)


def _check_task_output_change(db: Session, campaign: Campaign, task_output: str) -> None:
    """Labelling tasks and drawing around them are locked in once any task has
    been worked: the outcomes stored so far would change meaning."""
    if campaign.task_output != task_output and db.scalar(
        select(
            exists().where(
                Annotation.campaign_id == campaign.id, Annotation.annotation_task_id.isnot(None)
            )
        )
    ):
        raise HTTPException(
            status_code=409,
            detail="The task output cannot change once tasks have been annotated",
        )


def _check_label_changes(db: Session, campaign: Campaign, labels: list[LabelBase]) -> None:
    """Labels keep their ids for life, since annotations store them: renames and
    additions are fine, removing a label or changing the geometry of one in use
    is not."""
    existing = {label["id"]: label for label in campaign.labels}
    removed = set(existing) - {label.id for label in labels}
    if removed:
        raise HTTPException(
            status_code=400,
            detail=(
                "Removing labels is not supported (would orphan annotations). "
                f"Missing label id(s): {sorted(removed)}"
            ),
        )
    for label in labels:
        old_type = existing.get(label.id, {}).get("geometry_type", label.geometry_type)
        if old_type == label.geometry_type:
            continue
        in_use = db.scalar(
            select(
                exists().where(
                    Annotation.campaign_id == campaign.id, Annotation.label_id == label.id
                )
            )
        )
        if in_use:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Cannot change geometry_type for label {label.id} from "
                    f"'{old_type}' to '{label.geometry_type}': "
                    "annotations using this label already exist"
                ),
            )


def _answered_form_field_keys(db: Session, campaign_id: int) -> set[str]:
    """Field ids that at least one annotation in the campaign has an answer
    for. One scan answers it for every field, so callers stay clear of a query
    per field."""
    return set(
        db.scalars(
            select(func.distinct(func.jsonb_object_keys(Annotation.form_values))).where(
                Annotation.campaign_id == campaign_id,
                Annotation.form_values.isnot(None),
            )
        ).all()
    )


def _apply_form_field_changes(db: Session, campaign: Campaign, form_fields: list) -> None:
    """Field ids anchor the stored answers: edit = same id, add = new id. A field
    missing from the list goes with every answer stored for it (the caller confirms
    that with the user). Reshaping a field that has answers (type, number type,
    removed options) is rejected: those answers would become unreadable rather
    than deliberately discarded."""
    existing = {str(f.id): f for f in campaign_form_fields(campaign)}
    removed = set(existing) - {str(field.id) for field in form_fields}

    reshaped: list[tuple[Any, str]] = []
    for field in form_fields:
        old = existing.get(str(field.id))
        if not old:
            continue
        shape_changed = old.type != field.type or getattr(old, "number_type", None) != getattr(
            field, "number_type", None
        )
        old_option_ids = {option.id for option in getattr(old, "options", [])}
        new_option_ids = {option.id for option in getattr(field, "options", [])}
        if shape_changed or old_option_ids - new_option_ids:
            reshaped.append((field, "type" if shape_changed else "options"))

    answered = _answered_form_field_keys(db, campaign.id) if (reshaped or removed) else set()
    for field, what in reshaped:
        if str(field.id) in answered:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Cannot change the {what} of form field {field.id} "
                    f"('{field.title}'): annotations already answered it"
                ),
            )

    # Only once every reshape is accepted, so a 409 leaves stored answers alone.
    # `jsonb - text[]` drops just the removed keys.
    strip = removed & answered
    if strip:
        db.execute(
            update(Annotation)
            .where(Annotation.campaign_id == campaign.id, Annotation.form_values.isnot(None))
            .values(form_values=Annotation.form_values.op("-")(cast(sorted(strip), ARRAY(Text))))
        )


def delete_campaign(db: Session, campaign_id: int) -> None:
    """Delete a campaign and everything hanging off it - settings, canvas
    layouts, imagery, timeseries, tasks and annotations - through the database's
    own ON DELETE CASCADE. It is issued as a Core statement on purpose: deleting
    the ORM object cascades in Python instead, loading every task and annotation
    into the session to delete them one statement at a time."""
    revoke_campaign_private_searches(db, campaign_id)
    db.execute(delete(Campaign).where(Campaign.id == campaign_id))
    db.commit()

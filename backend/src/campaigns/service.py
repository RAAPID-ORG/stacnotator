import logging
import threading
from collections.abc import Iterable
from datetime import datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy.orm.attributes import flag_modified

from src.annotation import embeddings_service
from src.annotation.models import Annotation, AnnotationTask, Embedding
from src.auth.constants import ROLE_ADMIN
from src.auth.models import User, UserRole
from src.auth.service import is_admin as is_global_admin
from src.campaigns.constants import (
    DEFAULT_CAMPAIGN_MAIN_CANVAS_LAYOUT,
)
from src.campaigns.models import (
    Campaign,
    CampaignSettings,
    CampaignUser,
    CanvasLayout,
    TaskSet,
)
from src.campaigns.policy import PolicyContext
from src.campaigns.schemas import (
    CampaignSettingsCreate,
    LabellingPolicy,
    PolicyAudience,
    default_labelling_policy,
)
from src.campaigns.task_sets import DEFAULT_TASK_SET_NAME
from src.database import SessionLocal
from src.imagery.models import ImageryCollection, ImagerySlice, ImagerySource, ImageryView
from src.imagery.service import create_imagery_from_editor_state, re_register_stac_collections
from src.timeseries.models import TimeSeries
from src.timeseries.service import _add_timeseries_entry_to_layout

logger = logging.getLogger(__name__)


# ============================================================================
# Campaign Management
# ============================================================================


def list_campaigns(db: Session) -> list[Campaign]:
    """Retrieve all campaigns ordered by creation date (newest first)."""
    stmt = select(Campaign).order_by(Campaign.created_at.desc())
    return db.scalars(stmt).all()


def is_authoritative_reviewer(db: Session, campaign_id: int, user_id: UUID) -> bool:
    """True if the user has the explicit authoritative-reviewer flag on this
    campaign."""
    cu = db.execute(
        select(CampaignUser).where(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user_id,
        )
    ).scalar_one_or_none()
    return cu is not None and cu.is_authorative_reviewer


# ============================================================================
# Labelling Policy Evaluation
# ============================================================================


def get_labelling_policy(campaign: Campaign) -> LabellingPolicy:
    """Read a campaign's labelling policy, falling back to the default for
    legacy campaigns whose settings predate the labelling-policy column."""
    if campaign.settings and campaign.settings.labelling_policy:
        return LabellingPolicy.model_validate(campaign.settings.labelling_policy)
    return default_labelling_policy()


def _reject_anyone_kind_if_private(policy: LabellingPolicy, is_public: bool) -> None:
    """'anyone' only makes sense once the campaign itself is public - enforce
    this invariant at every write of a labelling policy (campaign creation
    and the PATCH .../labelling-policy endpoint), not just one of them."""
    axes = (
        policy.explore,
        policy.unassigned_tasks,
        policy.assigned_tasks,
        policy.complete_assigned,
    )
    if any("anyone" in axis.kinds for axis in axes) and not is_public:
        raise HTTPException(
            status_code=400,
            detail="The 'anyone' audience is only allowed for public campaigns",
        )


def _strip_anyone_kind(policy: LabellingPolicy) -> LabellingPolicy:
    """Drop 'anyone' from every axis of `policy`. Used when a campaign flips
    private, so a stored policy never keeps granting anonymous/any-visitor
    access after the invariant enforced on write (`_reject_anyone_kind_if_private`)
    stops applying to it."""
    return LabellingPolicy(
        explore=PolicyAudience(
            kinds=[k for k in policy.explore.kinds if k != "anyone"],
            user_ids=policy.explore.user_ids,
        ),
        unassigned_tasks=PolicyAudience(
            kinds=[k for k in policy.unassigned_tasks.kinds if k != "anyone"],
            user_ids=policy.unassigned_tasks.user_ids,
        ),
        assigned_tasks=PolicyAudience(
            kinds=[k for k in policy.assigned_tasks.kinds if k != "anyone"],
            user_ids=policy.assigned_tasks.user_ids,
        ),
        complete_assigned=policy.complete_assigned,
    )


def build_policy_context(
    db: Session,
    campaign: Campaign,
    user_id: UUID,
    task: AnnotationTask | None = None,
) -> PolicyContext:
    """Build a PolicyContext for one user's request against one campaign.

    Used for real-time enforcement (a single annotate/create/update call), so
    it does its own lookups rather than taking pre-fetched maps - contrast
    with `get_campaign_role_map` / `context_from_role_map`, which amortize the
    same lookups across many annotations (task lists, exports).

    `task.assignments` must already be loaded (joinedload/selectinload) when
    `task` is given; `is_assigned` is true if the user holds ANY assignment on
    it (primary or review), per the labelling-policy spec.
    """
    cu = db.scalars(
        select(CampaignUser).where(
            CampaignUser.campaign_id == campaign.id,
            CampaignUser.user_id == user_id,
        )
    ).first()
    is_assigned = task is not None and any(
        assignment.user_id == user_id for assignment in (task.assignments or [])
    )
    return PolicyContext(
        user_id=user_id,
        is_admin=(cu is not None and cu.is_admin) or is_global_admin(db, user_id),
        is_authoritative=cu is not None and cu.is_authorative_reviewer,
        is_member=cu is not None,
        is_assigned=is_assigned,
    )


def get_campaign_role_map(db: Session, campaign_id: int) -> dict[UUID, tuple[bool, bool]]:
    """One query giving every campaign member's (is_admin, is_authoritative)
    flags, keyed by user id. Membership itself is `user_id in role_map`.

    Meant to be fetched once per request and reused across many
    `context_from_role_map` calls (see campaigns.policy) instead of a
    per-annotation CampaignUser lookup.
    """
    rows = db.execute(
        select(
            CampaignUser.user_id, CampaignUser.is_admin, CampaignUser.is_authorative_reviewer
        ).where(CampaignUser.campaign_id == campaign_id)
    ).all()
    return {user_id: (is_admin, is_authoritative) for user_id, is_admin, is_authoritative in rows}


def get_platform_admin_ids(db: Session, user_ids: Iterable[UUID]) -> set[UUID]:
    """Subset of `user_ids` holding the global admin role, in one query."""
    candidates = {uid for uid in user_ids if uid is not None}
    if not candidates:
        return set()
    return set(
        db.scalars(
            select(UserRole.user_id).where(
                UserRole.role == ROLE_ADMIN, UserRole.user_id.in_(candidates)
            )
        ).all()
    )


def list_campaigns_with_user_roles(db: Session, user_id: UUID) -> list[dict]:
    """
    Retrieve campaigns visible to the user, with role information.

    Visibility rules:
    - Platform admins see ALL campaigns.
    - Regular users see public campaigns + campaigns they are a member/admin of.

    Returns list of dicts containing campaign data plus is_admin/is_member flags.
    """
    stmt = select(Campaign).options(joinedload(Campaign.users)).order_by(Campaign.created_at.desc())
    campaigns = db.scalars(stmt).unique().all()

    # Check if user is a global platform admin
    user_is_global_admin = is_global_admin(db, user_id)

    if user_is_global_admin:
        # If user is global admin, they are admin of all campaigns
        results = []
        for campaign in campaigns:
            results.append(
                {
                    "campaign": campaign,
                    "is_admin": True,
                    "is_member": True,
                }
            )
        return results

    results = []
    for campaign in campaigns:
        is_admin = False
        is_member = False

        for campaign_user in campaign.users:
            if campaign_user.user_id == user_id:
                is_member = True
                if campaign_user.is_admin:
                    is_admin = True
                break

        # Only include public campaigns or campaigns the user is a member of
        if not campaign.is_public and not is_member:
            continue

        results.append(
            {
                "campaign": campaign,
                "is_admin": is_admin,
                "is_member": is_member,
            }
        )

    return results


# Eager-load options covering every relationship that CampaignOut(+Full) serializes.
# Without these, Pydantic serialization lazy-loads each relationship one row at a
# time - on large campaigns (thousands of slices/tile_urls) that turns a single
# response into thousands of cross-region round-trips.
_CAMPAIGN_FULL_LOAD_OPTIONS = (
    joinedload(Campaign.settings),
    selectinload(Campaign.canvas_layouts),
    selectinload(Campaign.time_series),
    selectinload(Campaign.basemaps),
    selectinload(Campaign.custom_maps),
    selectinload(Campaign.imagery_sources).options(
        selectinload(ImagerySource.visualizations),
        selectinload(ImagerySource.collections).options(
            selectinload(ImageryCollection.slices).selectinload(ImagerySlice.tile_urls),
            joinedload(ImageryCollection.stac_config),
        ),
    ),
    selectinload(Campaign.imagery_views).selectinload(ImageryView.canvas_layouts),
)


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


def get_campaign_with_layouts(db: Session, campaign_id: int) -> Campaign:
    """Alias for get_campaign_full - used by the /detailed endpoint."""
    return get_campaign_full(db, campaign_id)


def create_campaign(
    db: Session,
    *,
    name: str,
    mode: str,
    is_public: bool = False,
    settings: CampaignSettingsCreate,
    user_id: UUID,
    imagery_editor_state=None,
    timeseries_configs: list | None = None,
    labelling_policy: LabellingPolicy | None = None,
) -> Campaign:
    """
    Create a new campaign with default layout, settings, admin user, and optionally imagery/timeseries.

    Args:
        db: Database session
        name: Campaign name
        mode: Campaign mode ('tasks' or 'open')
        settings: Campaign configuration settings
        user_id: ID of user to set as admin
        imagery_editor_state: Optional imagery editor state to persist
        timeseries_configs: Optional list of timeseries configurations to create
        labelling_policy: Who may label what; defaults to default_labelling_policy()
            when omitted (matches current unified behavior)

    Returns:
        Created campaign with all relationships loaded
    """
    resolved_policy = labelling_policy or default_labelling_policy(is_public=is_public)
    _reject_anyone_kind_if_private(resolved_policy, is_public)

    # Create campaign first
    campaign = Campaign(name=name, mode=mode, is_public=is_public)
    db.add(campaign)
    db.flush()  # Get campaign.id

    db.add(TaskSet(campaign_id=campaign.id, name=DEFAULT_TASK_SET_NAME))

    # Create default main canvas layout for the campaign
    default_layout = CanvasLayout(
        layout_data=DEFAULT_CAMPAIGN_MAIN_CANVAS_LAYOUT,
        user_id=None,
        campaign_id=campaign.id,
        view_id=None,
        is_default=True,
    )
    db.add(default_layout)

    # Create campaign settings
    campaign_settings = CampaignSettings(
        campaign_id=campaign.id,
        guide_markdown="# Campaign Guide\n\nWelcome! This guide helps annotators understand the campaign goals and labeling conventions.\n",
        labelling_policy=resolved_policy.model_dump(mode="json"),
        **settings.to_orm(),
    )
    db.add(campaign_settings)

    # Add user as admin. The campaign creator is also seeded as an
    # authoritative reviewer so they can resolve tasks out of the box.
    campaign_user = CampaignUser(
        user_id=user_id,
        campaign_id=campaign.id,
        is_admin=True,
        is_authorative_reviewer=True,
    )
    db.add(campaign_user)

    # Flush to get relationships loaded
    db.flush()
    db.refresh(campaign)

    # Create timeseries if provided
    if timeseries_configs:
        for ts_create in timeseries_configs:
            ts_item = TimeSeries(
                campaign_id=campaign.id,
                name=ts_create.name,
                start_ym=ts_create.start_ym,
                end_ym=ts_create.end_ym,
                data_source=ts_create.data_source,
                provider=ts_create.provider,
                ts_type=ts_create.ts_type,
            )
            db.add(ts_item)

        # Add timeseries entry to the default layout
        added = _add_timeseries_entry_to_layout(
            layout_data=default_layout.layout_data,
            window_width=10,
            window_height=8,
        )
        if added:
            flag_modified(default_layout, "layout_data")
            db.flush()
            db.refresh(campaign)

    # Create imagery structure (sources, collections, slices, views - no STAC calls yet)
    pending_registrations: list = []
    registration_bbox: list[float] = []
    if imagery_editor_state:
        imagery_result = create_imagery_from_editor_state(
            db,
            campaign=campaign,
            editor_state=imagery_editor_state,
            user=db.get(User, user_id),
        )
        pending_registrations = imagery_result.get("pending_registrations", [])
        registration_bbox = imagery_result.get("bbox", [])

    # Set initial statuses based on what background work is needed
    embedding_year = campaign.settings.embedding_year
    campaign.registration_status = "registering" if pending_registrations else "ready"
    campaign.embedding_status = "registering" if embedding_year is not None else "ready"

    db.commit()
    db.refresh(campaign)

    campaign_id = campaign.id

    # Background thread: mosaic registration
    if pending_registrations:
        from src.imagery.service import _register_all_stac_browser_collections

        def _background_register_mosaics():
            bg_db = SessionLocal()
            try:
                logger.info("Background mosaic registration started for campaign %d", campaign_id)
                errors = _register_all_stac_browser_collections(
                    bg_db, pending_registrations, registration_bbox, campaign_id
                )
                bg_campaign = bg_db.execute(
                    select(Campaign).where(Campaign.id == campaign_id)
                ).scalar_one_or_none()
                if bg_campaign:
                    bg_campaign.registration_status = "failed" if errors else "ready"
                    if errors:
                        # Merge with any existing errors (embeddings may have written some)
                        existing = bg_campaign.registration_errors or []
                        bg_campaign.registration_errors = existing + errors
                    bg_db.commit()
                if errors:
                    logger.warning(
                        "Mosaic registration for campaign %d: %d errors", campaign_id, len(errors)
                    )
                else:
                    logger.info("Mosaic registration completed for campaign %d", campaign_id)
            except Exception as exc:
                logger.exception("Mosaic registration failed for campaign %d", campaign_id)
                try:
                    bg_campaign = bg_db.execute(
                        select(Campaign).where(Campaign.id == campaign_id)
                    ).scalar_one_or_none()
                    if bg_campaign:
                        bg_campaign.registration_status = "failed"
                        existing = bg_campaign.registration_errors or []
                        bg_campaign.registration_errors = existing + [{"error": str(exc)}]
                        bg_db.commit()
                except Exception:
                    logger.warning("Failed to persist registration error status", exc_info=True)
            finally:
                bg_db.close()

        threading.Thread(target=_background_register_mosaics, daemon=True).start()

    # Background thread: embeddings
    if embedding_year is not None:

        def _background_register_embeddings():
            bg_db = SessionLocal()
            try:
                logger.info(
                    "Background embeddings started for campaign %d (year %d)",
                    campaign_id,
                    embedding_year,
                )
                start_date = datetime(embedding_year, 1, 1)
                end_date = datetime(embedding_year, 12, 31)
                embeddings_service.populate_campaign_embeddings(
                    bg_db, campaign_id, start_date, end_date
                )
                bg_campaign = bg_db.execute(
                    select(Campaign).where(Campaign.id == campaign_id)
                ).scalar_one_or_none()
                if bg_campaign:
                    bg_campaign.embedding_status = "ready"
                    bg_db.commit()
                logger.info("Embeddings completed for campaign %d", campaign_id)
            except Exception as exc:
                logger.exception("Embeddings failed for campaign %d", campaign_id)
                try:
                    bg_campaign = bg_db.execute(
                        select(Campaign).where(Campaign.id == campaign_id)
                    ).scalar_one_or_none()
                    if bg_campaign:
                        bg_campaign.embedding_status = "failed"
                        existing = bg_campaign.registration_errors or []
                        bg_campaign.registration_errors = existing + [
                            {"error": f"Embeddings: {exc}"}
                        ]
                        bg_db.commit()
                except Exception:
                    logger.warning("Failed to persist embedding error status", exc_info=True)
            finally:
                bg_db.close()

        threading.Thread(target=_background_register_embeddings, daemon=True).start()

    return get_campaign_full(db, campaign.id)


def add_users_to_campaign_bulk(
    db: Session,
    campaign_id: int,
    user_ids: list[UUID],
) -> None:
    """
    Add multiple users to a campaign by email addresses.
    All users are added with MEMBER role.
    """
    stmt = select(User).where(User.id.in_(user_ids))
    users = db.scalars(stmt).all()

    found_user_ids = {user.id for user in users}
    missing_user_ids = set(user_ids) - found_user_ids
    if missing_user_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Users not found with IDs: {', '.join(str(uid) for uid in missing_user_ids)}",
        )

    campaign_users = [
        CampaignUser(
            user_id=user.id,
            campaign_id=campaign_id,
            is_admin=False,
            is_authorative_reviewer=False,
        )
        for user in users
    ]

    db.add_all(campaign_users)
    db.commit()


def make_admin(db: Session, campaign_id: int, user_id: UUID) -> None:
    """
    Promote a campaign user to admin role.
    """
    result = db.execute(
        update(CampaignUser)
        .where(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user_id,
        )
        .values(is_admin=True)
    )

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="User is not assigned to this campaign")

    db.commit()


def make_authorative_reviewer(db: Session, campaign_id: int, user_id: UUID) -> None:
    """
    Make a campaign user an authorative reviewer.
    """
    result = db.execute(
        update(CampaignUser)
        .where(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user_id,
        )
        .values(is_authorative_reviewer=True)
    )

    if result.rowcount == 0:
        raise HTTPException(
            status_code=404,
            detail="User is not assigned to the campaign",
        )

    db.commit()


def update_campaign_name(db: Session, campaign_id: int, new_name: str) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    campaign.name = new_name
    db.commit()
    return get_campaign_full(db, campaign_id)


def update_campaign_visibility(db: Session, campaign_id: int, is_public: bool) -> Campaign:
    """Toggle a campaign between public and private.

    Flipping to private strips 'anyone' from every axis of the stored
    labelling policy: 'anyone' is only a valid audience on a public campaign
    (enforced on write by `_reject_anyone_kind_if_private`), so a policy that
    was written while public must not keep granting anonymous/any-visitor
    access once the campaign goes private.
    """
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    campaign.is_public = is_public
    if not is_public and campaign.settings and campaign.settings.labelling_policy:
        current_policy = LabellingPolicy.model_validate(campaign.settings.labelling_policy)
        campaign.settings.labelling_policy = _strip_anyone_kind(current_policy).model_dump(
            mode="json"
        )
        flag_modified(campaign.settings, "labelling_policy")
    db.commit()
    return get_campaign_full(db, campaign_id)


def update_campaign_guide(db: Session, campaign_id: int, guide_markdown: str | None) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if not campaign.settings:
        raise HTTPException(status_code=404, detail="Campaign settings not found")
    campaign.settings.guide_markdown = guide_markdown
    db.commit()
    return get_campaign_full(db, campaign_id)


def update_campaign_labels(db: Session, campaign_id: int, labels: list) -> Campaign:
    """Replace the campaign's labels JSONB. Caller is expected to keep existing
    label IDs stable so annotations referencing them continue to resolve;
    rename = same id + new name, add = new id. Delete is not supported here."""
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if not campaign.settings:
        raise HTTPException(status_code=404, detail="Campaign settings not found")

    existing_ids = set((campaign.settings.labels or {}).keys())
    incoming_ids = {str(label.id) for label in labels}
    removed = existing_ids - incoming_ids
    if removed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Removing labels is not supported (would orphan annotations). "
                f"Missing label id(s): {sorted(removed)}"
            ),
        )

    existing_labels = campaign.settings.labels or {}
    for label in labels:
        label_key = str(label.id)
        if label_key not in existing_labels:
            continue
        existing_entry = existing_labels[label_key]
        existing_geom_type = (
            existing_entry.get("geometry_type") if isinstance(existing_entry, dict) else None
        )
        new_geom_type = label.geometry_type
        if (
            existing_geom_type is not None
            and new_geom_type is not None
            and existing_geom_type != new_geom_type
        ):
            annotation_count = db.scalar(
                select(func.count())
                .select_from(Annotation)
                .where(
                    Annotation.campaign_id == campaign_id,
                    Annotation.label_id == label.id,
                )
            )
            if annotation_count:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Cannot change geometry_type for label {label.id} from "
                        f"'{existing_geom_type}' to '{new_geom_type}': "
                        f"annotations using this label already exist"
                    ),
                )

    labels_dict: dict = {}
    for label in labels:
        entry: dict = {"name": label.name}
        if label.geometry_type is not None:
            entry["geometry_type"] = label.geometry_type
        labels_dict[str(label.id)] = entry
    campaign.settings.labels = labels_dict

    # JSONB column needs an explicit flag so SQLAlchemy emits an UPDATE for
    # in-place dict mutations (assignment above already creates a new dict,
    # but flag_modified is defensive against future refactors).
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(campaign.settings, "labels")
    db.commit()
    return get_campaign_full(db, campaign_id)


def update_campaign_form_fields(db: Session, campaign_id: int, form_fields: list) -> Campaign:
    """Replace the campaign's custom form fields. Field IDs are the stability
    anchor: stored annotation answers key off them, so edit = same id, add =
    new id. Removals are rejected outright, and shape changes (type,
    number_type, removed category options) are rejected once a field has
    stored answers - they would make those answers unresolvable."""
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if not campaign.settings:
        raise HTTPException(status_code=404, detail="Campaign settings not found")

    existing = {str(f.get("id")): f for f in (campaign.settings.form_fields or [])}
    incoming_ids = {str(field.id) for field in form_fields}
    removed = set(existing) - incoming_ids
    if removed:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Removing form fields is not supported (would orphan stored answers). "
                f"Missing field id(s): {sorted(removed)}"
            ),
        )

    for field in form_fields:
        old = existing.get(str(field.id))
        if not old:
            continue
        shape_changed = old.get("type") != field.type or old.get("number_type") != getattr(
            field, "number_type", None
        )
        old_option_ids = {option["id"] for option in old.get("options") or []}
        new_option_ids = {option.id for option in getattr(field, "options", [])}
        removed_options = old_option_ids - new_option_ids
        if not shape_changed and not removed_options:
            continue
        answer_count = db.scalar(
            select(func.count())
            .select_from(Annotation)
            .where(
                Annotation.campaign_id == campaign_id,
                Annotation.form_values.has_key(str(field.id)),
            )
        )
        if answer_count:
            what = "type" if shape_changed else "options"
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Cannot change the {what} of form field {field.id} "
                    f"('{field.title}'): annotations already answered it"
                ),
            )

    campaign.settings.form_fields = [field.model_dump() for field in form_fields]
    flag_modified(campaign.settings, "form_fields")
    db.commit()
    return get_campaign_full(db, campaign_id)


def update_campaign_bbox(
    db: Session,
    campaign_id: int,
    bbox_west: float,
    bbox_south: float,
    bbox_east: float,
    bbox_north: float,
) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if not campaign.settings:
        raise HTTPException(status_code=404, detail="Campaign settings not found")
    campaign.settings.bbox_west = bbox_west
    campaign.settings.bbox_south = bbox_south
    campaign.settings.bbox_east = bbox_east
    campaign.settings.bbox_north = bbox_north

    db.commit()

    new_bbox = [bbox_west, bbox_south, bbox_east, bbox_north]

    def _bg_reregister():
        bg_db = SessionLocal()
        try:
            count = re_register_stac_collections(bg_db, campaign_id, new_bbox)
            if count:
                logger.info(
                    "Re-registered STAC mosaics for %d collection(s) in campaign %d",
                    count,
                    campaign_id,
                )
        except Exception:
            logger.warning(
                "STAC re-registration failed for campaign %d",
                campaign_id,
                exc_info=True,
            )
        finally:
            bg_db.close()

    threading.Thread(target=_bg_reregister, daemon=True).start()

    return get_campaign_full(db, campaign_id)


def update_sample_extent(
    db: Session, campaign_id: int, sample_extent_meters: float | None
) -> Campaign:
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if not campaign.settings:
        raise HTTPException(status_code=404, detail="Campaign settings not found")
    campaign.settings.sample_extent_meters = sample_extent_meters
    db.commit()
    return get_campaign_full(db, campaign_id)


def update_labelling_policy(
    db: Session, campaign_id: int, policy: LabellingPolicy
) -> LabellingPolicy:
    """Persist a new labelling policy. 'anyone' kinds are rejected for
    non-public campaigns: an audience that lets any authenticated visitor
    label only makes sense once the campaign itself is public."""
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if not campaign.settings:
        raise HTTPException(status_code=404, detail="Campaign settings not found")

    _reject_anyone_kind_if_private(policy, campaign.is_public)

    campaign.settings.labelling_policy = policy.model_dump(mode="json")
    flag_modified(campaign.settings, "labelling_policy")
    db.commit()
    return LabellingPolicy.model_validate(campaign.settings.labelling_policy)


def update_embedding_year(
    db: Session,
    campaign_id: int,
    embedding_year: int | None,
) -> dict:
    """Set the embedding year on campaign settings and recompute embeddings if changed.

    If *embedding_year* is ``None`` the column is cleared (embeddings disabled).
    If it changes from the current value, all existing embeddings for the
    campaign are deleted and re-fetched for the new year.
    """
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if not campaign.settings:
        raise HTTPException(status_code=404, detail="Campaign settings not found")

    old_year = campaign.settings.embedding_year
    campaign.settings.embedding_year = embedding_year
    db.flush()

    recomputed = False

    if embedding_year is not None and embedding_year != old_year:
        task_ids_subq = (
            select(AnnotationTask.id)
            .where(AnnotationTask.campaign_id == campaign_id)
            .scalar_subquery()
        )
        db.execute(delete(Embedding).where(Embedding.annotation_task_id.in_(task_ids_subq)))
        recomputed = True

    db.commit()
    db.refresh(campaign)

    if recomputed and embedding_year is not None:
        start_date = datetime(embedding_year, 1, 1)
        end_date = datetime(embedding_year, 12, 31)

        def _bg_embeddings():
            bg_db = SessionLocal()
            try:
                embeddings_service.populate_campaign_embeddings(
                    bg_db, campaign_id, start_date, end_date
                )
                bg_campaign = bg_db.get(Campaign, campaign_id)
                if bg_campaign:
                    bg_campaign.embedding_status = "ready"
                    bg_db.commit()
                logger.info(
                    "Embeddings completed for campaign %d year %d", campaign_id, embedding_year
                )
            except Exception:
                logger.exception(
                    "Embedding recomputation failed for campaign %d year %d",
                    campaign_id,
                    embedding_year,
                )
            finally:
                bg_db.close()

        threading.Thread(target=_bg_embeddings, daemon=True).start()

    return {
        "embedding_year": campaign.settings.embedding_year,
        "embeddings_recomputed": recomputed,
    }


def _assert_not_last_admin(db: Session, campaign_id: int, user_id: UUID) -> None:
    """Raise HTTP 409 if the given user is the sole admin of the campaign."""
    is_admin = db.scalar(
        select(CampaignUser.is_admin).where(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user_id,
        )
    )
    if not is_admin:
        return
    admin_count = db.scalar(
        select(func.count())
        .select_from(CampaignUser)
        .where(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.is_admin.is_(True),
        )
    )
    if admin_count <= 1:
        raise HTTPException(
            status_code=409,
            detail="Cannot remove the last campaign admin",
        )


def remove_user_from_campaign(db: Session, campaign_id: int, user_id: UUID) -> None:
    """
    Remove a user from a campaign.

    This only deletes the user's membership record (CampaignUser).
    All annotations created by the user remain in the campaign, as the
    Annotation model uses RESTRICT on user deletion.
    """
    _assert_not_last_admin(db, campaign_id, user_id)
    result = db.execute(
        delete(CampaignUser).where(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user_id,
        )
    )

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="User is not assigned to this campaign")

    db.commit()


def demote_admin(db: Session, campaign_id: int, user_id: UUID) -> None:
    """
    Demote a campaign admin to member role.
    """
    _assert_not_last_admin(db, campaign_id, user_id)
    result = db.execute(
        update(CampaignUser)
        .where(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user_id,
            CampaignUser.is_admin.is_(True),
        )
        .values(is_admin=False)
    )

    if result.rowcount == 0:
        raise HTTPException(
            status_code=404,
            detail="User is not an admin of this campaign or not assigned to the campaign",
        )

    db.commit()


def demote_authorative_reviewer(db: Session, campaign_id: int, user_id: UUID) -> None:
    """
    Demote a campaign authorative reviewer to normal user.
    """
    result = db.execute(
        update(CampaignUser)
        .where(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user_id,
            CampaignUser.is_authorative_reviewer.is_(True),
        )
        .values(is_authorative_reviewer=False)
    )

    if result.rowcount == 0:
        raise HTTPException(
            status_code=404,
            detail="User is not an authorative reviewer of this campaign or not assigned to the campaign",
        )

    db.commit()


def delete_annotation_tasks(db: Session, campaign_id: int, task_ids: list[int]) -> int:
    """
    Delete multiple annotation tasks from a campaign.

    This will also delete any annotations associated with these tasks.

    Args:
        db: Database session
        campaign_id: ID of the campaign
        task_ids: List of task IDs to delete

    Returns:
        Number of tasks deleted

    Raises:
        HTTPException: If tasks don't exist or don't belong to campaign
    """
    if not task_ids:
        return 0

    # Verify all tasks belong to the campaign
    stmt = select(AnnotationTask).where(
        AnnotationTask.id.in_(task_ids), AnnotationTask.campaign_id == campaign_id
    )
    tasks = db.scalars(stmt).all()

    found_task_ids = {task.id for task in tasks}
    missing_task_ids = set(task_ids) - found_task_ids

    if missing_task_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Tasks not found in campaign: {', '.join(str(tid) for tid in missing_task_ids)}",
        )

    # Delete the tasks (annotations will be cascade deleted)
    for task in tasks:
        db.delete(task)

    db.commit()

    return len(tasks)


def delete_campaign(db: Session, campaign_id: int) -> None:
    """
    Delete a campaign and all associated data.

    Cascading deletes will automatically remove:
    - Campaign settings
    - Canvas layouts (both default and personal)
    - Imagery sources, views, and basemaps
    - Timeseries
    - Annotations
    - Annotation task items
    - Campaign user associations

    Args:
        db: Database session
        campaign_id: ID of the campaign to delete
    """
    campaign = db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    db.delete(campaign)
    db.commit()

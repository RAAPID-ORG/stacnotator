"""Labelling-policy decisions: the pure evaluation core plus the DB-backed
context builders that feed it.

Lives outside campaigns/service.py (which imports from src.annotation for
geometry/embedding helpers) so annotation/service.py can depend on this module
without closing an import cycle back through campaigns.service. Must never
import from src.annotation or campaigns.service.
"""

from collections.abc import Iterable, Sequence
from collections.abc import Set as AbstractSet
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.constants import ROLE_ADMIN
from src.auth.models import UserRole
from src.campaigns.models import Campaign
from src.campaigns.schemas import LabellingPolicy, PolicyAudience, default_labelling_policy
from src.organizations.models import MEMBER_STATUS_ACTIVE, OrganizationUser
from src.organizations.service import grants_org_access
from src.projects.access import VISIBILITY_ORGANIZATION
from src.projects.models import ProjectUser


@dataclass(frozen=True)
class PolicyContext:
    user_id: UUID | None
    is_admin: bool
    is_authoritative: bool
    is_member: bool
    is_assigned: bool = False  # any assignment on the task at hand (primary or review)


def is_allowed(audience: PolicyAudience, ctx: PolicyContext) -> bool:
    """Whether ctx's user is a member of the given audience selector."""
    if "anyone" in audience.kinds:
        return True
    if "members" in audience.kinds and ctx.is_member:
        return True
    if "admins" in audience.kinds and ctx.is_admin:
        return True
    if "authoritative" in audience.kinds and ctx.is_authoritative:
        return True
    if "assignees" in audience.kinds and ctx.is_assigned:
        return True
    return ctx.user_id is not None and ctx.user_id in audience.user_ids


def counts_toward_completion(
    policy: LabellingPolicy, task_has_assignments: bool, ctx: PolicyContext
) -> bool:
    """Whether a label from ctx's user on a task counts toward completing it.

    An assigned task counts against complete_assigned (which also satisfies
    review requirements, per the spec); an unassigned task counts against
    unassigned_tasks. Standalone (non-task) annotations have no completion
    semantics and must not call this.
    """
    axis = policy.complete_assigned if task_has_assignments else policy.unassigned_tasks
    return is_allowed(axis, ctx)


def context_from_role_map(
    user_id: UUID,
    role_map: dict[UUID, tuple[bool, bool]],
    platform_admin_ids: set[UUID],
    is_assigned: bool = False,
    org_member_ids: AbstractSet[UUID] = frozenset(),
) -> PolicyContext:
    """Build a PolicyContext from pre-fetched, campaign-wide lookups.

    `role_map` is `{user_id: (is_admin, is_authoritative)}` for every project
    membership backing one campaign; `platform_admin_ids` is the subset of a
    candidate user set holding the global admin role. Both are fetched once
    per request (see get_campaign_role_map / get_platform_admin_ids below) so
    evaluating many annotations' authors - e.g. a whole task list or export -
    costs two queries total instead of one per annotation.

    A platform admin counts as a member of every campaign, membership row or
    not, so a members-only axis grants them the same access the campaign's
    `viewer_is_member` flag advertises. `org_member_ids` extends the same
    member standing (no roles) to active org members when the owning project
    is org-public - pass `get_org_public_member_ids` for it, or leave the
    empty default for private/platform-public projects.
    """
    is_admin, is_authoritative = role_map.get(user_id, (False, False))
    is_platform = user_id in platform_admin_ids
    return PolicyContext(
        user_id=user_id,
        is_admin=is_admin or is_platform,
        is_authoritative=is_authoritative,
        is_member=user_id in role_map or is_platform or user_id in org_member_ids,
        is_assigned=is_assigned,
    )


def get_org_public_member_ids(db: Session, campaign: Campaign) -> set[UUID]:
    """Active members of the owning organization, when (and only when) the
    campaign's project is org-public - the amortized counterpart of
    `grants_org_access` for `context_from_role_map`. Empty set otherwise."""
    if campaign.project.visibility != VISIBILITY_ORGANIZATION:
        return set()
    return set(
        db.scalars(
            select(OrganizationUser.user_id).where(
                OrganizationUser.organization_id == campaign.project.organization_id,
                OrganizationUser.status == MEMBER_STATUS_ACTIVE,
            )
        ).all()
    )


class _AssignmentLike(Protocol):
    @property
    def user_id(self) -> UUID: ...


class _TaskLike(Protocol):
    """Structural stand-in for annotation.models.AnnotationTask - this module
    must not import from src.annotation (see module docstring / cycle note).
    Read-only properties (not plain attributes) so mypy matches this
    covariantly against the real ORM model's Mapped columns/relationships."""

    @property
    def assignments(self) -> Sequence[_AssignmentLike]: ...


def is_platform_admin(db: Session, user_id: UUID) -> bool:
    """Whether user_id holds the platform-wide admin role.

    The single canonical check for "is this a platform admin" - same
    `auth.user_roles` row auth.service.is_admin queries, just homed here so
    both campaigns and annotation call sites share one implementation instead
    of the same query re-encoded under different names.
    """
    return (
        db.execute(
            select(UserRole).where(UserRole.user_id == user_id, UserRole.role == ROLE_ADMIN)
        ).first()
        is not None
    )


def is_authoritative_reviewer(db: Session, campaign_id: int, user_id: UUID) -> bool:
    """True if the user holds the authoritative-reviewer flag on the
    campaign's project."""
    pu = db.execute(
        select(ProjectUser)
        .join(Campaign, Campaign.project_id == ProjectUser.project_id)
        .where(Campaign.id == campaign_id, ProjectUser.user_id == user_id)
    ).scalar_one_or_none()
    return pu is not None and pu.is_authoritative_reviewer


def get_labelling_policy(campaign: Campaign) -> LabellingPolicy:
    """Read a campaign's labelling policy, falling back to the default when
    the settings carry no labelling policy."""
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


_STRIPPABLE_AXES = ("explore", "unassigned_tasks", "assigned_tasks")


def strip_anyone_kind(policy: LabellingPolicy) -> LabellingPolicy:
    """Drop 'anyone' from every axis of `policy`. Used when a campaign flips
    private, so a stored policy never keeps granting anonymous/any-visitor
    access after the invariant enforced on write (`_reject_anyone_kind_if_private`)
    stops applying to it."""
    updates = {
        axis: getattr(policy, axis).model_copy(
            update={"kinds": [k for k in getattr(policy, axis).kinds if k != "anyone"]}
        )
        for axis in _STRIPPABLE_AXES
    }
    return policy.model_copy(update=updates)


def build_policy_context(
    db: Session,
    campaign: Campaign,
    user_id: UUID,
    task: _TaskLike | None = None,
) -> PolicyContext:
    """Build a PolicyContext for one user's request against one campaign.

    Used for real-time enforcement (a single annotate/create/update call), so
    it does its own lookups rather than taking pre-fetched maps - contrast
    with `get_campaign_role_map` / `context_from_role_map`, which amortize the
    same lookups across many annotations (task lists, exports).

    `task.assignments` must already be loaded (joinedload/selectinload) when
    `task` is given; `is_assigned` is true if the user holds ANY assignment on
    it (primary or review), per the labelling-policy spec.

    A platform admin counts as a member of every campaign, membership row or
    not, so a members-only axis grants them the same access the campaign's
    `viewer_is_member` flag advertises. Active members of the owning org get
    the same member standing (no roles) when the project is org-public.
    """
    pu = db.scalars(
        select(ProjectUser).where(
            ProjectUser.project_id == campaign.project_id,
            ProjectUser.user_id == user_id,
        )
    ).first()
    is_platform = is_platform_admin(db, user_id)
    is_assigned = task is not None and any(
        assignment.user_id == user_id for assignment in (task.assignments or [])
    )
    is_member = pu is not None or is_platform or grants_org_access(db, user_id, campaign.project)
    return PolicyContext(
        user_id=user_id,
        is_admin=(pu is not None and pu.is_admin) or is_platform,
        is_authoritative=pu is not None and pu.is_authoritative_reviewer,
        is_member=is_member,
        is_assigned=is_assigned,
    )


def get_campaign_role_map(db: Session, campaign_id: int) -> dict[UUID, tuple[bool, bool]]:
    """One query giving every campaign member's (is_admin, is_authoritative)
    flags, keyed by user id - roles come from the owning project. Membership
    itself is `user_id in role_map`.

    Meant to be fetched once per request and reused across many
    `context_from_role_map` calls instead of a per-annotation ProjectUser
    lookup.
    """
    rows = db.execute(
        select(ProjectUser.user_id, ProjectUser.is_admin, ProjectUser.is_authoritative_reviewer)
        .join(Campaign, Campaign.project_id == ProjectUser.project_id)
        .where(Campaign.id == campaign_id)
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

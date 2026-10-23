"""Labelling-policy decisions: the pure evaluation core plus the DB-backed
context builders that feed it.

Lives outside campaigns/service.py (which imports from src.annotation for
geometry/embedding helpers) so annotation/service.py can depend on this module
without closing an import cycle back through campaigns.service. Must never
import from src.annotation or campaigns.service.
"""

from collections.abc import Iterable, Mapping, Sequence
from collections.abc import Set as AbstractSet
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.models import User
from src.campaigns.models import Campaign
from src.campaigns.schemas import LabellingPolicy, PolicyAudience
from src.organizations.models import (
    MEMBER_STATUS_ACTIVE,
    ORG_STATUS_APPROVED,
    Organization,
    OrganizationUser,
)
from src.projects.access import VISIBILITY_ORGANIZATION, resolve_project_flags
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


@dataclass(frozen=True)
class CampaignStanding:
    """What the policy needs to know about people in one campaign: their project
    roles, who of them is a platform admin, and who is an active member of the
    owning organization. Resolved through the one access rule in
    projects/access.py, so a policy context and the viewer flags the campaign
    endpoints report cannot disagree."""

    visibility: str
    # Project membership rows: user id -> (is_admin, is_authoritative_reviewer).
    roles: Mapping[UUID, tuple[bool, bool]]
    platform_admins: AbstractSet[UUID] = frozenset()
    org_members: AbstractSet[UUID] = frozenset()

    def context(self, user_id: UUID, *, is_assigned: bool = False) -> PolicyContext:
        is_admin, is_authoritative = self.roles.get(user_id, (False, False))
        flags = resolve_project_flags(
            visibility=self.visibility,
            is_active_org_member=user_id in self.org_members,
            is_member=user_id in self.roles,
            member_is_admin=is_admin,
            member_is_authoritative_reviewer=is_authoritative,
            is_platform_admin=user_id in self.platform_admins,
        )
        return PolicyContext(
            user_id=user_id,
            is_admin=flags.is_admin,
            is_authoritative=flags.is_authoritative_reviewer,
            is_member=flags.is_policy_member,
            is_assigned=is_assigned,
        )


def load_standing(db: Session, campaign: Campaign, user_ids: Iterable[UUID]) -> CampaignStanding:
    """The standing of ``user_ids`` in the campaign, in at most three queries however
    many users are asked about."""
    ids = {uid for uid in user_ids if uid is not None}
    project = campaign.project
    if not ids:
        return CampaignStanding(visibility=project.visibility, roles={})
    rows = db.execute(
        select(
            ProjectUser.user_id, ProjectUser.is_admin, ProjectUser.is_authoritative_reviewer
        ).where(ProjectUser.project_id == project.id, ProjectUser.user_id.in_(ids))
    ).all()
    platform_admins = set(
        db.scalars(select(User.id).where(User.is_platform_admin, User.id.in_(ids))).all()
    )
    org_members: set[UUID] = set()
    if project.visibility == VISIBILITY_ORGANIZATION:
        org_members = set(
            db.scalars(
                select(OrganizationUser.user_id)
                .join(Organization, Organization.id == OrganizationUser.organization_id)
                .where(
                    OrganizationUser.organization_id == project.organization_id,
                    OrganizationUser.user_id.in_(ids),
                    OrganizationUser.status == MEMBER_STATUS_ACTIVE,
                    Organization.status == ORG_STATUS_APPROVED,
                )
            ).all()
        )
    return CampaignStanding(
        visibility=project.visibility,
        roles={uid: (is_admin, is_auth) for uid, is_admin, is_auth in rows},
        platform_admins=platform_admins,
        org_members=org_members,
    )


class _AssignmentLike(Protocol):
    @property
    def user_id(self) -> UUID: ...


class _TaskLike(Protocol):
    """Structural stand-in for annotation.models.Task - this module
    must not import from src.annotation (see module docstring / cycle note).
    Read-only properties (not plain attributes) so mypy matches this
    covariantly against the real ORM model's Mapped columns/relationships."""

    @property
    def assignments(self) -> Sequence[_AssignmentLike]: ...


def get_labelling_policy(campaign: Campaign) -> LabellingPolicy:
    """Read a campaign's labelling policy. Every campaign carries one: the
    creation path always writes settings, the column is non-null with a full
    server default, and migration aa6polback backfilled the stragglers."""
    return LabellingPolicy.model_validate(campaign.labelling_policy)


def _reject_anyone_kind_if_private(policy: LabellingPolicy, is_public: bool) -> None:
    """'anyone' only makes sense once the campaign itself is public - enforce
    this invariant at every write of a labelling policy (campaign creation
    and a campaign update), not just one of them."""
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
    """One user's PolicyContext for a request against one campaign. ``task``'s
    assignments must be loaded; holding any of them (primary or review) makes the
    user an assignee, per the labelling-policy spec."""
    is_assigned = task is not None and any(a.user_id == user_id for a in task.assignments)
    return load_standing(db, campaign, [user_id]).context(user_id, is_assigned=is_assigned)

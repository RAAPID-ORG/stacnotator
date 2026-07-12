from dataclasses import dataclass
from uuid import UUID

from src.campaigns.schemas import LabellingPolicy, PolicyAudience


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
) -> PolicyContext:
    """Build a PolicyContext from pre-fetched, campaign-wide lookups.

    `role_map` is `{user_id: (is_admin, is_authoritative)}` for every
    CampaignUser of one campaign; `platform_admin_ids` is the subset of a
    candidate user set holding the global admin role. Both are fetched once
    per request (see campaigns.service.get_campaign_role_map /
    get_platform_admin_ids) so evaluating many annotations' authors - e.g. a
    whole task list or export - costs two queries total instead of one per
    annotation.
    """
    is_admin, is_authoritative = role_map.get(user_id, (False, False))
    return PolicyContext(
        user_id=user_id,
        is_admin=is_admin or user_id in platform_admin_ids,
        is_authoritative=is_authoritative,
        is_member=user_id in role_map,
        is_assigned=is_assigned,
    )

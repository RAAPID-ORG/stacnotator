"""Pure evaluation of a campaign's labelling policy.

Deliberately DB-free: callers build a PolicyContext from whatever they've
already loaded (campaign membership, task assignments) and get a plain bool
back. Nothing here stores per-annotation state - evaluation is always
dynamic, per docs/superpowers/specs/2026-07-12-labelling-policy-design.md.
"""

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

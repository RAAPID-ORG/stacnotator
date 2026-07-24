"""Attach policy-derived `counts_toward_completion` onto loaded annotation rows.

DB-bound but service-independent: shared by the annotation read endpoints
(task lists / single-task fetch) in service.py and by the export path in
export.py, so neither has to depend on the other. Lives outside policy.py
because it touches annotation ORM rows, which policy.py must not import.
"""

from uuid import UUID

from sqlalchemy.orm import Session

from src.annotation.models import Annotation, AnnotationTask
from src.campaigns.models import Campaign
from src.campaigns.policy import (
    context_from_role_map,
    counts_toward_completion,
    get_campaign_role_map,
    get_labelling_policy,
    get_platform_admin_ids,
)
from src.campaigns.schemas import LabellingPolicy


def _counting_context(
    annotation: Annotation,
    policy: LabellingPolicy,
    role_map: dict[UUID, tuple[bool, bool]],
    admin_ids: set[UUID],
    assigned_ids: set[UUID],
) -> bool:
    """Whether one task-linked annotation's label counts toward its task's
    completion, per the campaign's labelling policy."""
    ctx = context_from_role_map(
        annotation.created_by_user_id,
        role_map,
        admin_ids,
        is_assigned=annotation.created_by_user_id in assigned_ids,
    )
    return counts_toward_completion(policy, bool(assigned_ids), ctx)


def attach_counts_toward_completion_tree(
    db: Session, campaign: Campaign, tasks: list[AnnotationTask]
) -> None:
    """Set `counts_toward_completion` on every annotation of every task, via
    one role-map lookup for the whole campaign instead of a per-annotation
    query. Mirrors `_attach_has_embedding`: the flag is set directly on the
    ORM instance so `AnnotationFromTaskOut` (from_attributes) picks it up
    without an extra fetch.
    """
    if not tasks:
        return
    policy = get_labelling_policy(campaign)
    role_map = get_campaign_role_map(db, campaign.id)
    author_ids = {ann.created_by_user_id for task in tasks for ann in (task.annotations or [])}
    admin_ids = get_platform_admin_ids(db, author_ids)

    for task in tasks:
        assigned_ids = {a.user_id for a in (task.assignments or [])}
        for ann in task.annotations or []:
            ann.counts_toward_completion = _counting_context(
                ann, policy, role_map, admin_ids, assigned_ids
            )


def attach_counts_toward_completion_flat(
    db: Session, campaign: Campaign, annotations: list[Annotation]
) -> None:
    """Same as `attach_counts_toward_completion_tree` but for a flat annotation
    list where each task-linked annotation carries its own `.annotation_task`
    (with `.assignments` loaded) rather than the nested task-tree shape.
    Used by the plain annotation list/fetch endpoints and by exports
    (annotation/export.py). Standalone annotations are left untouched, so
    `AnnotationFromTaskOut.counts_toward_completion` reads back as its None
    default - "not applicable", not "doesn't count".
    """
    task_linked = [a for a in annotations if a.annotation_task_id is not None and a.annotation_task]
    if not task_linked:
        return
    policy = get_labelling_policy(campaign)
    role_map = get_campaign_role_map(db, campaign.id)
    admin_ids = get_platform_admin_ids(db, {a.created_by_user_id for a in task_linked})

    for ann in task_linked:
        assigned_ids = {a.user_id for a in (ann.annotation_task.assignments or [])}
        ann.counts_toward_completion = _counting_context(
            ann, policy, role_map, admin_ids, assigned_ids
        )

"""Soft-claim/lease protocol for unassigned annotation tasks.

`claim_task_for_user` and its private helper form one self-contained locking
protocol (row lock + TTL-based lease takeover) and belong together.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.annotation.constants import ANNOTATION_TASK_STATUS_PENDING, CLAIM_TTL_MINUTES
from src.annotation.models import Annotation, AnnotationTask, AnnotationTaskAssignment


def _release_other_soft_claims(
    db: Session, campaign_id: int, user_id: UUID, keep_task_id: int
) -> None:
    """Enforce one active soft claim per user per campaign.

    Drops the caller's other un-worked pending soft claims so that claiming a new task
    moves the claim. Worked tasks (an annotation exists) and explicit admin assignments
    (claimed_at is NULL) are left untouched.
    """
    has_annotation = (
        select(Annotation.id)
        .where(
            Annotation.annotation_task_id == AnnotationTaskAssignment.task_id,
            Annotation.created_by_user_id == user_id,
        )
        .exists()
    )
    others = (
        db.execute(
            select(AnnotationTaskAssignment)
            .join(AnnotationTask, AnnotationTask.id == AnnotationTaskAssignment.task_id)
            .where(
                AnnotationTask.campaign_id == campaign_id,
                AnnotationTaskAssignment.user_id == user_id,
                AnnotationTaskAssignment.task_id != keep_task_id,
                AnnotationTaskAssignment.claimed_at.is_not(None),
                AnnotationTaskAssignment.status == ANNOTATION_TASK_STATUS_PENDING,
                ~has_annotation,
            )
        )
        .scalars()
        .all()
    )
    for assignment in others:
        db.delete(assignment)


def claim_task_for_user(
    db: Session,
    campaign_id: int,
    task_id: int,
    user_id: UUID,
) -> AnnotationTaskAssignment:
    """Atomically soft-claim an unassigned task for a user.

    Idempotent, and guarantees the caller holds exactly one active soft claim in the
    campaign afterwards: any prior soft claim of theirs is released in the same
    transaction. Refreshes the lease if the user already holds this task. Raises 409 if the
    task is already annotated, explicitly assigned, or actively claimed by someone else; a
    stale soft claim by another user is taken over.
    """
    # Row lock serializes concurrent claims on the same task; skip_locked makes a
    # race a clean 409 instead of a block.
    task = db.execute(
        select(AnnotationTask)
        .where(
            AnnotationTask.id == task_id,
            AnnotationTask.campaign_id == campaign_id,
        )
        .with_for_update(skip_locked=True)
    ).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=409, detail="Task is no longer available")

    has_annotation = db.execute(
        select(Annotation.id).where(Annotation.annotation_task_id == task_id).limit(1)
    ).first()
    if has_annotation is not None:
        raise HTTPException(status_code=409, detail="Task has already been annotated")

    assignments = (
        db.execute(
            select(AnnotationTaskAssignment).where(AnnotationTaskAssignment.task_id == task_id)
        )
        .scalars()
        .all()
    )

    mine = next((a for a in assignments if a.user_id == user_id), None)
    if mine is not None:
        mine.claimed_at = func.now()
        result = mine
    else:
        cutoff = datetime.now(UTC) - timedelta(minutes=CLAIM_TTL_MINUTES)
        for assignment in assignments:
            is_stale_claim = (
                assignment.claimed_at is not None
                and assignment.status == ANNOTATION_TASK_STATUS_PENDING
                and assignment.claimed_at <= cutoff
            )
            if not is_stale_claim:
                raise HTTPException(status_code=409, detail="Task is no longer available")
            db.delete(assignment)

        result = AnnotationTaskAssignment(
            task_id=task_id,
            user_id=user_id,
            status=ANNOTATION_TASK_STATUS_PENDING,
            claimed_at=func.now(),
        )
        db.add(result)

    # Move the claim: no separate release call to lose, TTL is the real backstop.
    _release_other_soft_claims(db, campaign_id, user_id, keep_task_id=task_id)
    db.commit()
    db.refresh(result)
    return result

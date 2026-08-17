"""Soft claims: who is working on a task right now.

A claim is a lease, not an assignment. It expires after CLAIM_TTL_MINUTES, it
never decides who may label a task or whose label counts, and it lives on the
task rather than in annotation_tasks_assignment so that nothing reading
assignments can mistake it for admin intent.

Contention is an ordinary outcome, not an error: claiming a task somebody else
holds reports the holder so the caller can show "Alice is working on this" and
decide for itself whether to move on. Labelling it anyway stays allowed.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from src.annotation.constants import CLAIM_TTL_MINUTES
from src.annotation.models import Annotation, AnnotationTask, AnnotationTaskAssignment


@dataclass(frozen=True)
class ClaimOutcome:
    """The result of trying to claim a task: either it is now yours, or it
    tells you who is on it (nobody, for a task that is assigned or already
    worked and therefore has nothing to lease)."""

    claimed: bool
    claimed_at: datetime | None
    holder_user_id: UUID | None = None
    holder_display_name: str | None = None


def live_claim_holder(task: AnnotationTask, now: datetime) -> UUID | None:
    """Who holds an unexpired claim on `task`, if anyone."""
    if task.claimed_by_user_id is None or task.claimed_at is None:
        return None
    if task.claimed_at <= now - timedelta(minutes=CLAIM_TTL_MINUTES):
        return None
    return task.claimed_by_user_id


def release_claims_for_user(
    db: Session, campaign_id: int, user_id: UUID, keep_task_id: int | None = None
) -> None:
    """Drop this user's claims across the campaign, optionally keeping one.

    Called as part of claiming, so the one-claim-per-user rule holds without a
    release call anyone can forget; the partial unique index on
    (campaign_id, claimed_by_user_id) is the backstop if they do.
    """
    stmt = (
        update(AnnotationTask)
        .where(
            AnnotationTask.campaign_id == campaign_id,
            AnnotationTask.claimed_by_user_id == user_id,
        )
        .values(claimed_by_user_id=None, claimed_at=None)
    )
    if keep_task_id is not None:
        stmt = stmt.where(AnnotationTask.id != keep_task_id)
    db.execute(stmt)


def claim_task(db: Session, campaign_id: int, task_id: int, user_id: UUID) -> ClaimOutcome:
    """Take (or refresh) the lease on a task, reporting who has it otherwise.

    Idempotent, and leaves the caller holding exactly one claim in the
    campaign. A task that is assigned or already worked has nothing to lease
    and comes back unclaimed with no holder.
    """
    # The row lock serializes concurrent claims on the same task, so the loser
    # reads the winner's claim rather than overwriting it.
    task = db.execute(
        select(AnnotationTask)
        .where(AnnotationTask.id == task_id, AnnotationTask.campaign_id == campaign_id)
        .with_for_update()
    ).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Annotation task not found in this campaign")

    holder = live_claim_holder(task, datetime.now(UTC))
    if holder is not None and holder != user_id:
        return ClaimOutcome(
            claimed=False,
            claimed_at=task.claimed_at,
            holder_user_id=holder,
            holder_display_name=task.claimed_by.display_name if task.claimed_by else None,
        )

    if not _is_leasable(db, task_id):
        return ClaimOutcome(claimed=False, claimed_at=None)

    # Release first: the unique index rejects a second claim, and autoflush is
    # off, so the ORM update below must not reach the database before this one.
    release_claims_for_user(db, campaign_id, user_id, keep_task_id=task_id)
    task.claimed_by_user_id = user_id
    task.claimed_at = func.now()
    db.commit()
    db.refresh(task)
    return ClaimOutcome(claimed=True, claimed_at=task.claimed_at, holder_user_id=user_id)


def _is_leasable(db: Session, task_id: int) -> bool:
    """Whether a task is free work: nobody assigned to it, nobody has labelled
    or skipped it yet."""
    assigned = db.execute(
        select(AnnotationTaskAssignment.id)
        .where(AnnotationTaskAssignment.task_id == task_id)
        .limit(1)
    ).first()
    if assigned is not None:
        return False
    worked = db.execute(
        select(Annotation.id).where(Annotation.annotation_task_id == task_id).limit(1)
    ).first()
    return worked is None

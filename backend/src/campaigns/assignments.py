import io
import random
from collections import defaultdict
from typing import Any, cast
from uuid import UUID

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import CursorResult, Result, delete, func, select
from sqlalchemy.orm import Session, joinedload

from src.annotation.claims import is_free_work
from src.annotation.models import Annotation, AnnotationTask, AnnotationTaskAssignment
from src.auth.constants import AGENT_ISSUER
from src.auth.models import User
from src.campaigns.models import Campaign, TaskSet
from src.campaigns.schemas import (
    AssignReviewersRequest,
    AssignTasksToUsersRequest,
    AssignTasksToUsersResult,
    ReviewShareOfTasks,
)
from src.projects.models import ProjectUser

ASSIGNMENTS_CSV_COLUMNS = [
    "annotation_number",
    # Which set a task belongs to. Informational like the annotation columns - import
    # matches on annotation_number, which is unique campaign-wide - but without it a
    # full-campaign export is unreadable once a campaign has more than one set.
    "task_set",
    "assignees",
    "reviewers",
    "annotation_count",
    "existing_annotations",
]
USERS_CSV_COLUMNS = ["email", "display_name", "is_admin", "is_authoritative_reviewer"]
# Columns read back on import; the rest of ASSIGNMENTS_CSV_COLUMNS are
# informational (existing labels) and ignored so a round-trip doesn't error.
_IMPORT_REQUIRED_COLUMNS = {"annotation_number", "assignees", "reviewers"}
_MAX_REPORTED_ERRORS = 50


def _deleted_rows(result: Result[Any]) -> int:
    """Session.execute is typed as returning a plain Result; a DELETE always
    produces a CursorResult, which is what carries rowcount."""
    return cast("CursorResult[Any]", result).rowcount


def _verify_campaign_members(
    db: Session, campaign_id: int, user_ids: set[UUID], role: str = "Users"
) -> None:
    if not user_ids:
        return
    found = set(
        db.scalars(
            select(ProjectUser.user_id)
            .join(Campaign, Campaign.project_id == ProjectUser.project_id)
            .where(Campaign.id == campaign_id, ProjectUser.user_id.in_(user_ids))
        ).all()
    )
    missing = user_ids - found
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"{role} not assigned to campaign: {', '.join(str(uid) for uid in missing)}",
        )


def _verify_tasks_in_campaign(db: Session, campaign_id: int, task_ids: list[int]) -> list[int]:
    """Raise 404 if any task_id isn't in the campaign; otherwise return the
    (unique) found ids so callers who already need them skip a second query."""
    if not task_ids:
        return []
    found = list(
        db.scalars(
            select(AnnotationTask.id).where(
                AnnotationTask.id.in_(task_ids),
                AnnotationTask.campaign_id == campaign_id,
            )
        ).all()
    )
    missing = set(task_ids) - set(found)
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Tasks not found in campaign: {', '.join(str(tid) for tid in missing)}",
        )
    return found


def _eligible_task_ids(db: Session, campaign_id: int, task_set_id: int | None = None) -> list[int]:
    """Campaign tasks free to hand out, locked for update."""
    conditions = [AnnotationTask.campaign_id == campaign_id, is_free_work()]
    if task_set_id is not None:
        conditions.append(AnnotationTask.task_set_id == task_set_id)
    stmt = (
        select(AnnotationTask.id)
        .where(*conditions)
        .order_by(AnnotationTask.id)
        .with_for_update(skip_locked=True)
    )
    return list(db.scalars(stmt).all())


def _distribute_evenly(task_ids: list[int], user_ids: list[UUID]) -> dict[int, list[UUID]]:
    if not task_ids or not user_ids:
        return {}
    return {task_id: [user_ids[i % len(user_ids)]] for i, task_id in enumerate(task_ids)}


def _distribute_fixed(
    task_ids: list[int], user_task_counts: dict[UUID, int]
) -> dict[int, list[UUID]]:
    mapping: dict[int, list[UUID]] = {}
    cursor = 0
    for user_id, count in user_task_counts.items():
        for _ in range(max(0, count)):
            if cursor >= len(task_ids):
                return mapping
            mapping[task_ids[cursor]] = [user_id]
            cursor += 1
    return mapping


def _filter_new_pairs(db: Session, pairs: list[tuple[int, UUID]]) -> list[tuple[int, UUID]]:
    if not pairs:
        return []
    task_ids = {task_id for task_id, _ in pairs}
    existing = set(
        db.execute(
            select(AnnotationTaskAssignment.task_id, AnnotationTaskAssignment.user_id).where(
                AnnotationTaskAssignment.task_id.in_(task_ids)
            )
        ).all()
    )
    return [pair for pair in pairs if pair not in existing]


def assign_tasks_to_users(
    db: Session, campaign_id: int, req: AssignTasksToUsersRequest
) -> AssignTasksToUsersResult:
    """
    Assign annotation tasks to campaign members. "explicit" assigns the given
    mapping directly; "even" and "fixed_per_user" distribute the pool of
    unassigned, unannotated tasks across the selected users.
    """
    if req.strategy == "explicit":
        mapping = {
            task_id: list(user_ids) for task_id, user_ids in (req.task_assignments or {}).items()
        }
        user_ids = {uid for uids in mapping.values() for uid in uids}
        _verify_campaign_members(db, campaign_id, user_ids)
        _verify_tasks_in_campaign(db, campaign_id, list(mapping.keys()))
    else:
        if req.strategy == "even" and not req.user_ids:
            raise HTTPException(status_code=400, detail="No users selected")
        if req.strategy == "fixed_per_user" and not req.user_task_counts:
            raise HTTPException(status_code=400, detail="No users selected")

        # The two branches above already rejected the empty half of each
        # strategy, which is what makes these non-null here.
        counts = req.user_task_counts or {}
        target_users = req.user_ids if req.strategy == "even" else list(counts)
        _verify_campaign_members(db, campaign_id, set(target_users))

        eligible_ids = _eligible_task_ids(db, campaign_id, req.task_set_id)
        random.shuffle(eligible_ids)
        mapping = (
            _distribute_evenly(eligible_ids, req.user_ids)
            if req.strategy == "even"
            else _distribute_fixed(eligible_ids, counts)
        )

    pairs = [(task_id, user_id) for task_id, user_ids in mapping.items() for user_id in user_ids]
    new_pairs = _filter_new_pairs(db, pairs)

    if new_pairs:
        for task_id, user_id in new_pairs:
            db.add(
                AnnotationTaskAssignment(
                    task_id=task_id,
                    user_id=user_id,
                )
            )
        db.commit()

    return AssignTasksToUsersResult(total_assigned=len(new_pairs))


def unassign_users_from_tasks(
    db: Session,
    campaign_id: int,
    task_ids: list[int],
    user_ids: list[UUID] | None = None,
) -> int:
    """
    Batch-remove user assignments from multiple tasks.

    If `user_ids` is None, removes ALL assignments from each task.
    Otherwise, removes only the listed users from each task.

    Returns the number of assignment rows deleted.
    """
    if not task_ids:
        return 0

    _verify_tasks_in_campaign(db, campaign_id, task_ids)

    where_clauses = [AnnotationTaskAssignment.task_id.in_(task_ids)]
    if user_ids is not None:
        if not user_ids:
            return 0
        where_clauses.append(AnnotationTaskAssignment.user_id.in_(user_ids))

    deleted = _deleted_rows(db.execute(delete(AnnotationTaskAssignment).where(*where_clauses)))
    db.commit()
    return deleted


def _reviewable_tasks(
    db: Session, campaign_id: int, task_set_id: int | None = None
) -> list[AnnotationTask]:
    """Campaign tasks that already have a primary (non-review) assignment.

    A reviewer reviews someone else's annotation work, so a task is only
    eligible for review once it has been assigned for annotation. Tasks with
    no assignment - or with only review assignments - are excluded.
    """
    has_primary_assignment = (
        select(AnnotationTaskAssignment.id)
        .where(
            AnnotationTaskAssignment.task_id == AnnotationTask.id,
            AnnotationTaskAssignment.is_review.is_(False),
        )
        .exists()
    )
    conditions = [
        AnnotationTask.campaign_id == campaign_id,
        has_primary_assignment,
    ]
    if task_set_id is not None:
        conditions.append(AnnotationTask.task_set_id == task_set_id)
    stmt = select(AnnotationTask).where(*conditions)
    return list(db.scalars(stmt).all())


def _top_up_review_assignments(
    db: Session,
    tasks_to_review: list[AnnotationTask],
    num_reviewers: int,
    reviewer_ids: list[UUID],
) -> None:
    """Top each task up to `num_reviewers` review assignments.

    Counts only existing review assignments (is_review=True), so a task that
    already has enough reviewers gets none added and re-running is idempotent.
    Users already assigned to a task (annotator or reviewer) are excluded from
    the eligible pool, so the original annotator never reviews their own task
    and nobody is assigned twice.
    """
    task_ids_to_review = [task.id for task in tasks_to_review]
    stmt = select(AnnotationTaskAssignment).where(
        AnnotationTaskAssignment.task_id.in_(task_ids_to_review)
    )
    existing_assignments = db.scalars(stmt).all()

    assigned_user_ids: dict[int, set[UUID]] = {}
    review_counts: dict[int, int] = {}
    for assignment in existing_assignments:
        assigned_user_ids.setdefault(assignment.task_id, set()).add(assignment.user_id)
        if assignment.is_review:
            review_counts[assignment.task_id] = review_counts.get(assignment.task_id, 0) + 1

    new_pairs: list[tuple[int, UUID]] = []
    for task in tasks_to_review:
        needed = max(0, num_reviewers - review_counts.get(task.id, 0))
        if needed == 0:
            continue
        existing_user_ids = assigned_user_ids.get(task.id, set())
        eligible = [uid for uid in reviewer_ids if uid not in existing_user_ids]
        selected_reviewers = random.sample(eligible, min(needed, len(eligible)))
        for user_id in selected_reviewers:
            new_pairs.append((task.id, user_id))

    for task_id, user_id in new_pairs:
        db.add(
            AnnotationTaskAssignment(
                task_id=task_id,
                user_id=user_id,
                is_review=True,
            )
        )

    db.commit()


def assign_reviewers(db: Session, campaign_id: int, req: AssignReviewersRequest) -> int:
    """
    Add reviewers to a share or a number of the campaign's already-assigned tasks.

    Only tasks with a primary (non-review) assignment are eligible; each one
    picked is topped up to `reviewers_per_task` review assignments, so running
    it again tops up rather than stacking more reviewers. Returns the number of
    tasks picked.
    """
    if len(req.reviewer_ids) < req.reviewers_per_task:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Not enough reviewers in pool. Need at least {req.reviewers_per_task}, "
                f"got {len(req.reviewer_ids)}"
            ),
        )
    _verify_campaign_members(db, campaign_id, set(req.reviewer_ids), role="Reviewers")

    reviewable_tasks = _reviewable_tasks(db, campaign_id, req.task_set_id)
    if not reviewable_tasks:
        raise HTTPException(
            status_code=404,
            detail="No assigned tasks available for review in campaign",
        )

    if isinstance(req, ReviewShareOfTasks):
        num_tasks = max(1, int(len(reviewable_tasks) * req.percentage / 100))
    else:
        num_tasks = req.num_tasks
        if num_tasks > len(reviewable_tasks):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Requested {num_tasks} tasks but only {len(reviewable_tasks)} "
                    "assigned task(s) are available for review"
                ),
            )

    tasks_to_review = random.sample(reviewable_tasks, num_tasks)
    _top_up_review_assignments(db, tasks_to_review, req.reviewers_per_task, req.reviewer_ids)
    return num_tasks


def build_task_assignments_export(
    db: Session, campaign: Campaign, task_set_id: int | None = None
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Build the two export tables for a campaign's task assignments.

    Returns (assignments_df, users_df):
    - assignments_df: one row per task with comma-separated assignee/reviewer
      emails, plus the count and `email=label` pairs of annotations already on
      the task (informational, so an admin can avoid reassigning done work).
    - users_df: the campaign's members with roles, so the admin knows which
      emails are valid to paste into the assignee/reviewer columns.

    ``task_set_id`` narrows the export to one set. The users table is unchanged either
    way: who may be assigned is a campaign-level fact, and an admin editing one set's
    assignments needs the same list of valid emails.
    """
    campaign_id = campaign.id
    label_names = campaign.label_names

    task_query = select(AnnotationTask).where(AnnotationTask.campaign_id == campaign_id)
    if task_set_id is not None:
        task_query = task_query.where(AnnotationTask.task_set_id == task_set_id)
    tasks = list(db.scalars(task_query.order_by(AnnotationTask.annotation_number)).all())
    task_ids = [task.id for task in tasks]

    assignees_by_task: dict[int, list[str]] = defaultdict(list)
    reviewers_by_task: dict[int, list[str]] = defaultdict(list)
    annotations_by_task: dict[int, list[tuple[str, int | None, str]]] = defaultdict(list)

    if task_ids:
        assignment_rows = db.execute(
            select(
                AnnotationTaskAssignment.task_id,
                User.email,
                AnnotationTaskAssignment.is_review,
            )
            .join(User, User.id == AnnotationTaskAssignment.user_id)
            .where(AnnotationTaskAssignment.task_id.in_(task_ids))
        ).all()
        for task_id, email, is_review in assignment_rows:
            target = reviewers_by_task if is_review else assignees_by_task
            target[task_id].append(email)

        annotation_rows = db.execute(
            select(
                Annotation.annotation_task_id, User.email, Annotation.label_id, Annotation.outcome
            )
            .join(User, User.id == Annotation.created_by_user_id)
            .where(Annotation.annotation_task_id.in_(task_ids))
        ).all()
        for task_id, email, label_id, outcome in annotation_rows:
            annotations_by_task[task_id].append((email, label_id, outcome))

    set_names = {
        row[0]: row[1]
        for row in db.execute(
            select(TaskSet.id, TaskSet.name).where(TaskSet.campaign_id == campaign_id)
        ).all()
    }

    assignment_records = []
    for task in tasks:
        annotations = sorted(annotations_by_task.get(task.id, []), key=lambda row: row[0])
        existing = [
            f"{email}={label_names.get(label_id, f'Label {label_id}') if label_id is not None else outcome.upper()}"
            for email, label_id, outcome in annotations
        ]
        assignment_records.append(
            {
                "annotation_number": task.annotation_number,
                "task_set": set_names.get(task.task_set_id, ""),
                "assignees": ", ".join(sorted(assignees_by_task.get(task.id, []))),
                "reviewers": ", ".join(sorted(reviewers_by_task.get(task.id, []))),
                "annotation_count": len(annotations),
                "existing_annotations": ", ".join(existing),
            }
        )

    assignments_df = pd.DataFrame(assignment_records, columns=ASSIGNMENTS_CSV_COLUMNS)

    campaign_users: list[ProjectUser] = sorted(
        db.scalars(
            select(ProjectUser)
            .join(Campaign, Campaign.project_id == ProjectUser.project_id)
            .join(User, User.id == ProjectUser.user_id)
            .where(Campaign.id == campaign_id, User.issuer != AGENT_ISSUER)
            .options(joinedload(ProjectUser.user))
        )
        .unique()
        .all(),
        key=lambda pu: pu.user.email,
    )
    user_records = [
        {
            "email": pu.user.email,
            "display_name": pu.user.display_name or "",
            "is_admin": pu.is_admin,
            "is_authoritative_reviewer": pu.is_authoritative_reviewer,
        }
        for pu in campaign_users
    ]
    users_df = pd.DataFrame(user_records, columns=USERS_CSV_COLUMNS)

    return assignments_df, users_df


def _split_emails(cell: str | None) -> list[str]:
    if not cell:
        return []
    return [part.strip() for part in str(cell).split(",") if part.strip()]


def _fail_import(errors: list[str]) -> None:
    shown = errors[:_MAX_REPORTED_ERRORS]
    if len(errors) > _MAX_REPORTED_ERRORS:
        shown.append(f"...and {len(errors) - _MAX_REPORTED_ERRORS} more issue(s)")
    raise HTTPException(status_code=400, detail="Import failed:\n" + "\n".join(shown))


def import_task_assignments(db: Session, campaign_id: int, file_bytes: bytes) -> dict[str, int]:
    """Replace task assignments/reviewers for a campaign from an uploaded CSV.

    The CSV must have `annotation_number`, `assignees`, and `reviewers` columns
    (comma-separated emails per cell); any other columns are ignored. Every
    referenced email must belong to an existing user who is a member of this
    campaign, or the whole import is rejected with the full list of problems.

    For each task row, the listed assignees/reviewers fully replace whatever
    was on that task (replace semantics). Tasks absent from the file are left
    untouched.
    """
    try:
        df = pd.read_csv(io.BytesIO(file_bytes), dtype=str, keep_default_na=False)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {exc}") from exc

    missing_columns = _IMPORT_REQUIRED_COLUMNS - set(df.columns)
    if missing_columns:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required column(s): {', '.join(sorted(missing_columns))}",
        )

    errors: list[str] = []

    # Parse rows -> (annotation_number, assignee_emails, reviewer_emails).
    parsed: list[tuple[int, list[str], list[str]]] = []
    seen_numbers: set[int] = set()
    duplicate_numbers: set[int] = set()
    for idx, row in df.iterrows():
        line = int(idx) + 2  # +1 for header, +1 for 1-based line numbers
        raw_number = (row["annotation_number"] or "").strip()
        if not raw_number:
            errors.append(f"Row {line}: empty annotation_number")
            continue
        try:
            number = int(raw_number)
        except ValueError:
            errors.append(f"Row {line}: annotation_number '{raw_number}' is not an integer")
            continue
        if number in seen_numbers:
            duplicate_numbers.add(number)
        seen_numbers.add(number)
        parsed.append((number, _split_emails(row["assignees"]), _split_emails(row["reviewers"])))

    if duplicate_numbers:
        errors.append(f"Duplicate annotation_number(s) in file: {sorted(duplicate_numbers)}")

    # Resolve tasks by their campaign-local annotation number.
    tasks = db.scalars(
        select(AnnotationTask).where(AnnotationTask.campaign_id == campaign_id)
    ).all()
    task_by_number = {task.annotation_number: task for task in tasks}
    missing_tasks = sorted({n for n, _, _ in parsed} - set(task_by_number))
    if missing_tasks:
        errors.append(f"annotation_number(s) not found in campaign: {missing_tasks}")

    # Resolve every referenced email to a user (case-insensitive), then verify
    # membership. Both checks aggregate so the admin sees all problems at once.
    referenced_emails = {e for _, a, r in parsed for e in (*a, *r)}
    lowered = {e.lower() for e in referenced_emails}
    found_users = (
        db.scalars(select(User).where(func.lower(User.email).in_(lowered))).all() if lowered else []
    )
    user_by_email = {user.email.lower(): user for user in found_users}

    missing_emails = sorted(e for e in referenced_emails if e.lower() not in user_by_email)
    if missing_emails:
        errors.append(f"User(s) not found (no account with these emails): {missing_emails}")

    member_ids = set(
        db.scalars(
            select(ProjectUser.user_id)
            .join(Campaign, Campaign.project_id == ProjectUser.project_id)
            .where(Campaign.id == campaign_id)
        ).all()
    )
    non_members = sorted(
        e
        for e in referenced_emails
        if e.lower() in user_by_email and user_by_email[e.lower()].id not in member_ids
    )
    if non_members:
        errors.append(f"User(s) not a member of this campaign: {non_members}")

    # Per-row semantic checks mirroring the assignment rules.
    for number, assignees, reviewers in parsed:
        assignee_set = {e.lower() for e in assignees}
        reviewer_set = {e.lower() for e in reviewers}
        overlap = assignee_set & reviewer_set
        if overlap:
            errors.append(
                f"Task {number}: user(s) listed as both assignee and reviewer: {sorted(overlap)}"
            )
        if reviewers and not assignees:
            errors.append(
                f"Task {number}: has reviewer(s) but no assignee "
                "(a reviewer reviews an assignee's work)"
            )

    if errors:
        _fail_import(errors)

    # Replace assignments task-by-task. Deletes run immediately; the inserts are
    # flushed on commit, so the (task_id, user_id) unique constraint never trips.
    new_assignments: list[tuple[int, UUID, bool]] = []
    assignees_created = 0
    reviewers_created = 0
    for number, assignees, reviewers in parsed:
        task = task_by_number[number]
        assignee_users = _unique_users(assignees, user_by_email)
        reviewer_users = _unique_users(reviewers, user_by_email)

        db.execute(
            delete(AnnotationTaskAssignment).where(AnnotationTaskAssignment.task_id == task.id)
        )
        for user in assignee_users:
            new_assignments.append((task.id, user.id, False))
        for user in reviewer_users:
            new_assignments.append((task.id, user.id, True))
        assignees_created += len(assignee_users)
        reviewers_created += len(reviewer_users)

    for task_id, user_id, is_review in new_assignments:
        db.add(
            AnnotationTaskAssignment(
                task_id=task_id,
                user_id=user_id,
                is_review=is_review,
            )
        )

    db.commit()

    return {
        "tasks_updated": len(parsed),
        "assignees_created": assignees_created,
        "reviewers_created": reviewers_created,
    }


def _unique_users(emails: list[str], user_by_email: dict[str, User]) -> list[User]:
    seen: set[UUID] = set()
    result: list[User] = []
    for email in emails:
        user = user_by_email[email.lower()]
        if user.id not in seen:
            seen.add(user.id)
            result.append(user)
    return result

import io
import random
from collections import defaultdict
from uuid import UUID

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, joinedload

from src.annotation.constants import (
    ANNOTATION_TASK_STATUS_DONE,
    ANNOTATION_TASK_STATUS_PENDING,
    ANNOTATION_TASK_STATUS_SKIPPED,
)
from src.annotation.models import Annotation, AnnotationTask, AnnotationTaskAssignment
from src.auth.models import User
from src.campaigns.models import Campaign, CampaignUser
from src.campaigns.schemas import (
    AssignTasksToUsersRequest,
    AssignTasksToUsersResult,
    label_id_to_name,
)

ASSIGNMENTS_CSV_COLUMNS = [
    "annotation_number",
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
_SKIPPED_LABEL = "SKIPPED"


def get_campaign_users_with_roles(db: Session, campaign_id: int) -> list[CampaignUser]:
    """
    Args:
        db: Database session
        campaign_id: ID of the campaign

    Returns:
        List of campaign user associations with user data loaded
    """
    stmt = (
        select(CampaignUser)
        .where(CampaignUser.campaign_id == campaign_id)
        .options(joinedload(CampaignUser.user))
    )

    return db.scalars(stmt).unique().all()


def _seed_assignment_status(
    db: Session, pairs: list[tuple[int, UUID]]
) -> dict[tuple[int, UUID], str]:
    """
    For each (task_id, user_id) pair, return the assignment status that
    reflects an existing annotation by that user on that task. Pairs without
    a pre-existing annotation are omitted (caller defaults to 'pending').

    Reconciles the case where a user labeled a task before being assigned
    (or was unassigned then re-assigned) - without this, the new assignment
    would falsely read 'pending' even though their work is already on file.
    """
    if not pairs:
        return {}

    task_ids = {tid for tid, _ in pairs}
    user_ids = {uid for _, uid in pairs}
    pair_set = set(pairs)

    rows = db.execute(
        select(
            Annotation.annotation_task_id,
            Annotation.created_by_user_id,
            Annotation.label_id,
        ).where(
            Annotation.annotation_task_id.in_(task_ids),
            Annotation.created_by_user_id.in_(user_ids),
        )
    ).all()

    seeded: dict[tuple[int, UUID], str] = {}
    for task_id, user_id, label_id in rows:
        if (task_id, user_id) not in pair_set:
            continue
        seeded[(task_id, user_id)] = (
            ANNOTATION_TASK_STATUS_DONE if label_id is not None else ANNOTATION_TASK_STATUS_SKIPPED
        )
    return seeded


def _verify_campaign_members(
    db: Session, campaign_id: int, user_ids: set[UUID], role: str = "Users"
) -> None:
    if not user_ids:
        return
    found = set(
        db.scalars(
            select(CampaignUser.user_id).where(
                CampaignUser.campaign_id == campaign_id,
                CampaignUser.user_id.in_(user_ids),
            )
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
    """Campaign tasks with no assignment and no annotation, locked for update."""
    has_assignment = (
        select(AnnotationTaskAssignment.id)
        .where(AnnotationTaskAssignment.task_id == AnnotationTask.id)
        .exists()
    )
    has_annotation = (
        select(Annotation.id).where(Annotation.annotation_task_id == AnnotationTask.id).exists()
    )
    conditions = [
        AnnotationTask.campaign_id == campaign_id,
        ~has_assignment,
        ~has_annotation,
    ]
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

        target_users = req.user_ids if req.strategy == "even" else list(req.user_task_counts)
        _verify_campaign_members(db, campaign_id, set(target_users))

        eligible_ids = _eligible_task_ids(db, campaign_id, req.task_set_id)
        random.shuffle(eligible_ids)
        mapping = (
            _distribute_evenly(eligible_ids, req.user_ids)
            if req.strategy == "even"
            else _distribute_fixed(eligible_ids, req.user_task_counts)
        )

    pairs = [(task_id, user_id) for task_id, user_ids in mapping.items() for user_id in user_ids]
    new_pairs = _filter_new_pairs(db, pairs)

    if new_pairs:
        seeded_status = _seed_assignment_status(db, new_pairs)
        for task_id, user_id in new_pairs:
            db.add(
                AnnotationTaskAssignment(
                    task_id=task_id,
                    user_id=user_id,
                    status=seeded_status.get((task_id, user_id), ANNOTATION_TASK_STATUS_PENDING),
                )
            )
        db.commit()

    return AssignTasksToUsersResult(total_assigned=len(new_pairs))


def unassign_user_from_task(db: Session, campaign_id: int, task_id: int, user_id: UUID) -> None:
    """
    Remove a user's assignment from a specific task.
    """
    # Verify task belongs to the campaign
    stmt = select(AnnotationTask).where(
        AnnotationTask.id == task_id, AnnotationTask.campaign_id == campaign_id
    )
    task = db.scalar(stmt)

    if not task:
        raise HTTPException(
            status_code=404, detail=f"Task {task_id} not found in campaign {campaign_id}"
        )

    # Delete the assignment
    stmt = delete(AnnotationTaskAssignment).where(
        AnnotationTaskAssignment.task_id == task_id, AnnotationTaskAssignment.user_id == user_id
    )
    result = db.execute(stmt)

    if result.rowcount == 0:
        raise HTTPException(
            status_code=404, detail=f"User {user_id} is not assigned to task {task_id}"
        )

    db.commit()


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

    result = db.execute(delete(AnnotationTaskAssignment).where(*where_clauses))
    db.commit()
    return result.rowcount or 0


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

    seeded_status = _seed_assignment_status(db, new_pairs)

    for task_id, user_id in new_pairs:
        db.add(
            AnnotationTaskAssignment(
                task_id=task_id,
                user_id=user_id,
                status=seeded_status.get((task_id, user_id), ANNOTATION_TASK_STATUS_PENDING),
                is_review=True,
            )
        )

    db.commit()


def assign_reviewers_percentage(
    db: Session,
    campaign_id: int,
    percentage: float,
    num_reviewers: int,
    reviewer_ids: list[UUID],
    task_set_id: int | None = None,
) -> None:
    """
    Assign reviewers to a percentage of a campaign's already-assigned tasks.

    Only tasks that already have a primary (non-review) assignment are eligible;
    each selected task is topped up to `num_reviewers` review assignments
    (reviewers held in addition to the original annotator). Re-running tops up
    to the target rather than stacking more reviewers on top.

    Args:
        db: Database session
        campaign_id: ID of the campaign
        percentage: Percentage of eligible tasks to assign reviewers to (0-100)
        num_reviewers: Target number of reviewers per task (excluding the annotator)
        reviewer_ids: Pool of reviewer user IDs to choose from
    """
    if not 0 < percentage <= 100:
        raise HTTPException(status_code=400, detail="Percentage must be between 0 and 100")

    if num_reviewers < 1:
        raise HTTPException(status_code=400, detail="Number of reviewers must be at least 1")

    if len(reviewer_ids) < num_reviewers:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough reviewers in pool. Need at least {num_reviewers}, got {len(reviewer_ids)}",
        )

    _verify_campaign_members(db, campaign_id, set(reviewer_ids), role="Reviewers")

    reviewable_tasks = _reviewable_tasks(db, campaign_id, task_set_id)
    if not reviewable_tasks:
        raise HTTPException(
            status_code=404,
            detail="No assigned tasks available for review in campaign",
        )

    num_tasks_to_review = max(1, int(len(reviewable_tasks) * percentage / 100))
    tasks_to_review = random.sample(reviewable_tasks, num_tasks_to_review)

    _top_up_review_assignments(db, tasks_to_review, num_reviewers, reviewer_ids)


def assign_reviewers_fixed(
    db: Session,
    campaign_id: int,
    num_tasks: int,
    num_reviewers: int,
    reviewer_ids: list[UUID],
    task_set_id: int | None = None,
) -> None:
    """
    Assign reviewers to a fixed number of a campaign's already-assigned tasks.

    Only tasks that already have a primary (non-review) assignment are eligible;
    each selected task is topped up to `num_reviewers` review assignments
    (reviewers held in addition to the original annotator). Re-running tops up
    to the target rather than stacking more reviewers on top.

    Args:
        db: Database session
        campaign_id: ID of the campaign
        num_tasks: Number of eligible tasks to assign reviewers to
        num_reviewers: Target number of reviewers per task (excluding the annotator)
        reviewer_ids: Pool of reviewer user IDs to choose from
    """
    if num_tasks < 1:
        raise HTTPException(status_code=400, detail="Number of tasks must be at least 1")

    if num_reviewers < 1:
        raise HTTPException(status_code=400, detail="Number of reviewers must be at least 1")

    if len(reviewer_ids) < num_reviewers:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough reviewers in pool. Need at least {num_reviewers}, got {len(reviewer_ids)}",
        )

    _verify_campaign_members(db, campaign_id, set(reviewer_ids), role="Reviewers")

    reviewable_tasks = _reviewable_tasks(db, campaign_id, task_set_id)
    if not reviewable_tasks:
        raise HTTPException(
            status_code=404,
            detail="No assigned tasks available for review in campaign",
        )

    if num_tasks > len(reviewable_tasks):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Requested {num_tasks} tasks but only {len(reviewable_tasks)} "
                "assigned task(s) are available for review"
            ),
        )

    tasks_to_review = random.sample(reviewable_tasks, num_tasks)

    _top_up_review_assignments(db, tasks_to_review, num_reviewers, reviewer_ids)


def assign_reviewers_manual(
    db: Session, campaign_id: int, manual_assignments: dict[int, list[UUID]]
) -> int:
    """
    Manually assign specific reviewers to specific tasks.

    Like the percentage/fixed patterns, reviewers may only be added to tasks
    that already have a primary (non-review) assignment, and each new assignment
    is recorded as a review (is_review=True). Pairs that already exist are
    skipped. Returns the number of new review assignments created.
    """
    if not manual_assignments:
        return 0

    task_ids = list(manual_assignments.keys())
    reviewer_ids = {uid for uids in manual_assignments.values() for uid in uids}

    _verify_campaign_members(db, campaign_id, reviewer_ids)
    _verify_tasks_in_campaign(db, campaign_id, task_ids)

    reviewable_ids = {task.id for task in _reviewable_tasks(db, campaign_id)}
    not_reviewable = [tid for tid in task_ids if tid not in reviewable_ids]
    if not_reviewable:
        preview = ", ".join(str(tid) for tid in not_reviewable[:10])
        raise HTTPException(
            status_code=400,
            detail=(f"Task(s) {preview} have no primary assignment and cannot receive reviewers"),
        )

    pairs = [
        (task_id, user_id)
        for task_id, user_ids in manual_assignments.items()
        for user_id in user_ids
    ]
    new_pairs = _filter_new_pairs(db, pairs)

    if new_pairs:
        seeded_status = _seed_assignment_status(db, new_pairs)
        for task_id, user_id in new_pairs:
            db.add(
                AnnotationTaskAssignment(
                    task_id=task_id,
                    user_id=user_id,
                    status=seeded_status.get((task_id, user_id), ANNOTATION_TASK_STATUS_PENDING),
                    is_review=True,
                )
            )
        db.commit()

    return len(new_pairs)


def _label_id_to_name(campaign: Campaign) -> dict[int, str]:
    return label_id_to_name(campaign.settings.labels if campaign.settings else None)


def build_task_assignments_export(
    db: Session, campaign: Campaign
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Build the two export tables for a campaign's task assignments.

    Returns (assignments_df, users_df):
    - assignments_df: one row per task with comma-separated assignee/reviewer
      emails, plus the count and `email=label` pairs of annotations already on
      the task (informational, so an admin can avoid reassigning done work).
    - users_df: the campaign's members with roles, so the admin knows which
      emails are valid to paste into the assignee/reviewer columns.
    """
    campaign_id = campaign.id
    label_names = _label_id_to_name(campaign)

    tasks = list(
        db.scalars(
            select(AnnotationTask)
            .where(AnnotationTask.campaign_id == campaign_id)
            .order_by(AnnotationTask.annotation_number)
        ).all()
    )
    task_ids = [task.id for task in tasks]

    assignees_by_task: dict[int, list[str]] = defaultdict(list)
    reviewers_by_task: dict[int, list[str]] = defaultdict(list)
    annotations_by_task: dict[int, list[tuple[str, int | None]]] = defaultdict(list)

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
            select(Annotation.annotation_task_id, User.email, Annotation.label_id)
            .join(User, User.id == Annotation.created_by_user_id)
            .where(Annotation.annotation_task_id.in_(task_ids))
        ).all()
        for task_id, email, label_id in annotation_rows:
            annotations_by_task[task_id].append((email, label_id))

    assignment_records = []
    for task in tasks:
        annotations = sorted(annotations_by_task.get(task.id, []), key=lambda pair: pair[0])
        existing = [
            f"{email}={label_names.get(label_id, f'Label {label_id}') if label_id is not None else _SKIPPED_LABEL}"
            for email, label_id in annotations
        ]
        assignment_records.append(
            {
                "annotation_number": task.annotation_number,
                "assignees": ", ".join(sorted(assignees_by_task.get(task.id, []))),
                "reviewers": ", ".join(sorted(reviewers_by_task.get(task.id, []))),
                "annotation_count": len(annotations),
                "existing_annotations": ", ".join(existing),
            }
        )

    assignments_df = pd.DataFrame(assignment_records, columns=ASSIGNMENTS_CSV_COLUMNS)

    campaign_users = get_campaign_users_with_roles(db, campaign_id)
    user_records = sorted(
        (
            {
                "email": cu.user.email,
                "display_name": cu.user.display_name or "",
                "is_admin": cu.is_admin,
                "is_authoritative_reviewer": cu.is_authoritative_reviewer,
            }
            for cu in campaign_users
        ),
        key=lambda record: record["email"],
    )
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
            select(CampaignUser.user_id).where(CampaignUser.campaign_id == campaign_id)
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

    seeded_status = _seed_assignment_status(db, [(tid, uid) for tid, uid, _ in new_assignments])
    for task_id, user_id, is_review in new_assignments:
        db.add(
            AnnotationTaskAssignment(
                task_id=task_id,
                user_id=user_id,
                status=seeded_status.get((task_id, user_id), ANNOTATION_TASK_STATUS_PENDING),
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

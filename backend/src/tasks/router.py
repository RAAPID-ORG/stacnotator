"""Tasks: the places a campaign asks about, the sets they are grouped in, who is on
them, who holds one, and importing them."""

import io
import zipfile
from datetime import datetime

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.annotation import spatial
from src.annotation.tiles import InvalidBBoxError, parse_bbox
from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.database import get_db
from src.routing import attachment_headers
from src.tasks import assignments, claims, embeddings, ingest, service, task_sets
from src.tasks.schemas import (
    AssignReviewersRequest,
    AssignTasksToUsersRequest,
    AssignTasksToUsersResult,
    ClaimNextResponse,
    ClaimTaskResponse,
    DeleteTasksRequest,
    ImportTaskAssignmentsResult,
    MoveTasksToSetRequest,
    MoveTasksToSetResult,
    TaskChangesOut,
    TaskDensityCell,
    TaskListOut,
    TaskOut,
    TaskSetCreate,
    TaskSetOut,
    TaskSetRename,
    UnassignTasksRequest,
    ValidateLabelSubmissionsResponse,
)
from src.tasks.task_sets import require_task_set

bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    prefix="/campaigns/{campaign_id}",
    tags=["Tasks"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


@router.get("/tasks", response_model=TaskListOut)
def list_tasks(
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    tasks = service.get_tasks(db, campaign)
    return TaskListOut(campaign_id=campaign.id, tasks=tasks)


@router.get(
    "/tasks/changes",
    response_model=TaskChangesOut,
)
def list_task_changes(
    campaign_id: int,
    since: datetime | None = None,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
) -> TaskChangesOut:
    """Tasks changed since ``since``, so one annotator's list reflects
    everyone's work and the admins' edits without reloading it. Without ``since``
    it only hands back the cursor, like the annotation changes poll."""
    now = spatial.server_now(db)
    if since is None:
        return TaskChangesOut(server_time=now, tasks=[])
    task_ids = service.get_changed_task_ids(db, campaign.id, since)
    tasks = service.get_tasks(db, campaign, task_ids) if task_ids else []
    return TaskChangesOut(server_time=now, tasks=tasks)


@router.post(
    "/tasks/{task_id}/claim",
    response_model=ClaimTaskResponse,
)
def claim_task(
    campaign_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> ClaimTaskResponse:
    outcome = claims.claim_task(
        db=db,
        campaign_id=campaign_id,
        task_id=task_id,
        user_id=user.id,
    )
    return ClaimTaskResponse(
        task_id=task_id,
        claimed=outcome.claimed,
        claimed_at=outcome.claimed_at,
        holder_user_id=outcome.holder_user_id,
        holder_display_name=outcome.holder_display_name,
    )


@router.post(
    "/tasks/claim-next",
    response_model=ClaimNextResponse,
)
def claim_next_task(
    campaign_id: int,
    task_set_id: int | None = None,
    after_annotation_number: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    campaign: Campaign = Depends(require_campaign_access),
) -> ClaimNextResponse:
    """Hand out the next task nobody is working on, claimed in the same
    transaction so simultaneous callers get different ones.

    `after_annotation_number` keeps the caller moving forward through the
    campaign and wraps once nothing is left ahead of them.
    """
    task = service.claim_next_task(
        db=db,
        campaign=campaign,
        user_id=user.id,
        task_set_id=task_set_id,
        after_annotation_number=after_annotation_number,
    )
    return ClaimNextResponse(task=TaskOut.model_validate(task) if task else None)


@router.get(
    "/tasks/{task_id}/validate-label",
    response_model=ValidateLabelSubmissionsResponse,
)
def validate_task_label(
    campaign_id: int,
    task_id: int,
    label_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    """Check whether a label_id agrees with the KNN-majority prediction
    derived from the task's satellite embedding and its nearest neighbours
    in the same campaign.

    Always returns 200 with a status field indicating the outcome:
    - ok - label matches neighbours
    - mismatch - label disagrees with neighbours
    - skipped_no_embedding - no embedding for the task
    - skipped_insufficient_data - not enough labeled data yet
    - disabled - no embedding year configured for this campaign
    """
    # Short-circuit if no embedding year is configured
    if campaign.embedding_year is None:
        return ValidateLabelSubmissionsResponse(status="disabled", agrees=None)

    return embeddings.validate_label_submission(
        db,
        campaign_id=campaign_id,
        task_id=task_id,
        label_id=label_id,
    )


@router.post("/ingest-annotation-task-csv")
async def import_tasks_from_csv(
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
    file: UploadFile = File(...),
    task_set_id: int = Form(...),
):
    if not (file.filename or "").endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    require_task_set(db, campaign.id, task_set_id, status_code=400)
    contents = await file.read()
    num_created = ingest.create_tasks_from_csv(db, campaign, contents, task_set_id)
    return {"num_tasks_created": num_created}


@router.post("/ingest-annotation-task-geojson")
async def import_tasks_from_geojson(
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
    file: UploadFile = File(...),
    task_set_id: int = Form(...),
):
    """
    Ingest annotation tasks from a GeoJSON file.

    Each feature becomes one annotation task. Supported geometry types:
    Point, Polygon, MultiPolygon. Polygon geometries are stored as-is and
    displayed as the sample extent during annotation.
    """
    fname = (file.filename or "").lower()
    if not (fname.endswith(".geojson") or fname.endswith(".json")):
        raise HTTPException(status_code=400, detail="File must be a .geojson or .json file")

    require_task_set(db, campaign.id, task_set_id, status_code=400)
    contents = await file.read()
    num_created = ingest.create_tasks_from_geojson(db, campaign, contents, task_set_id)
    return {"num_tasks_created": num_created}


@router.get(
    "/tasks/density",
    response_model=list[TaskDensityCell],
)
def get_task_density(
    campaign_id: int,
    task_set_id: int | None = None,
    bbox: str | None = Query(None, description="minx,miny,maxx,maxy in EPSG:4326"),
    target_cells: int = Query(48, ge=1, le=512),
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
) -> list[TaskDensityCell]:
    """A grid of task counts by status and label, for the campaign maps.

    `bbox` both windows the result and sizes the cells, so zooming resolves: cells
    shrink until one holds a single task and its reported position is that task's own.
    """
    try:
        window = parse_bbox(bbox) if bbox else None
    except InvalidBBoxError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    cells = service.get_task_density(
        db, campaign, target_cells=target_cells, task_set_id=task_set_id, bbox=window
    )
    return [TaskDensityCell(**cell) for cell in cells]


@router.post(
    "/tasks/assign",
    status_code=200,
    response_model=AssignTasksToUsersResult,
)
def assign_tasks_to_users(
    campaign_id: int,
    req: AssignTasksToUsersRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Assign annotation tasks to campaign members from an intent (even / fixed-per-user / explicit). The server selects and distributes the tasks."""
    if req.task_set_id is not None:
        task_sets.require_task_set(db, campaign.id, req.task_set_id, status_code=400)
    return assignments.assign_tasks_to_users(db, campaign_id, req)


@router.post(
    "/tasks/unassign",
    status_code=200,
)
def unassign_tasks(
    campaign_id: int,
    req: UnassignTasksRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """
    Batch-remove assignments from multiple tasks.

    If `user_ids` is provided, only those users are unassigned from each task.
    Otherwise, all users are unassigned from each task in `task_ids`.
    """
    deleted = assignments.unassign_users_from_tasks(db, campaign_id, req.task_ids, req.user_ids)
    return {"message": f"Successfully removed {deleted} assignment(s)"}


@router.post(
    "/tasks/assign-reviewers",
    status_code=200,
)
def assign_reviewers(
    campaign_id: int,
    req: AssignReviewersRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Add reviewers to a percentage or a fixed number of already-assigned tasks."""
    if req.task_set_id is not None:
        task_sets.require_task_set(db, campaign.id, req.task_set_id, status_code=400)
    num_tasks = assignments.assign_reviewers(db, campaign_id, req)
    return {"message": f"Assigned reviewers to {num_tasks} task(s)"}


@router.delete(
    "/tasks",
    status_code=200,
)
def delete_tasks(
    campaign_id: int,
    req: DeleteTasksRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Delete multiple annotation tasks from a campaign"""
    deleted_count = service.delete_campaign_tasks(
        db, campaign_id, req.task_ids, req.delete_annotations
    )
    return {"message": f"Successfully deleted {deleted_count} task(s)"}


@router.get("/task-sets", response_model=list[TaskSetOut])
def list_task_sets(
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    """Task sets of a campaign with per-set task counts (member-accessible)."""
    return task_sets.list_task_sets_with_stats(db, campaign.id)


@router.post("/task-sets", response_model=TaskSetOut, status_code=201)
def create_task_set(
    campaign_id: int,
    req: TaskSetCreate,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    created = task_sets.create_task_set(db, campaign.id, req.name)
    return TaskSetOut(
        id=created.id,
        name=created.name,
        created_at=created.created_at,
        num_tasks=0,
        num_labeled=0,
    )


@router.patch("/task-sets/{task_set_id}", response_model=TaskSetOut)
def rename_task_set(
    campaign_id: int,
    task_set_id: int,
    req: TaskSetRename,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    task_sets.rename_task_set(db, campaign.id, task_set_id, req.name)
    stats = task_sets.list_task_sets_with_stats(db, campaign.id)
    return next(s for s in stats if s["id"] == task_set_id)


@router.delete("/task-sets/{task_set_id}", status_code=204)
def delete_task_set(
    campaign_id: int,
    task_set_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    task_sets.delete_task_set(db, campaign.id, task_set_id)


@router.post(
    "/task-sets/{task_set_id}/move-tasks",
    response_model=MoveTasksToSetResult,
)
def move_tasks_to_set(
    campaign_id: int,
    task_set_id: int,
    req: MoveTasksToSetRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Move tasks (batched) into the given task set. All ids must belong to the campaign."""
    num_moved = task_sets.move_tasks_to_set(db, campaign.id, task_set_id, req.task_ids)
    return MoveTasksToSetResult(num_moved=num_moved)


@router.get("/tasks/assignments/export")
def export_task_assignments(
    campaign_id: int,
    task_set_id: int | None = None,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Export task assignments as a ZIP for campaign admins.

    The archive contains two files:
    - `assignments.csv`: one row per task with comma-separated assignee and
      reviewer emails, plus a count and `email=label` listing of annotations
      already on the task (informational, ignored on re-import).
    - `users.csv`: the campaign's members with roles, so the admin knows which
      emails are valid to use in the assignee/reviewer columns.

    ``task_set_id`` narrows the archive to one set, so an admin working on a single set
    is not handed every task in the campaign. Import stays campaign-wide either way:
    it matches on `annotation_number`, which is unique across the campaign.
    """
    assignments_df, users_df = assignments.build_task_assignments_export(db, campaign, task_set_id)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("assignments.csv", assignments_df.to_csv(index=False))
        archive.writestr("users.csv", users_df.to_csv(index=False))
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers=attachment_headers(f"campaign_{campaign.name}_task_assignments", "zip"),
    )


@router.post(
    "/tasks/assignments/import",
    response_model=ImportTaskAssignmentsResult,
)
async def import_task_assignments(
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
    file: UploadFile = File(...),
):
    """Import task assignments from a CSV (campaign admins only).

    Expects the `assignments.csv` layout from the export: `annotation_number`,
    `assignees`, and `reviewers` columns (comma-separated emails). Every email
    must belong to an existing member of this campaign or the whole import is
    rejected. Listed tasks have their assignments replaced; other tasks are
    left untouched.
    """
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    contents = await file.read()
    result = assignments.import_task_assignments(db, campaign.id, contents)
    return ImportTaskAssignmentsResult(**result)

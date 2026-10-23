import io
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src import background
from src.annotation.embeddings_service import EMBEDDING_RUN
from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.campaigns import assignments, duplication, service, statistics, task_sets
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.campaigns.schemas import (
    AssignReviewersRequest,
    AssignTasksToUsersRequest,
    AssignTasksToUsersResult,
    CampaignCreate,
    CampaignDuplicateRequest,
    CampaignOut,
    CampaignOutFull,
    CampaignsListResponse,
    CampaignStatistics,
    CampaignSummaryOut,
    CampaignUpdate,
    DeleteAnnotationTasksRequest,
    EmbeddingYearUpdateResponse,
    ImportTaskAssignmentsResult,
    LabellingPolicy,
    MoveTasksToSetRequest,
    MoveTasksToSetResult,
    TaskSetCreate,
    TaskSetOut,
    TaskSetRename,
    UnassignTasksRequest,
    UpdateCampaignBBoxRequest,
    UpdateCampaignFormFieldsRequest,
    UpdateCampaignLabelsRequest,
    UpdateEmbeddingYearRequest,
    UpdateLabellingPolicyRequest,
)
from src.database import get_db, release
from src.imagery.registration import REGISTRATION_RUN
from src.projects.dependencies import require_project_admin
from src.projects.models import Project
from src.projects.viewer import project_flags
from src.routing import attachment_headers

bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    prefix="/campaigns",
    tags=["Campaigns"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


def _with_viewer_roles[T: CampaignSummaryOut](
    out: T, db: Session, user: User, project_id: int
) -> T:
    """Stamp the caller's own roles on the owning project onto a campaign
    response, so clients don't need a second round-trip to the member list.
    Each flag mirrors what enforcement grants (projects/access.py)."""
    project = db.get(Project, project_id)
    if project is None:
        return out
    flags = project_flags(db, user, project)
    out.viewer_is_admin = flags.is_admin
    out.viewer_is_member = flags.is_policy_member
    out.viewer_is_authoritative_reviewer = flags.is_authoritative_reviewer
    return out


def _campaign_out(campaign: Campaign, db: Session, user: User) -> CampaignOut:
    """Single exit for every plain CampaignOut response, so the viewer role flags
    mean the same thing on a mutation reply as on a detail read."""
    return _with_viewer_roles(CampaignOut.model_validate(campaign), db, user, campaign.project_id)


@router.get("/", response_model=CampaignsListResponse)
def list_all_campaigns(
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
):
    items = service.list_campaigns_with_user_roles(db, user)
    return CampaignsListResponse(items=items)


def _recover_stale_registration(db: Session, campaign: Campaign) -> None:
    """The UI polls while a campaign is "registering"; recover here if the run's worker
    died, so the user is unblocked without waiting for a restart."""
    if "registering" in (
        campaign.registration_status,
        campaign.embedding_status,
    ) and background.fail_stale_status_runs(
        db, (REGISTRATION_RUN, EMBEDDING_RUN), row_id=campaign.id
    ):
        db.commit()
        db.expire_all()


@router.get("/{campaign_id}", response_model=CampaignOut)
def get_campaign(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_access),
    user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db),
):
    _recover_stale_registration(db, campaign)
    return _campaign_out(service.get_campaign_full(db, campaign_id), db, user)


@router.get("/{campaign_id}/summary", response_model=CampaignSummaryOut)
def get_campaign_summary(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_access),
    user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db),
):
    """The campaign without its imagery, for pages that never render it."""
    _recover_stale_registration(db, campaign)
    summary = CampaignSummaryOut.model_validate(service.get_campaign_summary(db, campaign_id))
    out = _with_viewer_roles(summary, db, user, campaign.project_id)
    # The response is fully materialized here, so the connection is no longer needed and
    # holding it through serialization is pure cost. See database.release.
    release(db)
    return out


@router.post(
    "/",
    response_model=CampaignOut,
    status_code=201,
)
def create_campaign(
    campaign: CampaignCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
):
    require_project_admin(project_id=campaign.project_id, db=db, user=user)
    created = service.create_campaign(
        db,
        name=campaign.name,
        default_work_mode=campaign.default_work_mode,
        project_id=campaign.project_id,
        settings=campaign.settings,
        user_id=user.id,
        imagery_editor_state=campaign.imagery_editor_state,
        timeseries_configs=campaign.timeseries_configs,
        labelling_policy=campaign.labelling_policy,
    )
    return _campaign_out(created, db, user)


def _duplicate_target(
    db: Session, campaign: Campaign, req: CampaignDuplicateRequest, user: User
) -> Project | None:
    """The project a duplicate is asked to land in, vetted; None for a copy
    inside the campaign's own project."""
    if req.target_project_id is None or req.target_project_id == campaign.project_id:
        return None

    project = require_project_admin(project_id=req.target_project_id, db=db, user=user)
    if req.include_annotations:
        raise HTTPException(
            status_code=400,
            detail="Annotations cannot be copied into another project",
        )
    unmet = duplication.unmet_org_requirements(db, campaign, project.organization)
    if unmet:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Organization '{project.organization.name}' is not authorized to use "
                f"{', '.join(unmet)}, which this campaign's imagery needs"
            ),
        )
    return project


@router.post("/{campaign_id}/duplicate", response_model=CampaignOut, status_code=201)
def duplicate_campaign(
    campaign_id: int,
    req: CampaignDuplicateRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
    user: User = Depends(require_authenticated_user),
):
    """Deep-copy the campaign's full setup, into its own project or into
    another project the caller administers; tasks and annotations are copied
    only when requested (campaign admin only)."""
    dup = duplication.duplicate_campaign(
        db,
        campaign,
        target_project=_duplicate_target(db, campaign, req, user),
        include_tasks=req.include_tasks,
        include_annotations=req.include_annotations,
        include_user_layouts=req.include_user_layouts,
        include_assignments=req.include_assignments,
    )
    return _campaign_out(service.get_campaign_full(db, dup.id), db, user)


@router.get("/{campaign_id}/detailed", response_model=CampaignOutFull)
def get_campaign_with_imagery_windows(
    campaign_id: int,
    response: Response,
    campaign: Campaign = Depends(require_campaign_access),
    user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db),
):
    """Get campaign with detailed imagery views and layouts (both default and personal)"""
    # The annotation map busts its tile cache on this response's
    # annotations_version, so a heuristically cached copy would leave every
    # annotator looking at a stale map with nothing to show for it.
    response.headers["Cache-Control"] = "no-store"
    campaign_with_layouts = service.get_campaign_full(db, campaign_id)
    out = CampaignOutFull.model_validate(campaign_with_layouts, context={"user_id": user.id})
    return _with_viewer_roles(out, db, user, campaign_with_layouts.project_id)


@router.patch("/{campaign_id}", response_model=CampaignOut)
def update_campaign(
    campaign_id: int,
    req: CampaignUpdate,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
    user: User = Depends(require_authenticated_user),
):
    """Change the campaign's name, guide, sample extent, research sharing or task
    output. Only the fields sent change. The task output (labelling tasks or
    drawing around them) is fixed once any task has been annotated."""
    return _campaign_out(service.update_campaign(db, campaign, req), db, user)


@router.patch("/{campaign_id}/bbox", response_model=CampaignOut)
def update_campaign_bbox(
    campaign_id: int,
    req: UpdateCampaignBBoxRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
    user: User = Depends(require_authenticated_user),
):
    updated = service.update_campaign_bbox(
        db, campaign, req.bbox_west, req.bbox_south, req.bbox_east, req.bbox_north
    )
    return _campaign_out(updated, db, user)


@router.patch("/{campaign_id}/labels", response_model=CampaignOut)
def update_campaign_labels(
    campaign_id: int,
    req: UpdateCampaignLabelsRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
    user: User = Depends(require_authenticated_user),
):
    """Replace the campaign's label set. Renames (same id, new name) and adds
    (new id) are accepted; removing an existing label is rejected since it
    would orphan annotations that reference it."""
    return _campaign_out(service.update_campaign_labels(db, campaign, req.labels), db, user)


@router.patch("/{campaign_id}/form-fields", response_model=CampaignOut)
def update_campaign_form_fields(
    campaign_id: int,
    req: UpdateCampaignFormFieldsRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
    user: User = Depends(require_authenticated_user),
):
    """Replace the campaign's custom form fields. Edits (same id) and adds (new
    id) are accepted. A removed field is deleted with its stored answers;
    reshaping a field that already has answers is rejected."""
    updated = service.update_campaign_form_fields(db, campaign, req.form_fields)
    return _campaign_out(updated, db, user)


@router.patch("/{campaign_id}/embedding-year", response_model=EmbeddingYearUpdateResponse)
def update_embedding_year(
    campaign_id: int,
    req: UpdateEmbeddingYearRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Set or change the year used for satellite embeddings.

    When the year changes, all existing embeddings are deleted and
    re-fetched for the new year.  This can take some time for large
    campaigns.
    """
    return service.update_embedding_year(db, campaign, req.embedding_year)


@router.patch("/{campaign_id}/labelling-policy", response_model=LabellingPolicy)
def update_labelling_policy(
    campaign_id: int,
    req: UpdateLabellingPolicyRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Replace the campaign's labelling policy. Rejects 'anyone' audiences
    with 400 unless the campaign is public."""
    return service.update_labelling_policy(db, campaign, req)


@router.post(
    "/{campaign_id}/assign-tasks",
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
    "/{campaign_id}/unassign-tasks",
    status_code=200,
)
def batch_unassign_tasks(
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
    "/{campaign_id}/assign-reviewers",
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
    "/{campaign_id}/annotation-tasks",
    status_code=200,
)
def delete_annotation_tasks(
    campaign_id: int,
    req: DeleteAnnotationTasksRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Delete multiple annotation tasks from a campaign"""
    deleted_count = service.delete_annotation_tasks(
        db, campaign_id, req.task_ids, req.delete_annotations
    )
    return {"message": f"Successfully deleted {deleted_count} task(s)"}


@router.get("/{campaign_id}/task-sets", response_model=list[TaskSetOut])
def list_task_sets(
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    """Task sets of a campaign with per-set task counts (member-accessible)."""
    return task_sets.list_task_sets_with_stats(db, campaign.id)


@router.post("/{campaign_id}/task-sets", response_model=TaskSetOut, status_code=201)
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


@router.patch("/{campaign_id}/task-sets/{task_set_id}", response_model=TaskSetOut)
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


@router.delete("/{campaign_id}/task-sets/{task_set_id}", status_code=204)
def delete_task_set(
    campaign_id: int,
    task_set_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    task_sets.delete_task_set(db, campaign.id, task_set_id)


@router.post(
    "/{campaign_id}/task-sets/{task_set_id}/move-tasks",
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


@router.get("/{campaign_id}/export-task-assignments")
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
    "/{campaign_id}/import-task-assignments",
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


@router.delete("/{campaign_id}", status_code=204)
def delete_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """
    Delete a campaign and all associated data (imagery, timeseries, annotations, etc.).
    Only campaign admins can delete campaigns.
    """
    service.delete_campaign(db, campaign_id)


@router.get(
    "/{campaign_id}/statistics",
    response_model=CampaignStatistics,
)
def get_campaign_statistics(
    campaign_id: int,
    task_set_id: int | None = Query(
        None, description="Restrict the statistics to the annotations of one task set"
    ),
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    """
    Get comprehensive statistics for a campaign, or for one of its task sets.

    Returns:
    - Overall campaign metrics (total annotations, tasks with multiple annotations)
    - Krippendorff's Alpha for inter-annotator agreement
    - Overall label distribution
    - Per-annotator stats (total annotations, label distribution)
    - Pairwise agreement percentage between every pair of annotators
    """
    return statistics.get_campaign_statistics(db, campaign, task_set_id)

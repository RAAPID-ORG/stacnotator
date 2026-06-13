import io
import zipfile
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_approved_user, require_campaign_creation_permission
from src.auth.models import User
from src.campaigns import service
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.campaigns.schemas import (
    AssignReviewersRequest,
    AssignTasksToUsersRequest,
    AssignTasksToUsersResult,
    AssignUsersToCampaignRequest,
    CampaignCreate,
    CampaignOut,
    CampaignOutFull,
    CampaignsListResponse,
    CampaignStatistics,
    CampaignUsersResponse,
    DeleteAnnotationTasksRequest,
    EmbeddingYearUpdateResponse,
    ImportTaskAssignmentsResult,
    UnassignTasksRequest,
    UpdateCampaignBBoxRequest,
    UpdateCampaignGuideRequest,
    UpdateCampaignLabelsRequest,
    UpdateCampaignNameRequest,
    UpdateCampaignVisibilityRequest,
    UpdateEmbeddingYearRequest,
    UpdateSampleExtentRequest,
)
from src.database import get_db
from src.utils import FunctionNameOperationIdRoute, clean_filename

bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    prefix="/campaigns",
    tags=["Campaigns"],
    dependencies=[Depends(bearer), Depends(require_approved_user)],
    route_class=FunctionNameOperationIdRoute,
)


@router.get("/", response_model=CampaignsListResponse)
def list_all_campaigns(
    db: Session = Depends(get_db),
    user: User = Depends(require_approved_user),
):
    campaign_data = service.list_campaigns_with_user_roles(db, user_id=user.id)

    # Convert to response schema with role information
    items = []
    for data in campaign_data:
        campaign = data["campaign"]
        items.append(
            {
                "id": campaign.id,
                "name": campaign.name,
                "created_at": campaign.created_at,
                "is_admin": data["is_admin"],
                "is_member": data["is_member"],
                "is_public": campaign.is_public,
            }
        )

    return {"items": items}


@router.get("/{campaign_id}", response_model=CampaignOut)
def get_campaign(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_access),
    db: Session = Depends(get_db),
):
    return service.get_campaign_full(db, campaign_id)


@router.post(
    "/",
    response_model=CampaignOut,
    status_code=201,
)
def create_campaign(
    campaign: CampaignCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_campaign_creation_permission),
):
    result = service.create_campaign(
        db,
        name=campaign.name,
        mode=campaign.mode,
        is_public=campaign.is_public,
        settings=campaign.settings,
        user_id=user.id,
        imagery_editor_state=campaign.imagery_editor_state,
        timeseries_configs=campaign.timeseries_configs,
    )
    return result


@router.post(
    "/{campaign_id}/assign-users",
    status_code=201,
)
def add_users_to_campaign(
    campaign_id: int,
    users_to_assign: AssignUsersToCampaignRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    service.add_users_to_campaign_bulk(db, campaign.id, users_to_assign.user_ids)


@router.get("/{campaign_id}/detailed", response_model=CampaignOutFull)
def get_campaign_with_imagery_windows(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_access),
    user: User = Depends(require_approved_user),
    db: Session = Depends(get_db),
):
    """Get campaign with detailed imagery views and layouts (both default and personal)"""
    campaign_with_layouts = service.get_campaign_with_layouts(db, campaign_id)
    return CampaignOutFull.from_orm(campaign_with_layouts, user_id=user.id)


@router.post(
    "/{campaign_id}/make-user-admin",
    status_code=201,
)
def make_user_campaign_admin(
    campaign_id: int,
    new_admin_user_id: UUID,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    return service.make_admin(db, campaign.id, new_admin_user_id)


@router.post(
    "/{campaign_id}/make-user-authorative-reviewer",
    status_code=201,
)
def make_user_authorative_reviewer(
    campaign_id: int,
    new_authorative_reviewer_id: UUID,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    """Give a user the authorative reviewer role, enabling him to review other annotations."""
    return service.make_authorative_reviewer(db, campaign.id, new_authorative_reviewer_id)


@router.get("/{campaign_id}/users", response_model=CampaignUsersResponse)
def get_campaign_users(
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    """List users on a campaign with their roles.

    Any campaign member can call this: the annotation page needs it to look
    up the current user's admin / reviewer flags on load, and review mode
    already surfaces other annotators anyway, so the list isn't sensitive.
    """
    users = service.get_campaign_users_with_roles(db, campaign_id)
    return CampaignUsersResponse(campaign_id=campaign.id, users=users)


@router.patch("/{campaign_id}/name", response_model=CampaignOut)
def update_campaign_name(
    campaign_id: int,
    req: UpdateCampaignNameRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    return service.update_campaign_name(db, campaign_id, req.name)


@router.patch("/{campaign_id}/visibility", response_model=CampaignOut)
def update_campaign_visibility(
    campaign_id: int,
    req: UpdateCampaignVisibilityRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Toggle a campaign between public and private. Only campaign admins can change this."""
    return service.update_campaign_visibility(db, campaign_id, req.is_public)


@router.patch("/{campaign_id}/guide", response_model=CampaignOut)
def update_campaign_guide(
    campaign_id: int,
    req: UpdateCampaignGuideRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    return service.update_campaign_guide(db, campaign_id, req.guide_markdown)


@router.patch("/{campaign_id}/bbox", response_model=CampaignOut)
def update_campaign_bbox(
    campaign_id: int,
    req: UpdateCampaignBBoxRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    return service.update_campaign_bbox(
        db, campaign_id, req.bbox_west, req.bbox_south, req.bbox_east, req.bbox_north
    )


@router.patch("/{campaign_id}/labels", response_model=CampaignOut)
def update_campaign_labels(
    campaign_id: int,
    req: UpdateCampaignLabelsRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Replace the campaign's label set. Renames (same id, new name) and adds
    (new id) are accepted; removing an existing label is rejected since it
    would orphan annotations that reference it."""
    return service.update_campaign_labels(db, campaign_id, req.labels)


@router.patch("/{campaign_id}/sample-extent", response_model=CampaignOut)
def update_sample_extent(
    campaign_id: int,
    req: UpdateSampleExtentRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    return service.update_sample_extent(db, campaign_id, req.sample_extent_meters)


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
    return service.update_embedding_year(db, campaign_id, req.embedding_year)


@router.delete(
    "/{campaign_id}/users/{user_id}",
    status_code=204,
)
def remove_user_from_campaign(
    campaign_id: int,
    user_id: UUID,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """
    Remove a user from a campaign (admin only).

    Note: This only removes the user's access to the campaign.
    All annotations created by the user are preserved and remain in the campaign.
    """
    service.remove_user_from_campaign(db, campaign_id, user_id)


@router.post(
    "/{campaign_id}/demote-admin",
    status_code=200,
)
def demote_campaign_admin(
    campaign_id: int,
    user_id: UUID,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Demote an admin user to member role"""
    service.demote_admin(db, campaign_id, user_id)
    return {"message": "User demoted from Admin."}


@router.post(
    "/{campaign_id}/demote-auth-reviewer",
    status_code=200,
)
def demote_authorative_reviewer(
    campaign_id: int,
    user_id: UUID,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Demote an authoritative reviewer to basic member"""
    service.demote_authorative_reviewer(db, campaign_id, user_id)
    return {"message": "User demoted from authoritative reviewer."}


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
    """Assign annotation tasks to campaign members from an intent (even / fixed-per-user / explicit). The server selects and distributes the tasks; pass dry_run to preview without writing."""
    return service.assign_tasks_to_users(db, campaign_id, req)


@router.delete(
    "/{campaign_id}/tasks/{task_id}/unassign-user/{user_id}",
    status_code=200,
)
def unassign_user_from_task(
    campaign_id: int,
    task_id: int,
    user_id: UUID,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Remove a user's assignment from a specific task."""
    service.unassign_user_from_task(db, campaign_id, task_id, user_id)
    return {"message": f"Successfully unassigned user from task {task_id}"}


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
    deleted = service.unassign_users_from_tasks(db, campaign_id, req.task_ids, req.user_ids)
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
    """
    Assign reviewers to tasks using different patterns:
    - 'percentage': Assign reviewers to X% of already-assigned tasks
    - 'manual': Manually assign specific reviewers to specific tasks
    - 'fixed': Assign reviewers to a fixed number of already-assigned tasks

    Reviewers are only added to tasks that already have a primary (non-review)
    assignment, and each task is topped up to the requested number of reviewers
    rather than accumulating more on every call.
    """
    if req.pattern == "percentage":
        if req.percentage is None or req.num_reviewers is None or req.reviewer_ids is None:
            raise HTTPException(
                status_code=400,
                detail="For 'percentage' pattern, percentage, num_reviewers, and reviewer_ids are required",
            )
        service.assign_reviewers_percentage(
            db, campaign_id, req.percentage, req.num_reviewers, req.reviewer_ids
        )
        return {"message": f"Successfully assigned reviewers to {req.percentage}% of tasks"}

    elif req.pattern == "manual":
        if req.manual_assignments is None:
            raise HTTPException(
                status_code=400, detail="For 'manual' pattern, manual_assignments is required"
            )
        created = service.assign_reviewers_manual(db, campaign_id, req.manual_assignments)
        return {"message": f"Successfully assigned {created} reviewer(s)"}

    elif req.pattern == "fixed":
        if req.num_tasks is None or req.fixed_num_reviewers is None or req.reviewer_ids is None:
            raise HTTPException(
                status_code=400,
                detail="For 'fixed' pattern, num_tasks, fixed_num_reviewers, and reviewer_ids are required",
            )
        service.assign_reviewers_fixed(
            db, campaign_id, req.num_tasks, req.fixed_num_reviewers, req.reviewer_ids
        )
        return {"message": f"Successfully assigned reviewers to {req.num_tasks} tasks"}

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid pattern '{req.pattern}'. Must be 'percentage', 'manual', or 'fixed'",
        )


@router.delete(
    "/{campaign_id}/tasks/{task_id}/users/{user_id}",
    status_code=200,
)
def remove_user_from_task(
    campaign_id: int,
    task_id: int,
    user_id: UUID,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Remove a user assignment from a specific task"""
    service.unassign_user_from_task(db, campaign_id, task_id, user_id)
    return {"message": "User unassigned successfully"}


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
    deleted_count = service.delete_annotation_tasks(db, campaign_id, req.task_ids)
    return {"message": f"Successfully deleted {deleted_count} task(s)"}


@router.get("/{campaign_id}/export-task-assignments")
def export_task_assignments(
    campaign_id: int,
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
    """
    assignments_df, users_df = service.build_task_assignments_export(db, campaign)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("assignments.csv", assignments_df.to_csv(index=False))
        archive.writestr("users.csv", users_df.to_csv(index=False))
    buffer.seek(0)

    cleaned = clean_filename(campaign.name)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="campaign_{cleaned}_task_assignments.zip"'
            )
        },
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
    result = service.import_task_assignments(db, campaign.id, contents)
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
def get_campaign_statistics_endpoint(
    campaign_id: int,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_access),
):
    """
    Get comprehensive statistics for a campaign.

    Returns:
    - Overall campaign metrics (total annotations, users, tasks)
    - Krippendorff's Alpha for inter-annotator agreement
    - Overall confidence and label distributions
    - Per-user statistics including:
        - Total annotations
        - Average confidence
        - Confidence distribution
        - Label distribution
        - Agreement with majority vote
    """
    return service.get_campaign_statistics(campaign_id, db)

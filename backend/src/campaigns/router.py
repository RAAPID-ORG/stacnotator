from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_approved_user
from src.auth.models import User
from src.campaigns.dependancies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.campaigns.schemas import (
    AssignReviewersRequest,
    AssignTasksToUsersRequest,
    AssignUsersToCampaignRequest,
    CampaignCreate,
    CampaignOut,
    CampaignOutWithImageryWindows,
    CampaignStatistics,
    CampaignUsersResponse,
    CampaignsListResponse,
    DeleteAnnotationTasksRequest,
    UpdateCampaignBBoxRequest,
    UpdateCampaignNameRequest,
)

from src.database import get_db
from src.campaigns import service
from src.utils import FunctionNameOperationIdRoute

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
            }
        )

    return {"items": items}


@router.get("/{campaign_id}", response_model=CampaignOut)
def get_campaign(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_access),
):
    return campaign


@router.post(
    "/",
    response_model=CampaignOut,
    status_code=201,
)
def create_campaign(
    campaign: CampaignCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_approved_user),
):
    return service.create_campaign(
        db,
        name=campaign.name,
        mode=campaign.mode,
        settings=campaign.settings,
        user_id=user.id,
        imagery_configs=campaign.imagery_configs,
        timeseries_configs=campaign.timeseries_configs,
    )


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


@router.get("/{campaign_id}/detailed", response_model=CampaignOutWithImageryWindows)
def get_campaign_with_imagery_windows(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_access),
    user: User = Depends(require_approved_user),
    db: Session = Depends(get_db),
):
    """Get campaign with detailed imagery windows and layouts (both default and personal)"""
    campaign_with_layouts = service.get_campaign_with_layouts(db, campaign_id)
    return CampaignOutWithImageryWindows.from_orm(campaign_with_layouts, user_id=user.id)


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
    campaign: Campaign = Depends(require_campaign_admin),
):
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


@router.patch("/{campaign_id}/bbox", response_model=CampaignOut)
def update_campaign_bbox(
    campaign_id: int,
    req: UpdateCampaignBBoxRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    bbox = req.model_dump() if hasattr(req, "model_dump") else req.dict()
    return service.update_campaign_bbox(db, campaign_id, bbox)


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
    """Demote an authorative reviewer to basic member"""
    service.demote_authorative_user(db, campaign_id, user_id)
    return {"message": "User demoted from authorative reviewer."}


@router.post(
    "/{campaign_id}/assign-tasks",
    status_code=200,
)
def assign_tasks_to_users(
    campaign_id: int,
    req: AssignTasksToUsersRequest,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
):
    """Assign multiple annotation tasks to different users in bulk. Supports multiple reviewers per task."""
    service.assign_tasks_to_users(db, campaign_id, req.task_assignments)
    return {"message": f"Successfully assigned {len(req.task_assignments)} tasks"}


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
    - 'percentage': Assign reviewers to X% of tasks
    - 'manual': Manually assign specific reviewers to specific tasks
    - 'fixed': Assign N reviewers to M tasks
    """
    if req.pattern == "percentage":
        if req.percentage is None or req.num_reviewers is None or req.reviewer_ids is None:
            raise HTTPException(
                status_code=400,
                detail="For 'percentage' pattern, percentage, num_reviewers, and reviewer_ids are required"
            )
        service.assign_reviewers_percentage(
            db, campaign_id, req.percentage, req.num_reviewers, req.reviewer_ids
        )
        return {"message": f"Successfully assigned reviewers to {req.percentage}% of tasks"}
    
    elif req.pattern == "manual":
        if req.manual_assignments is None:
            raise HTTPException(
                status_code=400,
                detail="For 'manual' pattern, manual_assignments is required"
            )
        service.assign_tasks_to_users(db, campaign_id, req.manual_assignments)
        return {"message": f"Successfully assigned {len(req.manual_assignments)} tasks"}
    
    elif req.pattern == "fixed":
        if req.num_tasks is None or req.fixed_num_reviewers is None or req.reviewer_ids is None:
            raise HTTPException(
                status_code=400,
                detail="For 'fixed' pattern, num_tasks, fixed_num_reviewers, and reviewer_ids are required"
            )
        service.assign_reviewers_fixed(
            db, campaign_id, req.num_tasks, req.fixed_num_reviewers, req.reviewer_ids
        )
        return {"message": f"Successfully assigned reviewers to {req.num_tasks} tasks"}
    
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid pattern '{req.pattern}'. Must be 'percentage', 'manual', or 'fixed'"
        )


@router.delete(
    "/{campaign_id}/tasks/{task_id}/users/{user_id}",
    status_code=200,
)
def unassign_user_from_task(
    campaign_id: int,
    task_id: int,
    user_id: str,
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


# TODO add user-personal imagery overwrites (layout+settings (e.g date/zoomlevel/crosshair/windowing))
# On imagery change -> if results in different windows, need to delete user layouts and provide defaults or have a way to merge

# TODO currently only supporting STAC search, but in future also support collections / items
# TODO update campaign settings and imagery (admin only)
# TODO delete campaign, imagery, timeseries (admin only)

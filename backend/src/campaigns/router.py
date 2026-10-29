from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src import background
from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.campaigns import duplication, service, statistics
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.campaigns.models import Campaign
from src.campaigns.schemas import (
    CampaignCreate,
    CampaignDuplicateRequest,
    CampaignOut,
    CampaignOutFull,
    CampaignSettingsLocksOut,
    CampaignsListResponse,
    CampaignStatistics,
    CampaignSummaryOut,
    CampaignUpdate,
)
from src.database import get_db, release
from src.imagery.registration import REGISTRATION_RUN, renew_expiring_mpc_mosaics
from src.projects.dependencies import require_project_admin
from src.projects.models import Project
from src.projects.viewer import project_flags
from src.tasks.embeddings import EMBEDDING_RUN

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


@router.get("/{campaign_id}/settings-locks", response_model=CampaignSettingsLocksOut)
def get_campaign_settings_locks(
    campaign_id: int,
    campaign: Campaign = Depends(require_campaign_admin),
    db: Session = Depends(get_db),
):
    return CampaignSettingsLocksOut(
        task_output_locked=service.task_output_is_locked(db, campaign),
        answered_form_field_ids=service.answered_form_field_ids(db, campaign),
    )


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
    renew_at = renew_expiring_mpc_mosaics(db, campaign)
    campaign_with_layouts = service.get_campaign_full(db, campaign_id)
    out = CampaignOutFull.model_validate(campaign_with_layouts, context={"user_id": user.id})
    out.imagery_renew_at = renew_at
    return _with_viewer_roles(out, db, user, campaign_with_layouts.project_id)


@router.patch("/{campaign_id}", response_model=CampaignOut)
def update_campaign(
    campaign_id: int,
    req: CampaignUpdate,
    db: Session = Depends(get_db),
    campaign: Campaign = Depends(require_campaign_admin),
    user: User = Depends(require_authenticated_user),
):
    """Change any of the campaign's settings; only the fields sent change. Labels
    keep their ids and cannot be removed, a removed form field takes its answers
    with it, the task output is fixed once tasks are worked, 'anyone' audiences
    need a public campaign, a new area registers the imagery again and a new
    embedding year fetches embeddings again."""
    return _campaign_out(service.update_campaign(db, campaign, req), db, user)


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

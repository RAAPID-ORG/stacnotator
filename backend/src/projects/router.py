from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.auth.schemas import UserOut
from src.campaigns.schemas import CampaignsListResponse
from src.database import get_db
from src.organizations.schemas import AddUsersByEmailResult, InviteOut, InvitesListResponse
from src.organizations.service import list_pending_invites, revoke_invite
from src.projects import service
from src.projects.dependencies import require_project_access, require_project_admin
from src.projects.models import Project
from src.projects.schemas import (
    AddProjectUsersByEmailRequest,
    AddProjectUsersByIdsRequest,
    ProjectCreate,
    ProjectOut,
    ProjectsListResponse,
    ProjectTilersOut,
    ProjectUpdateRequest,
    ProjectUserOut,
    ProjectUsersResponse,
)

bearer = HTTPBearer()
router = APIRouter(
    prefix="/projects",
    tags=["Projects"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


@router.get("/", response_model=ProjectsListResponse)
def list_projects(
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
):
    return ProjectsListResponse(items=service.list_projects_for_user(db, user))


@router.post("/", response_model=ProjectOut, status_code=201)
def create_project(
    body: ProjectCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
):
    project = service.create_project(
        db,
        organization_id=body.organization_id,
        name=body.name,
        description=body.description,
        visibility=body.visibility,
        user=user,
    )
    return service.get_project_out(db, project, user)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    project: Project = Depends(require_project_access),
):
    return service.get_project_out(db, project, user)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int,
    body: ProjectUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    project: Project = Depends(require_project_admin),
):
    updated = service.update_project(
        db,
        project_id,
        name=body.name,
        description=body.description,
        visibility=body.visibility,
    )
    return service.get_project_out(db, updated, user)


@router.delete("/{project_id}", status_code=204)
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_admin),
):
    service.delete_project(db, project_id)


@router.get("/{project_id}/campaigns", response_model=CampaignsListResponse)
def list_project_campaigns(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    project: Project = Depends(require_project_access),
):
    return CampaignsListResponse(items=service.list_project_campaigns(db, project, user))


@router.get("/{project_id}/tilers", response_model=ProjectTilersOut)
def get_project_tilers(
    project_id: int,
    project: Project = Depends(require_project_access),
):
    """Tilers the imagery wizard may target for this project (the owning
    organization's allowlist), plus whether internal storage is permitted."""
    return service.get_project_tilers(project)


@router.get("/{project_id}/users", response_model=ProjectUsersResponse)
def get_project_users(
    project_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_access),
):
    project_users = service.get_project_users(db, project_id)
    users = [ProjectUserOut.model_validate(pu) for pu in project_users]
    return ProjectUsersResponse(project_id=project_id, users=users)


@router.post("/{project_id}/users", response_model=AddUsersByEmailResult)
def add_project_users(
    project_id: int,
    body: AddProjectUsersByEmailRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    project: Project = Depends(require_project_admin),
):
    added, invited = service.add_users_by_email(db, project_id, body.emails, invited_by=user.id)
    users = [UserOut.model_validate(u) for u in added]
    return AddUsersByEmailResult(added=users, invited_emails=invited)


@router.get("/{project_id}/invites", response_model=InvitesListResponse)
def list_project_invites(
    project_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_admin),
):
    invites = list_pending_invites(db, project_id=project_id)
    return InvitesListResponse(items=[InviteOut.model_validate(i) for i in invites])


@router.delete("/{project_id}/invites/{invite_id}", status_code=204)
def revoke_project_invite(
    project_id: int,
    invite_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_admin),
):
    revoke_invite(db, invite_id, project_id=project_id)


@router.post("/{project_id}/users/by-ids", status_code=201)
def add_project_users_by_ids(
    project_id: int,
    body: AddProjectUsersByIdsRequest,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_admin),
):
    service.add_users_by_ids(db, project_id, body.user_ids)


@router.post("/{project_id}/users/{user_id}/make-admin", status_code=204)
def make_project_admin(
    project_id: int,
    user_id: UUID,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_admin),
):
    service.make_admin(db, project_id, user_id)


@router.post("/{project_id}/users/{user_id}/demote-admin", status_code=204)
def demote_project_admin(
    project_id: int,
    user_id: UUID,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_admin),
):
    service.demote_admin(db, project_id, user_id)


@router.post("/{project_id}/users/{user_id}/make-authoritative-reviewer", status_code=204)
def make_project_authoritative_reviewer(
    project_id: int,
    user_id: UUID,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_admin),
):
    service.make_authoritative_reviewer(db, project_id, user_id)


@router.post("/{project_id}/users/{user_id}/demote-authoritative-reviewer", status_code=204)
def demote_project_authoritative_reviewer(
    project_id: int,
    user_id: UUID,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_admin),
):
    service.demote_authoritative_reviewer(db, project_id, user_id)


@router.delete("/{project_id}/users/{user_id}", status_code=204)
def remove_project_user(
    project_id: int,
    user_id: UUID,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_admin),
):
    service.remove_user(db, project_id, user_id)

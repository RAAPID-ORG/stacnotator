from fastapi import Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.database import get_db
from src.organizations.service import is_active_org_member
from src.projects.access import has_project_access
from src.projects.models import Project, ProjectUser


def _get_project_and_membership(
    project_id: int, db: Session, user: User
) -> tuple[Project, ProjectUser | None]:
    project = db.execute(select(Project).where(Project.id == project_id)).scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    membership = db.execute(
        select(ProjectUser).where(
            ProjectUser.project_id == project_id, ProjectUser.user_id == user.id
        )
    ).scalar_one_or_none()
    return project, membership


def require_project_access(
    project_id: int = Path(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> Project:
    """Membership, platform-public visibility, org-public visibility for
    active org members, or platform admin. Org-mates of a private project see
    it listed elsewhere but are denied here."""
    project, membership = _get_project_and_membership(project_id, db, user)
    if has_project_access(
        visibility=project.visibility,
        is_active_org_member=is_active_org_member(db, user.id, project.organization_id),
        is_member=membership is not None,
        is_platform_admin=user.is_admin,
    ):
        return project
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have access to this project",
    )


def require_project_admin(
    project_id: int = Path(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> Project:
    project, membership = _get_project_and_membership(project_id, db, user)
    if (membership is not None and membership.is_admin) or user.is_admin:
        return project
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You are not an admin of this project",
    )


def assert_project_admin(db: Session, user: User, project_id: int) -> Project:
    """Same gate as require_project_admin for call sites where project_id
    arrives in a request body instead of the path (campaign creation)."""
    return require_project_admin(project_id=project_id, db=db, user=user)

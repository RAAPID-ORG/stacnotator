from fastapi import Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.database import get_db
from src.projects.models import Project
from src.projects.viewer import project_flags


def _get_project(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def require_project_access(
    project_id: int = Path(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> Project:
    """Membership, platform-public visibility, org-public visibility for
    active org members, or platform admin. Org-mates of a private project see
    it listed elsewhere but are denied here."""
    project = _get_project(db, project_id)
    if not project_flags(db, user, project).has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this project",
        )
    return project


def require_project_admin(
    project_id: int = Path(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> Project:
    """Also called directly where the project id arrives in a request body."""
    project = _get_project(db, project_id)
    if not project_flags(db, user, project).is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not an admin of this project",
        )
    return project

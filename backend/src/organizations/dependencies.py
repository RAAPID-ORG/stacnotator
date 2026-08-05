from fastapi import Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.database import get_db
from src.organizations.models import MEMBER_STATUS_ACTIVE, Organization, OrganizationUser


def _get_org_and_membership(
    organization_id: int, db: Session, user: User
) -> tuple[Organization, OrganizationUser | None]:
    org = db.execute(
        select(Organization).where(Organization.id == organization_id)
    ).scalar_one_or_none()
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    membership = db.execute(
        select(OrganizationUser).where(
            OrganizationUser.organization_id == organization_id,
            OrganizationUser.user_id == user.id,
        )
    ).scalar_one_or_none()
    return org, membership


def require_org_member(
    organization_id: int = Path(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> Organization:
    """Active org membership (or platform admin). Pending members are not in."""
    org, membership = _get_org_and_membership(organization_id, db, user)
    if user.is_admin:
        return org
    if membership is None or membership.status != MEMBER_STATUS_ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )
    return org


def require_org_admin(
    organization_id: int = Path(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> Organization:
    org, membership = _get_org_and_membership(organization_id, db, user)
    if user.is_admin:
        return org
    if membership is None or membership.status != MEMBER_STATUS_ACTIVE or not membership.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not an admin of this organization",
        )
    return org

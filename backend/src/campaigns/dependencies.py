from fastapi import Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from src.auth.dependencies import require_approved_user
from src.auth.models import User
from src.campaigns.models import Campaign
from src.database import get_db
from src.projects.models import ProjectUser


def _get_campaign(db: Session, campaign_id: int) -> Campaign:
    campaign = db.execute(
        select(Campaign).options(joinedload(Campaign.project)).where(Campaign.id == campaign_id)
    ).scalar_one_or_none()
    if campaign is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    return campaign


def require_campaign_access(
    campaign_id: int = Path(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_approved_user),
) -> Campaign:
    """
    Verify user has access to a campaign (any role).

    Access resolves through the owning project: granted if
    - The campaign's project is public, OR
    - The user is a member of the campaign's project, OR
    - The user is a platform admin.

    Args:
        campaign_id: ID of the campaign to check access for
        db: Database session
        user: Authenticated and approved user

    Returns:
        Campaign object if access is granted

    Raises:
        HTTPException: 404 if campaign not found, 403 if access denied
    """
    campaign = _get_campaign(db, campaign_id)

    if campaign.project.is_public:
        return campaign

    has_access = (
        db.execute(
            select(ProjectUser).where(
                ProjectUser.project_id == campaign.project_id,
                ProjectUser.user_id == user.id,
            )
        ).scalar_one_or_none()
    ) or user.is_admin

    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this campaign",
        )

    return campaign


def require_campaign_admin(
    campaign_id: int = Path(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_approved_user),
) -> Campaign:
    """
    Verify user has admin access to a campaign.

    Admin rights resolve through the owning project: granted if the user is
    flagged admin on the campaign's project, or is a platform admin.

    Args:
        campaign_id: ID of the campaign to check admin access for
        db: Database session
        user: Authenticated and approved user

    Returns:
        Campaign object if admin access is granted

    Raises:
        HTTPException: 404 if campaign not found, 403 if not an admin
    """
    campaign = _get_campaign(db, campaign_id)

    has_admin_access = (
        db.execute(
            select(ProjectUser).where(
                ProjectUser.project_id == campaign.project_id,
                ProjectUser.user_id == user.id,
                ProjectUser.is_admin,
            )
        ).scalar_one_or_none()
    ) or user.is_admin

    if not has_admin_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not an admin of this campaign",
        )

    return campaign

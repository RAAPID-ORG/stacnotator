from fastapi import Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from src.auth.dependencies import require_approved_user
from src.auth.service import is_admin
from src.campaigns.models import Campaign, CampaignUser
from src.database import get_db


def require_campaign_access(
    campaign_id: int = Path(...),
    db: Session = Depends(get_db),
    user: dict = Depends(require_approved_user),
) -> Campaign:
    """
    Verify user has access to a campaign (any role).

    Access is granted if:
    - The campaign is public, OR
    - The user is a member of the campaign, OR
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
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Campaign not found",
        )

    # Public campaigns are accessible to all authenticated users
    if campaign.is_public:
        return campaign

    has_access = (
        db.query(CampaignUser)
        .filter(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user.id,
        )
        .first()
    ) or is_admin(db, user.id)

    if not has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this campaign",
        )

    return campaign


def require_campaign_admin(
    campaign_id: int = Path(...),
    db: Session = Depends(get_db),
    user: dict = Depends(require_approved_user),
) -> Campaign:
    """
    Verify user has admin access to a campaign.

    Args:
        campaign_id: ID of the campaign to check admin access for
        db: Database session
        user: Authenticated and approved user

    Returns:
        Campaign object if admin access is granted

    Raises:
        HTTPException: 404 if campaign not found, 403 if not an admin
    """
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if campaign is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Campaign not found",
        )

    has_admin_access = (
        db.query(CampaignUser)
        .filter(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user.id,
            CampaignUser.is_admin,
        )
        .first()
    ) or is_admin(db, user.id)

    if not has_admin_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not an admin of this campaign",
        )

    return campaign

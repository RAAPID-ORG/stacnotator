from fastapi import Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.campaigns.models import Campaign
from src.database import get_db
from src.projects.viewer import project_flags


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
    user: User = Depends(require_authenticated_user),
) -> Campaign:
    """Any access to the campaign, resolved through its project (see
    projects/access.py:has_project_access)."""
    campaign = _get_campaign(db, campaign_id)
    if not project_flags(db, user, campaign.project).has_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this campaign",
        )
    return campaign


def require_campaign_admin(
    campaign_id: int = Path(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> Campaign:
    """Admin of the campaign's project, or a platform admin."""
    campaign = _get_campaign(db, campaign_id)
    if not project_flags(db, user, campaign.project).is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not an admin of this campaign",
        )
    return campaign

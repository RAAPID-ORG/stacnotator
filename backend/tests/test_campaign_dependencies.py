"""Tests for campaign access dependencies (campaigns/dependencies.py)."""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException


def _build_db(campaign_result, membership_result, org_membership=None):
    """Build a mock db where successive db.execute().scalar_one_or_none()
    calls return campaign_result, then membership_result. The active-org
    membership lookup (grants_org_access) reads db.scalars().first()."""
    results = [campaign_result, membership_result]
    call_index = {"i": 0}

    def _execute_side_effect(*_args, **_kwargs):
        chain = MagicMock()
        i = call_index["i"]
        call_index["i"] += 1
        chain.scalar_one_or_none.return_value = results[i] if i < len(results) else None
        return chain

    db = MagicMock()
    db.execute.side_effect = _execute_side_effect
    db.scalars.return_value.first.return_value = org_membership
    return db


def _user(is_admin=False):
    """A stand-in for the authenticated User. Platform-admin status is read off
    user.is_admin (roles are selectin-loaded), not a separate query."""
    return MagicMock(id=uuid4(), is_admin=is_admin)


def _campaign(visibility="private"):
    """A stand-in for Campaign, spec'd so that accessing `.is_public` directly
    (the pre-project-membership shape) raises AttributeError instead of
    silently auto-creating a MagicMock - access must go through
    `campaign.project.visibility`."""
    campaign = MagicMock(spec=["project_id", "project", "id"])
    campaign.project_id = 1
    campaign.project = MagicMock(visibility=visibility, organization_id=5)
    return campaign


class TestRequireCampaignAccess:
    def test_campaign_not_found_raises_404(self):
        from src.campaigns.dependencies import require_campaign_access

        db = _build_db(None, None)

        with pytest.raises(HTTPException) as exc_info:
            require_campaign_access(campaign_id=999, db=db, user=_user())
        assert exc_info.value.status_code == 404

    def test_user_not_member_raises_403(self):
        from src.campaigns.dependencies import require_campaign_access

        campaign = _campaign(visibility="private")
        db = _build_db(campaign, None)

        with pytest.raises(HTTPException) as exc_info:
            require_campaign_access(campaign_id=1, db=db, user=_user())
        assert exc_info.value.status_code == 403

    def test_public_campaign_grants_access_to_non_member(self):
        from src.campaigns.dependencies import require_campaign_access

        campaign = _campaign(visibility="public")
        db = _build_db(campaign, None)

        result = require_campaign_access(campaign_id=1, db=db, user=_user())
        assert result is campaign

    def test_org_public_campaign_grants_access_to_active_org_member(self):
        from src.campaigns.dependencies import require_campaign_access

        campaign = _campaign(visibility="organization")
        db = _build_db(campaign, None, org_membership=MagicMock())

        result = require_campaign_access(campaign_id=1, db=db, user=_user())
        assert result is campaign

    def test_org_public_campaign_denies_non_org_member(self):
        from src.campaigns.dependencies import require_campaign_access

        campaign = _campaign(visibility="organization")
        db = _build_db(campaign, None)

        with pytest.raises(HTTPException) as exc_info:
            require_campaign_access(campaign_id=1, db=db, user=_user())
        assert exc_info.value.status_code == 403

    def test_global_admin_bypasses_membership(self):
        from src.campaigns.dependencies import require_campaign_access

        campaign = _campaign(visibility="private")
        db = _build_db(campaign, None)

        result = require_campaign_access(campaign_id=1, db=db, user=_user(is_admin=True))
        assert result is campaign

    def test_campaign_member_gets_access(self):
        from src.campaigns.dependencies import require_campaign_access

        campaign = _campaign(visibility="private")
        membership = MagicMock()
        db = _build_db(campaign, membership)

        result = require_campaign_access(campaign_id=1, db=db, user=_user())
        assert result is campaign


class TestRequireCampaignAdmin:
    def test_campaign_not_found_raises_404(self):
        from src.campaigns.dependencies import require_campaign_admin

        db = _build_db(None, None)

        with pytest.raises(HTTPException) as exc_info:
            require_campaign_admin(campaign_id=999, db=db, user=_user())
        assert exc_info.value.status_code == 404

    def test_non_admin_member_raises_403(self):
        from src.campaigns.dependencies import require_campaign_admin

        campaign = _campaign(visibility="private")
        db = _build_db(campaign, None)

        with pytest.raises(HTTPException) as exc_info:
            require_campaign_admin(campaign_id=1, db=db, user=_user())
        assert exc_info.value.status_code == 403

    def test_global_admin_bypasses_campaign_role(self):
        from src.campaigns.dependencies import require_campaign_admin

        campaign = _campaign(visibility="private")
        db = _build_db(campaign, None)

        result = require_campaign_admin(campaign_id=1, db=db, user=_user(is_admin=True))
        assert result is campaign

    def test_campaign_admin_gets_access(self):
        from src.campaigns.dependencies import require_campaign_admin

        campaign = _campaign(visibility="private")
        admin_record = MagicMock()
        db = _build_db(campaign, admin_record)

        result = require_campaign_admin(campaign_id=1, db=db, user=_user())
        assert result is campaign

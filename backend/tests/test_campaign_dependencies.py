"""Tests for campaign access dependencies (campaigns/dependencies.py)."""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException


def _build_db(campaign_result, membership_result):
    """Build a mock db where successive db.execute().scalar_one_or_none()
    calls return campaign_result, then membership_result."""
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
    return db


def _user(is_admin=False):
    """A stand-in for the authenticated User. Platform-admin status is read off
    user.is_admin (roles are selectin-loaded), not a separate query."""
    return MagicMock(id=uuid4(), is_admin=is_admin)


class TestRequireCampaignAccess:
    def test_campaign_not_found_raises_404(self):
        from src.campaigns.dependencies import require_campaign_access

        db = _build_db(None, None)

        with pytest.raises(HTTPException) as exc_info:
            require_campaign_access(campaign_id=999, db=db, user=_user())
        assert exc_info.value.status_code == 404

    def test_user_not_member_raises_403(self):
        from src.campaigns.dependencies import require_campaign_access

        campaign = MagicMock(is_public=False)
        db = _build_db(campaign, None)

        with pytest.raises(HTTPException) as exc_info:
            require_campaign_access(campaign_id=1, db=db, user=_user())
        assert exc_info.value.status_code == 403

    def test_public_campaign_grants_access_to_non_member(self):
        from src.campaigns.dependencies import require_campaign_access

        campaign = MagicMock(is_public=True)
        db = _build_db(campaign, None)

        result = require_campaign_access(campaign_id=1, db=db, user=_user())
        assert result is campaign

    def test_global_admin_bypasses_membership(self):
        from src.campaigns.dependencies import require_campaign_access

        campaign = MagicMock(is_public=False)
        db = _build_db(campaign, None)

        result = require_campaign_access(campaign_id=1, db=db, user=_user(is_admin=True))
        assert result is campaign

    def test_campaign_member_gets_access(self):
        from src.campaigns.dependencies import require_campaign_access

        campaign = MagicMock(is_public=False)
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

        campaign = MagicMock(is_public=False)
        db = _build_db(campaign, None)

        with pytest.raises(HTTPException) as exc_info:
            require_campaign_admin(campaign_id=1, db=db, user=_user())
        assert exc_info.value.status_code == 403

    def test_global_admin_bypasses_campaign_role(self):
        from src.campaigns.dependencies import require_campaign_admin

        campaign = MagicMock(is_public=False)
        db = _build_db(campaign, None)

        result = require_campaign_admin(campaign_id=1, db=db, user=_user(is_admin=True))
        assert result is campaign

    def test_campaign_admin_gets_access(self):
        from src.campaigns.dependencies import require_campaign_admin

        campaign = MagicMock(is_public=False)
        admin_record = MagicMock()
        db = _build_db(campaign, admin_record)

        result = require_campaign_admin(campaign_id=1, db=db, user=_user())
        assert result is campaign

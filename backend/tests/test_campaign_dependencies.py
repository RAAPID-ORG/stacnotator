"""Tests for campaign access dependencies (campaigns/dependencies.py)."""

from unittest.mock import MagicMock, patch
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


class TestRequireCampaignAccess:
    @patch("src.campaigns.dependencies.is_admin", return_value=False)
    def test_campaign_not_found_raises_404(self, _mock_admin):
        from src.campaigns.dependencies import require_campaign_access

        db = _build_db(None, None)
        user = MagicMock(id=uuid4())

        with pytest.raises(HTTPException) as exc_info:
            require_campaign_access(campaign_id=999, db=db, user=user)
        assert exc_info.value.status_code == 404

    @patch("src.campaigns.dependencies.is_admin", return_value=False)
    def test_user_not_member_raises_403(self, _mock_admin):
        from src.campaigns.dependencies import require_campaign_access

        campaign = MagicMock(is_public=False)
        db = _build_db(campaign, None)
        user = MagicMock(id=uuid4())

        with pytest.raises(HTTPException) as exc_info:
            require_campaign_access(campaign_id=1, db=db, user=user)
        assert exc_info.value.status_code == 403

    @patch("src.campaigns.dependencies.is_admin", return_value=False)
    def test_public_campaign_grants_access_to_non_member(self, _mock_admin):
        from src.campaigns.dependencies import require_campaign_access

        campaign = MagicMock(is_public=True)
        db = _build_db(campaign, None)
        user = MagicMock(id=uuid4())

        result = require_campaign_access(campaign_id=1, db=db, user=user)
        assert result is campaign

    @patch("src.campaigns.dependencies.is_admin", return_value=True)
    def test_global_admin_bypasses_membership(self, _mock_admin):
        from src.campaigns.dependencies import require_campaign_access

        campaign = MagicMock(is_public=False)
        db = _build_db(campaign, None)
        user = MagicMock(id=uuid4())

        result = require_campaign_access(campaign_id=1, db=db, user=user)
        assert result is campaign

    @patch("src.campaigns.dependencies.is_admin", return_value=False)
    def test_campaign_member_gets_access(self, _mock_admin):
        from src.campaigns.dependencies import require_campaign_access

        campaign = MagicMock(is_public=False)
        membership = MagicMock()
        db = _build_db(campaign, membership)
        user = MagicMock(id=uuid4())

        result = require_campaign_access(campaign_id=1, db=db, user=user)
        assert result is campaign


class TestRequireCampaignAdmin:
    @patch("src.campaigns.dependencies.is_admin", return_value=False)
    def test_campaign_not_found_raises_404(self, _mock_admin):
        from src.campaigns.dependencies import require_campaign_admin

        db = _build_db(None, None)
        user = MagicMock(id=uuid4())

        with pytest.raises(HTTPException) as exc_info:
            require_campaign_admin(campaign_id=999, db=db, user=user)
        assert exc_info.value.status_code == 404

    @patch("src.campaigns.dependencies.is_admin", return_value=False)
    def test_non_admin_member_raises_403(self, _mock_admin):
        from src.campaigns.dependencies import require_campaign_admin

        campaign = MagicMock(is_public=False)
        db = _build_db(campaign, None)
        user = MagicMock(id=uuid4())

        with pytest.raises(HTTPException) as exc_info:
            require_campaign_admin(campaign_id=1, db=db, user=user)
        assert exc_info.value.status_code == 403

    @patch("src.campaigns.dependencies.is_admin", return_value=True)
    def test_global_admin_bypasses_campaign_role(self, _mock_admin):
        from src.campaigns.dependencies import require_campaign_admin

        campaign = MagicMock(is_public=False)
        db = _build_db(campaign, None)
        user = MagicMock(id=uuid4())

        result = require_campaign_admin(campaign_id=1, db=db, user=user)
        assert result is campaign

    @patch("src.campaigns.dependencies.is_admin", return_value=False)
    def test_campaign_admin_gets_access(self, _mock_admin):
        from src.campaigns.dependencies import require_campaign_admin

        campaign = MagicMock(is_public=False)
        admin_record = MagicMock()
        db = _build_db(campaign, admin_record)
        user = MagicMock(id=uuid4())

        result = require_campaign_admin(campaign_id=1, db=db, user=user)
        assert result is campaign

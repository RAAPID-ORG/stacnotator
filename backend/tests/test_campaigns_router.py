"""Tests for campaigns/router.py functions that carry logic beyond plain
dependency wiring. Direct function calls with a mocked db, mirroring
tests/test_auth_service.py's TestListUsersVisibility style."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from src.campaigns.router import update_campaign_visibility
from src.campaigns.schemas import UpdateCampaignVisibilityRequest

CAMPAIGN_ID = 7
PROJECT_ID = 3


def _campaign(**kw):
    base = dict(id=CAMPAIGN_ID, project_id=PROJECT_ID)
    base.update(kw)
    return SimpleNamespace(**base)


def _mock_db(sibling_count: int):
    db = MagicMock()
    db.scalar.return_value = sibling_count
    return db


class TestUpdateCampaignVisibilityShim:
    def test_multi_campaign_project_rejects_with_400(self):
        db = _mock_db(sibling_count=2)

        with (
            patch("src.campaigns.router.projects_service.update_project") as update_project,
            pytest.raises(HTTPException) as exc_info,
        ):
            update_campaign_visibility(
                campaign_id=CAMPAIGN_ID,
                req=UpdateCampaignVisibilityRequest(is_public=True),
                db=db,
                campaign=_campaign(),
            )

        assert exc_info.value.status_code == 400
        assert "project settings" in exc_info.value.detail
        update_project.assert_not_called()

    def test_single_campaign_project_delegates_to_project_update(self):
        db = _mock_db(sibling_count=1)
        expected = _campaign()

        with (
            patch("src.campaigns.router.projects_service.update_project") as update_project,
            patch("src.campaigns.router.service.get_campaign_full", return_value=expected),
        ):
            result = update_campaign_visibility(
                campaign_id=CAMPAIGN_ID,
                req=UpdateCampaignVisibilityRequest(is_public=True),
                db=db,
                campaign=_campaign(),
            )

        assert result is expected
        update_project.assert_called_once_with(db, PROJECT_ID, is_public=True)

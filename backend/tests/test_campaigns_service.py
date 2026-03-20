"""Tests for campaign service layer (campaigns/service.py)."""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.campaigns.service import (
    _calculate_krippendorff_alpha,
    _calculate_pairwise_agreement,
    add_users_to_campaign_bulk,
    assign_reviewers_fixed,
    assign_reviewers_percentage,
    delete_campaign,
    demote_admin,
    list_campaigns_with_user_roles,
    make_admin,
    remove_user_from_campaign,
    update_campaign_bbox,
    update_campaign_name,
    update_campaign_visibility,
)


def _mock_db():
    db = MagicMock()
    db.scalars.return_value.all.return_value = []
    return db


class TestKrippendorffAlpha:
    """Pure-logic: no DB needed."""

    def test_empty_data_returns_none(self):
        assert _calculate_krippendorff_alpha({}) is None

    def test_single_annotator_returns_none(self):
        u1 = uuid4()
        data = {1: [(u1, 1)]}
        assert _calculate_krippendorff_alpha(data) is None

    def test_perfect_agreement(self):
        u1, u2 = uuid4(), uuid4()
        data = {
            1: [(u1, 1), (u2, 1)],
            2: [(u1, 2), (u2, 2)],
            3: [(u1, 1), (u2, 1)],
        }
        alpha = _calculate_krippendorff_alpha(data)
        assert alpha is not None
        assert alpha == pytest.approx(1.0)

    def test_complete_disagreement(self):
        u1, u2 = uuid4(), uuid4()
        data = {
            1: [(u1, 1), (u2, 2)],
            2: [(u1, 2), (u2, 1)],
        }
        alpha = _calculate_krippendorff_alpha(data)
        assert alpha is not None
        assert alpha < 0.0

    def test_same_label_everywhere_returns_none(self):
        u1, u2 = uuid4(), uuid4()
        data = {
            1: [(u1, 1), (u2, 1)],
            2: [(u1, 1), (u2, 1)],
        }
        assert _calculate_krippendorff_alpha(data) is None

    def test_skips_tasks_with_single_annotation(self):
        u1, u2 = uuid4(), uuid4()
        data = {
            1: [(u1, 1)],
            2: [(u1, 1), (u2, 2)],
            3: [(u1, 2), (u2, 1)],
        }
        alpha = _calculate_krippendorff_alpha(data)
        assert alpha is not None

    def test_three_annotators(self):
        u1, u2, u3 = uuid4(), uuid4(), uuid4()
        data = {
            1: [(u1, 1), (u2, 1), (u3, 1)],
            2: [(u1, 2), (u2, 2), (u3, 2)],
        }
        alpha = _calculate_krippendorff_alpha(data)
        assert alpha is not None
        assert alpha == pytest.approx(1.0)


class TestPairwiseAgreement:
    """Pure-logic: no DB needed."""

    def test_no_shared_tasks(self):
        u1, u2 = uuid4(), uuid4()
        data = {1: [(u1, 1)], 2: [(u2, 2)]}
        pct, shared = _calculate_pairwise_agreement(u1, u2, data)
        assert pct is None
        assert shared == 0

    def test_perfect_agreement(self):
        u1, u2 = uuid4(), uuid4()
        data = {
            1: [(u1, 1), (u2, 1)],
            2: [(u1, 2), (u2, 2)],
        }
        pct, shared = _calculate_pairwise_agreement(u1, u2, data)
        assert pct == 100.0
        assert shared == 2

    def test_zero_agreement(self):
        u1, u2 = uuid4(), uuid4()
        data = {
            1: [(u1, 1), (u2, 2)],
            2: [(u1, 2), (u2, 1)],
        }
        pct, shared = _calculate_pairwise_agreement(u1, u2, data)
        assert pct == 0.0
        assert shared == 2

    def test_partial_agreement(self):
        u1, u2 = uuid4(), uuid4()
        data = {
            1: [(u1, 1), (u2, 1)],
            2: [(u1, 1), (u2, 2)],
        }
        pct, shared = _calculate_pairwise_agreement(u1, u2, data)
        assert pct == 50.0
        assert shared == 2

    def test_ignores_none_labels(self):
        u1, u2 = uuid4(), uuid4()
        data = {
            1: [(u1, 1), (u2, None)],
            2: [(u1, 1), (u2, 1)],
        }
        pct, shared = _calculate_pairwise_agreement(u1, u2, data)
        assert shared == 1
        assert pct == 100.0


class TestUpdateCampaignName:
    def test_updates_name(self):
        db = _mock_db()
        campaign = MagicMock()
        campaign.name = "Old"
        db.get.return_value = campaign

        update_campaign_name(db, 1, "New")
        assert campaign.name == "New"
        db.commit.assert_called_once()

    def test_not_found_raises_404(self):
        db = _mock_db()
        db.get.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            update_campaign_name(db, 999, "New")
        assert exc_info.value.status_code == 404


class TestUpdateCampaignBbox:
    def test_updates_bbox_fields(self):
        db = _mock_db()
        settings = MagicMock()
        campaign = MagicMock()
        campaign.settings = settings
        db.get.return_value = campaign

        bbox = {"bbox_west": -10, "bbox_south": -20, "bbox_east": 10, "bbox_north": 20}
        update_campaign_bbox(db, 1, bbox)

        assert settings.bbox_west == -10
        assert settings.bbox_south == -20
        assert settings.bbox_east == 10
        assert settings.bbox_north == 20
        db.commit.assert_called_once()

    def test_missing_key_raises_422(self):
        db = _mock_db()
        campaign = MagicMock()
        campaign.settings = MagicMock()
        db.get.return_value = campaign

        with pytest.raises(HTTPException) as exc_info:
            update_campaign_bbox(db, 1, {"bbox_west": -10})
        assert exc_info.value.status_code == 422

    def test_no_settings_raises_404(self):
        db = _mock_db()
        campaign = MagicMock()
        campaign.settings = None
        db.get.return_value = campaign

        with pytest.raises(HTTPException) as exc_info:
            update_campaign_bbox(
                db, 1, {"bbox_west": -10, "bbox_south": -20, "bbox_east": 10, "bbox_north": 20}
            )
        assert exc_info.value.status_code == 404


class TestMakeAdmin:
    def test_user_not_in_campaign_raises_404(self):
        db = _mock_db()
        result_mock = MagicMock()
        result_mock.rowcount = 0
        db.execute.return_value = result_mock

        with pytest.raises(HTTPException) as exc_info:
            make_admin(db, 1, uuid4())
        assert exc_info.value.status_code == 404


class TestDemoteAdmin:
    def test_not_admin_raises_404(self):
        db = _mock_db()
        result_mock = MagicMock()
        result_mock.rowcount = 0
        db.execute.return_value = result_mock

        with pytest.raises(HTTPException) as exc_info:
            demote_admin(db, 1, uuid4())
        assert exc_info.value.status_code == 404


class TestRemoveUserFromCampaign:
    def test_user_not_assigned_raises_404(self):
        db = _mock_db()
        result_mock = MagicMock()
        result_mock.rowcount = 0
        db.execute.return_value = result_mock

        with pytest.raises(HTTPException) as exc_info:
            remove_user_from_campaign(db, 1, uuid4())
        assert exc_info.value.status_code == 404


class TestAddUsersToCampaignBulk:
    def test_missing_users_raises_404(self):
        db = _mock_db()
        u1, u2 = uuid4(), uuid4()
        found_user = MagicMock()
        found_user.id = u1
        db.scalars.return_value.all.return_value = [found_user]

        with pytest.raises(HTTPException) as exc_info:
            add_users_to_campaign_bulk(db, 1, [u1, u2])
        assert exc_info.value.status_code == 404


class TestDeleteCampaign:
    def test_not_found_raises_404(self):
        db = _mock_db()
        db.get.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            delete_campaign(db, 999)
        assert exc_info.value.status_code == 404


class TestAssignReviewersPercentage:
    def test_invalid_percentage_raises_400(self):
        db = _mock_db()
        with pytest.raises(HTTPException) as exc_info:
            assign_reviewers_percentage(db, 1, 0, 1, [uuid4()])
        assert exc_info.value.status_code == 400

    def test_too_few_reviewers_raises_400(self):
        db = _mock_db()
        with pytest.raises(HTTPException) as exc_info:
            assign_reviewers_percentage(db, 1, 50, 3, [uuid4()])
        assert exc_info.value.status_code == 400

    def test_zero_reviewers_raises_400(self):
        db = _mock_db()
        with pytest.raises(HTTPException) as exc_info:
            assign_reviewers_percentage(db, 1, 50, 0, [uuid4()])
        assert exc_info.value.status_code == 400


class TestAssignReviewersFixed:
    def test_zero_tasks_raises_400(self):
        db = _mock_db()
        with pytest.raises(HTTPException) as exc_info:
            assign_reviewers_fixed(db, 1, 0, 1, [uuid4()])
        assert exc_info.value.status_code == 400

    def test_too_few_reviewers_raises_400(self):
        db = _mock_db()
        with pytest.raises(HTTPException) as exc_info:
            assign_reviewers_fixed(db, 1, 5, 3, [uuid4()])
        assert exc_info.value.status_code == 400


class TestUpdateCampaignVisibility:
    def test_makes_campaign_public(self):
        db = _mock_db()
        campaign = MagicMock()
        campaign.is_public = False
        db.get.return_value = campaign

        update_campaign_visibility(db, 1, True)
        assert campaign.is_public is True
        db.commit.assert_called_once()

    def test_makes_campaign_private(self):
        db = _mock_db()
        campaign = MagicMock()
        campaign.is_public = True
        db.get.return_value = campaign

        update_campaign_visibility(db, 1, False)
        assert campaign.is_public is False
        db.commit.assert_called_once()

    def test_not_found_raises_404(self):
        db = _mock_db()
        db.get.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            update_campaign_visibility(db, 999, True)
        assert exc_info.value.status_code == 404


class TestListCampaignsVisibility:
    """Verify list_campaigns_with_user_roles respects public/private."""

    def _make_campaign(self, cid, is_public=False, members=None):
        campaign = MagicMock()
        campaign.id = cid
        campaign.is_public = is_public
        campaign.created_at = MagicMock()
        campaign.users = members or []
        return campaign

    def _make_member(self, user_id, is_admin=False):
        cu = MagicMock()
        cu.user_id = user_id
        cu.is_admin = is_admin
        return cu

    def test_regular_user_sees_public_and_member_campaigns(self):
        db = _mock_db()
        user_id = uuid4()

        member = self._make_member(user_id)
        private_member = self._make_campaign(1, is_public=False, members=[member])
        public_non_member = self._make_campaign(2, is_public=True, members=[])
        private_non_member = self._make_campaign(3, is_public=False, members=[])

        db.scalars.return_value.unique.return_value.all.return_value = [
            private_member,
            public_non_member,
            private_non_member,
        ]

        # Patch is_global_admin to return False
        import src.campaigns.service as svc

        original = svc.is_global_admin
        svc.is_global_admin = lambda db, uid: False
        try:
            results = list_campaigns_with_user_roles(db, user_id)
        finally:
            svc.is_global_admin = original

        campaign_ids = [r["campaign"].id for r in results]
        assert 1 in campaign_ids  # member
        assert 2 in campaign_ids  # public
        assert 3 not in campaign_ids  # private, not member

    def test_regular_user_not_member_of_public_campaign(self):
        db = _mock_db()
        user_id = uuid4()

        public_campaign = self._make_campaign(1, is_public=True, members=[])
        db.scalars.return_value.unique.return_value.all.return_value = [public_campaign]

        import src.campaigns.service as svc

        original = svc.is_global_admin
        svc.is_global_admin = lambda db, uid: False
        try:
            results = list_campaigns_with_user_roles(db, user_id)
        finally:
            svc.is_global_admin = original

        assert len(results) == 1
        assert results[0]["is_member"] is False
        assert results[0]["is_admin"] is False

    def test_platform_admin_sees_all_campaigns(self):
        db = _mock_db()
        user_id = uuid4()

        private_campaign = self._make_campaign(1, is_public=False, members=[])
        public_campaign = self._make_campaign(2, is_public=True, members=[])
        db.scalars.return_value.unique.return_value.all.return_value = [
            private_campaign,
            public_campaign,
        ]

        import src.campaigns.service as svc

        original = svc.is_global_admin
        svc.is_global_admin = lambda db, uid: True
        try:
            results = list_campaigns_with_user_roles(db, user_id)
        finally:
            svc.is_global_admin = original

        assert len(results) == 2

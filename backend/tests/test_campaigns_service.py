"""Tests for campaign service layer (campaigns/service.py)."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.annotation.constants import ANNOTATION_TASK_STATUS_PENDING
from src.annotation.models import AnnotationTaskAssignment
from src.campaigns.models import CampaignUser
from src.campaigns.schemas import AssignTasksToUsersRequest
from src.campaigns.service import (
    _calculate_krippendorff_alpha,
    _calculate_pairwise_agreement,
    _distribute_evenly,
    _distribute_fixed,
    add_users_to_campaign_bulk,
    assign_reviewers_fixed,
    assign_reviewers_manual,
    assign_reviewers_percentage,
    assign_tasks_to_users,
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

        update_campaign_bbox(db, 1, -10, -20, 10, 20)

        assert settings.bbox_west == -10
        assert settings.bbox_south == -20
        assert settings.bbox_east == 10
        assert settings.bbox_north == 20
        db.commit.assert_called_once()

    def test_no_settings_raises_404(self):
        db = _mock_db()
        campaign = MagicMock()
        campaign.settings = None
        db.get.return_value = campaign

        with pytest.raises(HTTPException) as exc_info:
            update_campaign_bbox(db, 1, -10, -20, 10, 20)
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
        db.scalar.return_value = None  # user is not an admin — guard passes through

        with pytest.raises(HTTPException) as exc_info:
            demote_admin(db, 1, uuid4())
        assert exc_info.value.status_code == 404


class TestRemoveUserFromCampaign:
    def test_user_not_assigned_raises_404(self):
        db = _mock_db()
        result_mock = MagicMock()
        result_mock.rowcount = 0
        db.execute.return_value = result_mock
        db.scalar.return_value = None  # user is not a member — guard passes through

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

    def test_all_found_creates_one_membership_per_user(self):
        db = _mock_db()
        u1, u2 = uuid4(), uuid4()
        user_a, user_b = MagicMock(id=u1), MagicMock(id=u2)
        db.scalars.return_value.all.return_value = [user_a, user_b]

        add_users_to_campaign_bulk(db, campaign_id=42, user_ids=[u1, u2])

        db.add_all.assert_called_once()
        memberships = db.add_all.call_args[0][0]
        assert len(memberships) == 2
        assert all(isinstance(m, CampaignUser) for m in memberships)
        for m in memberships:
            assert m.campaign_id == 42
            assert m.is_admin is False
            assert m.is_authorative_reviewer is False
        assert {m.user_id for m in memberships} == {u1, u2}
        db.commit.assert_called_once()


class TestDeleteCampaign:
    def test_not_found_raises_404(self):
        db = _mock_db()
        db.get.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            delete_campaign(db, 999)
        assert exc_info.value.status_code == 404


def _stub_scalars(db, results_in_order):
    """Make db.scalars(...).all() return each list in order across calls."""
    calls = {"i": 0}

    def _scalars_side_effect(*_args, **_kwargs):
        chain = MagicMock()
        i = calls["i"]
        calls["i"] += 1
        chain.all.return_value = results_in_order[i] if i < len(results_in_order) else []
        return chain

    db.scalars.side_effect = _scalars_side_effect


def _make_campaign_user_rows(campaign_id, user_ids):
    return [MagicMock(spec=CampaignUser, user_id=uid, campaign_id=campaign_id) for uid in user_ids]


def _make_tasks(task_ids):
    return [MagicMock(id=tid) for tid in task_ids]


def _make_assignment(task_id, user_id, is_review=False):
    return MagicMock(
        spec=AnnotationTaskAssignment, task_id=task_id, user_id=user_id, is_review=is_review
    )


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

    def test_no_tasks_in_campaign_raises_404(self):
        db = _mock_db()
        u1 = uuid4()
        _stub_scalars(
            db,
            [
                _make_campaign_user_rows(campaign_id=1, user_ids=[u1]),
                [],
            ],
        )

        with pytest.raises(HTTPException) as exc_info:
            assign_reviewers_percentage(db, 1, percentage=50, num_reviewers=1, reviewer_ids=[u1])
        assert exc_info.value.status_code == 404

    def test_reviewer_not_a_campaign_member_raises_400(self):
        db = _mock_db()
        u_in, u_out = uuid4(), uuid4()
        _stub_scalars(
            db,
            [_make_campaign_user_rows(campaign_id=1, user_ids=[u_in])],
        )

        with pytest.raises(HTTPException) as exc_info:
            assign_reviewers_percentage(
                db, 1, percentage=50, num_reviewers=1, reviewer_ids=[u_in, u_out]
            )
        assert exc_info.value.status_code == 400

    def test_assigns_reviewer_to_at_least_one_task(self):
        db = _mock_db()
        u1 = uuid4()
        tasks = _make_tasks([10, 20, 30])
        _stub_scalars(
            db,
            [
                _make_campaign_user_rows(campaign_id=1, user_ids=[u1]),
                tasks,
                [],
            ],
        )

        with patch("src.campaigns.service._seed_assignment_status", return_value={}):
            assign_reviewers_percentage(db, 1, percentage=100, num_reviewers=1, reviewer_ids=[u1])

        added = [c.args[0] for c in db.add.call_args_list]
        assignments = [a for a in added if isinstance(a, AnnotationTaskAssignment)]
        assert {a.task_id for a in assignments} == {10, 20, 30}
        assert all(a.user_id == u1 for a in assignments)
        assert all(a.status == ANNOTATION_TASK_STATUS_PENDING for a in assignments)
        assert all(a.is_review is True for a in assignments)
        db.commit.assert_called_once()

    def test_existing_assignment_is_not_duplicated(self):
        db = _mock_db()
        u1 = uuid4()
        tasks = _make_tasks([10])
        existing = _make_assignment(task_id=10, user_id=u1)
        _stub_scalars(
            db,
            [
                _make_campaign_user_rows(campaign_id=1, user_ids=[u1]),
                tasks,
                [existing],
            ],
        )

        with patch("src.campaigns.service._seed_assignment_status", return_value={}):
            assign_reviewers_percentage(db, 1, percentage=100, num_reviewers=1, reviewer_ids=[u1])

        added = [c.args[0] for c in db.add.call_args_list]
        assignments = [a for a in added if isinstance(a, AnnotationTaskAssignment)]
        assert assignments == []
        db.commit.assert_called_once()

    def test_original_assignee_never_reviews_own_task(self):
        """Assignee in the pool must not be picked as reviewer for their own tasks."""
        db = _mock_db()
        annotator, r1, r2 = uuid4(), uuid4(), uuid4()
        tasks = _make_tasks([10, 20, 30])
        existing = [
            _make_assignment(task_id=tid, user_id=annotator, is_review=False)
            for tid in [10, 20, 30]
        ]
        _stub_scalars(
            db,
            [
                _make_campaign_user_rows(campaign_id=1, user_ids=[annotator, r1, r2]),
                tasks,
                existing,
            ],
        )

        with patch("src.campaigns.service._seed_assignment_status", return_value={}):
            assign_reviewers_percentage(
                db, 1, percentage=100, num_reviewers=2, reviewer_ids=[annotator, r1, r2]
            )

        added = [c.args[0] for c in db.add.call_args_list]
        assignments = [a for a in added if isinstance(a, AnnotationTaskAssignment)]
        assert all(a.user_id != annotator for a in assignments), (
            "Original annotator was assigned as a reviewer for their own task"
        )

    def test_pool_with_assignee_still_fills_num_reviewers(self):
        """
        3-person pool (original annotator + 2 others), num_reviewers=2.
        Every task must receive exactly 2 new reviewers - not 1 - because the
        assignee is excluded from the eligible pool *before* sampling.
        """
        db = _mock_db()
        annotator, r1, r2 = uuid4(), uuid4(), uuid4()
        tasks = _make_tasks([10, 20, 30])
        existing = [
            _make_assignment(task_id=tid, user_id=annotator, is_review=False)
            for tid in [10, 20, 30]
        ]
        _stub_scalars(
            db,
            [
                _make_campaign_user_rows(campaign_id=1, user_ids=[annotator, r1, r2]),
                tasks,
                existing,
            ],
        )

        with patch("src.campaigns.service._seed_assignment_status", return_value={}):
            assign_reviewers_percentage(
                db, 1, percentage=100, num_reviewers=2, reviewer_ids=[annotator, r1, r2]
            )

        added = [c.args[0] for c in db.add.call_args_list]
        new_assignments = [a for a in added if isinstance(a, AnnotationTaskAssignment)]

        # Each task should get exactly 2 new reviewers (r1 and r2)
        from collections import Counter

        per_task = Counter(a.task_id for a in new_assignments)
        assert set(per_task.keys()) == {10, 20, 30}
        assert all(count == 2 for count in per_task.values()), (
            f"Expected 2 new reviewers per task, got: {dict(per_task)}"
        )
        # Total assignments per task = 1 original + 2 reviewers = 3
        assert len(new_assignments) == 6  # 3 tasks × 2 reviewers


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

    def test_more_tasks_requested_than_exist_raises_400(self):
        db = _mock_db()
        u1 = uuid4()
        _stub_scalars(
            db,
            [
                _make_campaign_user_rows(campaign_id=1, user_ids=[u1]),
                _make_tasks([10, 20]),
            ],
        )

        with pytest.raises(HTTPException) as exc_info:
            assign_reviewers_fixed(db, 1, num_tasks=5, num_reviewers=1, reviewer_ids=[u1])
        assert exc_info.value.status_code == 400

    def test_assigns_exactly_num_tasks_with_one_reviewer_each(self):
        db = _mock_db()
        u1 = uuid4()
        _stub_scalars(
            db,
            [
                _make_campaign_user_rows(campaign_id=1, user_ids=[u1]),
                _make_tasks([10, 20, 30]),
                [],
            ],
        )

        with patch("src.campaigns.service._seed_assignment_status", return_value={}):
            assign_reviewers_fixed(db, 1, num_tasks=2, num_reviewers=1, reviewer_ids=[u1])

        added = [c.args[0] for c in db.add.call_args_list]
        assignments = [a for a in added if isinstance(a, AnnotationTaskAssignment)]
        assert len(assignments) == 2
        assert len({a.task_id for a in assignments}) == 2
        assert all(a.task_id in {10, 20, 30} for a in assignments)
        assert all(a.user_id == u1 for a in assignments)
        db.commit.assert_called_once()

    def test_original_assignee_never_reviews_own_task(self):
        """Assignee in the pool must not be picked as reviewer for their own tasks."""
        db = _mock_db()
        annotator, r1, r2 = uuid4(), uuid4(), uuid4()
        tasks = _make_tasks([10, 20, 30])
        existing = [
            _make_assignment(task_id=tid, user_id=annotator, is_review=False)
            for tid in [10, 20, 30]
        ]
        _stub_scalars(
            db,
            [
                _make_campaign_user_rows(campaign_id=1, user_ids=[annotator, r1, r2]),
                tasks,
                existing,
            ],
        )

        with patch("src.campaigns.service._seed_assignment_status", return_value={}):
            assign_reviewers_fixed(
                db, 1, num_tasks=3, num_reviewers=2, reviewer_ids=[annotator, r1, r2]
            )

        added = [c.args[0] for c in db.add.call_args_list]
        assignments = [a for a in added if isinstance(a, AnnotationTaskAssignment)]
        assert all(a.user_id != annotator for a in assignments), (
            "Original annotator was assigned as a reviewer for their own task"
        )

    def test_pool_with_assignee_still_fills_num_reviewers(self):
        """
        3-person pool (original annotator + 2 others), num_reviewers=2.
        Every selected task must receive exactly 2 new reviewers, not 1.
        """
        db = _mock_db()
        annotator, r1, r2 = uuid4(), uuid4(), uuid4()
        tasks = _make_tasks([10, 20, 30])
        existing = [
            _make_assignment(task_id=tid, user_id=annotator, is_review=False)
            for tid in [10, 20, 30]
        ]
        _stub_scalars(
            db,
            [
                _make_campaign_user_rows(campaign_id=1, user_ids=[annotator, r1, r2]),
                tasks,
                existing,
            ],
        )

        with patch("src.campaigns.service._seed_assignment_status", return_value={}):
            assign_reviewers_fixed(
                db, 1, num_tasks=3, num_reviewers=2, reviewer_ids=[annotator, r1, r2]
            )

        added = [c.args[0] for c in db.add.call_args_list]
        new_assignments = [a for a in added if isinstance(a, AnnotationTaskAssignment)]

        from collections import Counter

        per_task = Counter(a.task_id for a in new_assignments)
        assert set(per_task.keys()) == {10, 20, 30}
        assert all(count == 2 for count in per_task.values()), (
            f"Expected 2 new reviewers per task, got: {dict(per_task)}"
        )
        assert len(new_assignments) == 6  # 3 tasks × 2 reviewers


class TestReviewerTopUp:
    def test_tops_up_to_target_not_beyond(self):
        """Task with annotator + 1 existing reviewer, target 2 -> exactly 1 added."""
        db = _mock_db()
        annotator, r1, r2, r3 = uuid4(), uuid4(), uuid4(), uuid4()
        existing = [
            _make_assignment(task_id=10, user_id=annotator, is_review=False),
            _make_assignment(task_id=10, user_id=r1, is_review=True),
        ]
        _stub_scalars(
            db,
            [
                _make_campaign_user_rows(campaign_id=1, user_ids=[annotator, r1, r2, r3]),
                _make_tasks([10]),
                existing,
            ],
        )

        with patch("src.campaigns.service._seed_assignment_status", return_value={}):
            assign_reviewers_percentage(
                db, 1, percentage=100, num_reviewers=2, reviewer_ids=[annotator, r1, r2, r3]
            )

        added = [c.args[0] for c in db.add.call_args_list]
        new_assignments = [a for a in added if isinstance(a, AnnotationTaskAssignment)]
        assert len(new_assignments) == 1
        assert new_assignments[0].task_id == 10
        assert new_assignments[0].user_id in {r2, r3}
        assert new_assignments[0].is_review is True

    def test_idempotent_when_target_already_met(self):
        """Task already has 2 reviewers, target 2 -> nothing added."""
        db = _mock_db()
        annotator, r1, r2 = uuid4(), uuid4(), uuid4()
        existing = [
            _make_assignment(task_id=10, user_id=annotator, is_review=False),
            _make_assignment(task_id=10, user_id=r1, is_review=True),
            _make_assignment(task_id=10, user_id=r2, is_review=True),
        ]
        _stub_scalars(
            db,
            [
                _make_campaign_user_rows(campaign_id=1, user_ids=[annotator, r1, r2]),
                _make_tasks([10]),
                existing,
            ],
        )

        with patch("src.campaigns.service._seed_assignment_status", return_value={}):
            assign_reviewers_percentage(
                db, 1, percentage=100, num_reviewers=2, reviewer_ids=[annotator, r1, r2]
            )

        added = [c.args[0] for c in db.add.call_args_list]
        new_assignments = [a for a in added if isinstance(a, AnnotationTaskAssignment)]
        assert new_assignments == []

    def test_no_reviewable_tasks_raises_404(self):
        """Campaign has no task with a primary assignment -> 404."""
        db = _mock_db()
        u1 = uuid4()
        _stub_scalars(
            db,
            [
                _make_campaign_user_rows(campaign_id=1, user_ids=[u1]),
                [],  # _reviewable_tasks returns nothing
            ],
        )

        with pytest.raises(HTTPException) as exc_info:
            assign_reviewers_percentage(db, 1, percentage=50, num_reviewers=1, reviewer_ids=[u1])
        assert exc_info.value.status_code == 404


class TestAssignReviewersManual:
    def test_assigns_reviewers_with_is_review_flag(self):
        db = _mock_db()
        u1, u2 = uuid4(), uuid4()
        _stub_scalars(
            db,
            [
                [u1, u2],  # _verify_campaign_members: found user_ids
                [10, 20],  # _verify_tasks_in_campaign: found task ids
                _make_tasks([10, 20]),  # _reviewable_tasks
            ],
        )
        db.execute.return_value.all.return_value = []  # _filter_new_pairs: no existing pairs

        with patch("src.campaigns.service._seed_assignment_status", return_value={}):
            created = assign_reviewers_manual(db, 1, {10: [u1], 20: [u2]})

        added = [c.args[0] for c in db.add.call_args_list]
        assignments = [a for a in added if isinstance(a, AnnotationTaskAssignment)]
        assert created == 2
        assert {(a.task_id, a.user_id) for a in assignments} == {(10, u1), (20, u2)}
        assert all(a.is_review is True for a in assignments)

    def test_task_without_primary_assignment_raises_400(self):
        db = _mock_db()
        u1 = uuid4()
        _stub_scalars(
            db,
            [
                [u1],  # members found
                [10, 20],  # tasks in campaign
                _make_tasks([10]),  # only task 10 has a primary assignment
            ],
        )

        with pytest.raises(HTTPException) as exc_info:
            assign_reviewers_manual(db, 1, {10: [u1], 20: [u1]})
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


class TestDistributeEvenly:
    def test_round_robins_all_tasks(self):
        u1, u2 = uuid4(), uuid4()
        result = _distribute_evenly([10, 20, 30, 40, 50], [u1, u2])
        assert result == {10: [u1], 20: [u2], 30: [u1], 40: [u2], 50: [u1]}

    def test_every_task_assigned_exactly_once(self):
        users = [uuid4() for _ in range(3)]
        result = _distribute_evenly(list(range(20)), users)
        assert len(result) == 20
        counts = {}
        for [uid] in result.values():
            counts[uid] = counts.get(uid, 0) + 1
        # 20 tasks across 3 users -> 7, 7, 6
        assert sorted(counts.values()) == [6, 7, 7]

    def test_empty_inputs_return_empty(self):
        assert _distribute_evenly([], [uuid4()]) == {}
        assert _distribute_evenly([1, 2], []) == {}


class TestDistributeFixed:
    def test_gives_each_user_their_count(self):
        u1, u2 = uuid4(), uuid4()
        result = _distribute_fixed([10, 20, 30, 40, 50], {u1: 2, u2: 2})
        assert result == {10: [u1], 20: [u1], 30: [u2], 40: [u2]}

    def test_stops_when_pool_exhausted(self):
        u1, u2 = uuid4(), uuid4()
        result = _distribute_fixed([10, 20], {u1: 5, u2: 5})
        assert result == {10: [u1], 20: [u1]}

    def test_empty_pool_returns_empty(self):
        assert _distribute_fixed([], {uuid4(): 3}) == {}


class TestAssignTasksToUsers:
    def test_even_without_users_raises_400(self):
        db = _mock_db()
        req = AssignTasksToUsersRequest(strategy="even", user_ids=[])
        with pytest.raises(HTTPException) as exc_info:
            assign_tasks_to_users(db, 1, req)
        assert exc_info.value.status_code == 400

    def test_fixed_without_counts_raises_400(self):
        db = _mock_db()
        req = AssignTasksToUsersRequest(strategy="fixed_per_user", user_task_counts=None)
        with pytest.raises(HTTPException) as exc_info:
            assign_tasks_to_users(db, 1, req)
        assert exc_info.value.status_code == 400

"""Tests for project membership guards and visibility side effects
(projects/service.py). Mirrors the campaign-level membership tests that used
to live in test_campaigns_service.py before that logic moved to the project."""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.campaigns.schemas import default_labelling_policy
from src.projects.models import ProjectUser
from src.projects.service import (
    add_users_by_ids,
    demote_admin,
    demote_authoritative_reviewer,
    make_admin,
    make_authoritative_reviewer,
    remove_user,
    update_project,
)


def _mock_db():
    db = MagicMock()
    db.scalars.return_value.all.return_value = []
    return db


class TestMakeAdmin:
    def test_user_not_a_member_raises_404(self):
        db = _mock_db()
        db.get.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            make_admin(db, 1, uuid4())
        assert exc_info.value.status_code == 404
        assert "not a member" in exc_info.value.detail

    def test_sets_is_admin_and_commits(self):
        db = _mock_db()
        membership = MagicMock(is_admin=False)
        db.get.return_value = membership

        make_admin(db, 1, uuid4())

        assert membership.is_admin is True
        db.commit.assert_called_once()


class TestMakeAuthoritativeReviewer:
    def test_user_not_a_member_raises_404(self):
        db = _mock_db()
        db.get.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            make_authoritative_reviewer(db, 1, uuid4())
        assert exc_info.value.status_code == 404
        assert "not a member" in exc_info.value.detail

    def test_sets_flag_and_commits(self):
        db = _mock_db()
        membership = MagicMock(is_authoritative_reviewer=False)
        db.get.return_value = membership

        make_authoritative_reviewer(db, 1, uuid4())

        assert membership.is_authoritative_reviewer is True
        db.commit.assert_called_once()


class TestDemoteAuthoritativeReviewer:
    def test_user_not_a_member_raises_404(self):
        db = _mock_db()
        db.get.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            demote_authoritative_reviewer(db, 1, uuid4())
        assert exc_info.value.status_code == 404
        assert "not a member" in exc_info.value.detail

    def test_clears_flag_and_commits(self):
        db = _mock_db()
        membership = MagicMock(is_authoritative_reviewer=True)
        db.get.return_value = membership

        demote_authoritative_reviewer(db, 1, uuid4())

        assert membership.is_authoritative_reviewer is False
        db.commit.assert_called_once()


class TestDemoteAdmin:
    def test_user_not_a_member_raises_404(self):
        db = _mock_db()
        db.get.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            demote_admin(db, 1, uuid4())
        assert exc_info.value.status_code == 404
        assert "not a member" in exc_info.value.detail

    def test_sole_admin_raises_409(self):
        db = _mock_db()
        membership = MagicMock(is_admin=True)
        db.get.return_value = membership
        db.scalar.return_value = 1  # only one admin on the project

        with pytest.raises(HTTPException) as exc_info:
            demote_admin(db, 1, uuid4())
        assert exc_info.value.status_code == 409
        assert "last project admin" in exc_info.value.detail
        db.commit.assert_not_called()

    def test_succeeds_when_another_admin_exists(self):
        db = _mock_db()
        membership = MagicMock(is_admin=True)
        db.get.return_value = membership
        db.scalar.return_value = 2  # a second admin still stands

        demote_admin(db, 1, uuid4())

        assert membership.is_admin is False
        db.commit.assert_called_once()

    def test_demoting_non_admin_member_skips_last_admin_guard(self):
        """The guard reads membership.is_admin before ever counting admins, so
        demoting a non-admin member never touches db.scalar."""
        db = _mock_db()
        membership = MagicMock(is_admin=False)
        db.get.return_value = membership

        demote_admin(db, 1, uuid4())

        assert membership.is_admin is False
        db.commit.assert_called_once()
        db.scalar.assert_not_called()


class TestRemoveUser:
    def test_user_not_a_member_raises_404(self):
        db = _mock_db()
        db.get.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            remove_user(db, 1, uuid4())
        assert exc_info.value.status_code == 404
        assert "not a member" in exc_info.value.detail

    def test_sole_admin_raises_409(self):
        db = _mock_db()
        membership = MagicMock(is_admin=True)
        db.get.return_value = membership
        db.scalar.return_value = 1

        with pytest.raises(HTTPException) as exc_info:
            remove_user(db, 1, uuid4())
        assert exc_info.value.status_code == 409
        assert "last project admin" in exc_info.value.detail
        db.delete.assert_not_called()

    def test_succeeds_when_another_admin_exists(self):
        db = _mock_db()
        membership = MagicMock(is_admin=True)
        db.get.return_value = membership
        db.scalar.return_value = 2

        remove_user(db, 1, uuid4())

        db.delete.assert_called_once_with(membership)
        db.commit.assert_called_once()

    def test_removing_non_admin_member_skips_last_admin_guard(self):
        db = _mock_db()
        membership = MagicMock(is_admin=False)
        db.get.return_value = membership

        remove_user(db, 1, uuid4())

        db.delete.assert_called_once_with(membership)
        db.commit.assert_called_once()
        db.scalar.assert_not_called()


class TestAddUsersByIds:
    def test_missing_users_raises_404(self):
        db = _mock_db()
        u1, u2 = uuid4(), uuid4()
        found_user = MagicMock(id=u1)
        db.scalars.return_value.all.return_value = [found_user]

        with pytest.raises(HTTPException) as exc_info:
            add_users_by_ids(db, 1, [u1, u2])
        assert exc_info.value.status_code == 404
        assert str(u2) in exc_info.value.detail

    def test_existing_member_is_skipped_without_error(self):
        db = _mock_db()
        u1 = uuid4()
        found_user = MagicMock(id=u1)
        db.scalars.return_value.all.return_value = [found_user]
        db.get.return_value = MagicMock()  # already a ProjectUser row

        add_users_by_ids(db, 1, [u1])

        db.add.assert_not_called()
        db.commit.assert_called_once()

    def test_new_members_added_as_non_admin_non_reviewer(self):
        db = _mock_db()
        u1, u2 = uuid4(), uuid4()
        user_a, user_b = MagicMock(id=u1), MagicMock(id=u2)
        db.scalars.return_value.all.return_value = [user_a, user_b]
        db.get.return_value = None  # neither is a member yet

        add_users_by_ids(db, project_id=42, user_ids=[u1, u2])

        added = [call.args[0] for call in db.add.call_args_list]
        assert len(added) == 2
        assert all(isinstance(m, ProjectUser) for m in added)
        for m in added:
            assert m.project_id == 42
            assert m.is_admin is False
            assert m.is_authoritative_reviewer is False
        assert {m.user_id for m in added} == {u1, u2}
        db.commit.assert_called_once()


class TestUpdateProjectVisibility:
    """Verify update_project's public->private transition strips 'anyone'
    from every campaign's stored labelling policy, matching the invariant
    the campaign-level update_campaign_visibility used to enforce directly."""

    def _project(self, db, is_public, campaigns=None):
        project = MagicMock()
        project.is_public = is_public
        project.campaigns = campaigns or []
        db.get.return_value = project
        return project

    def _campaign_with_policy(self, is_public=True):
        campaign = MagicMock()
        campaign.settings.labelling_policy = default_labelling_policy(
            is_public=is_public
        ).model_dump(mode="json")
        return campaign

    def test_public_to_private_strips_anyone_from_every_campaign(self):
        db = _mock_db()
        campaign = self._campaign_with_policy(is_public=True)
        self._project(db, is_public=True, campaigns=[campaign])

        update_project(db, 1, is_public=False)

        policy = campaign.settings.labelling_policy
        assert "anyone" not in policy["explore"]["kinds"]
        assert "anyone" not in policy["unassigned_tasks"]["kinds"]
        assert "anyone" not in policy["assigned_tasks"]["kinds"]
        assert policy["explore"]["kinds"] == ["members"]
        # complete_assigned never had 'anyone' to begin with; unaffected.
        assert set(policy["complete_assigned"]["kinds"]) == {
            "assignees",
            "admins",
            "authoritative",
        }
        db.commit.assert_called_once()

    def test_public_to_private_strips_across_multiple_campaigns(self):
        db = _mock_db()
        c1 = self._campaign_with_policy(is_public=True)
        c2 = self._campaign_with_policy(is_public=True)
        self._project(db, is_public=True, campaigns=[c1, c2])

        update_project(db, 1, is_public=False)

        for campaign in (c1, c2):
            assert "anyone" not in campaign.settings.labelling_policy["explore"]["kinds"]

    def test_already_private_to_private_does_not_touch_policy(self):
        db = _mock_db()
        campaign = self._campaign_with_policy(is_public=True)
        original = dict(campaign.settings.labelling_policy)
        self._project(db, is_public=False, campaigns=[campaign])

        update_project(db, 1, is_public=False)

        assert campaign.settings.labelling_policy == original

    def test_flipping_to_public_does_not_strip_policy(self):
        db = _mock_db()
        campaign = self._campaign_with_policy(is_public=False)
        original = dict(campaign.settings.labelling_policy)
        self._project(db, is_public=False, campaigns=[campaign])

        update_project(db, 1, is_public=True)

        assert campaign.settings.labelling_policy == original

    def test_is_public_none_leaves_visibility_untouched(self):
        db = _mock_db()
        campaign = self._campaign_with_policy(is_public=True)
        original = dict(campaign.settings.labelling_policy)
        project = self._project(db, is_public=True, campaigns=[campaign])

        update_project(db, 1, name="New name")

        assert project.is_public is True
        assert campaign.settings.labelling_policy == original
        assert project.name == "New name"

    def test_not_found_raises_404(self):
        db = _mock_db()
        db.get.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            update_project(db, 999, is_public=True)
        assert exc_info.value.status_code == 404

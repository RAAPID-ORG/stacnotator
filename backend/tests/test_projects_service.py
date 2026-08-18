"""Tests for project membership guards and visibility side effects
(projects/service.py). Mirrors the campaign-level membership tests that used
to live in test_campaigns_service.py before that logic moved to the project."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.campaigns.schemas import default_labelling_policy
from src.organizations.models import Invite
from src.projects.models import ProjectUser
from src.projects.service import (
    add_users_by_email,
    add_users_by_ids,
    demote_admin,
    demote_authoritative_reviewer,
    list_project_campaigns,
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


class TestAddUsersByEmail:
    def test_unknown_emails_become_project_invites(self):
        db = _mock_db()
        inviter = uuid4()
        db.scalars.return_value.all.side_effect = [[], []]  # no users, no pending invites

        added, invited = add_users_by_email(db, 7, ["new@x.org"], invited_by=inviter)

        assert added == []
        assert invited == ["new@x.org"]
        [invite] = [c.args[0] for c in db.add.call_args_list if isinstance(c.args[0], Invite)]
        assert (invite.email, invite.project_id, invite.organization_id) == ("new@x.org", 7, None)
        assert invite.invited_by == inviter
        db.commit.assert_called_once()


class TestUpdateProjectVisibility:
    """Verify update_project strips 'anyone' from every campaign's stored
    labelling policy whenever visibility leaves 'public' (to 'organization'
    OR 'private'), matching the invariant update_campaign_visibility used to
    enforce directly."""

    def _project(self, db, visibility, campaigns=None):
        project = MagicMock()
        project.visibility = visibility
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
        self._project(db, visibility="public", campaigns=[campaign])

        update_project(db, 1, visibility="private")

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

    def test_public_to_org_public_also_strips_anyone(self):
        db = _mock_db()
        campaign = self._campaign_with_policy(is_public=True)
        self._project(db, visibility="public", campaigns=[campaign])

        update_project(db, 1, visibility="organization")

        assert "anyone" not in campaign.settings.labelling_policy["explore"]["kinds"]

    def test_public_to_private_strips_across_multiple_campaigns(self):
        db = _mock_db()
        c1 = self._campaign_with_policy(is_public=True)
        c2 = self._campaign_with_policy(is_public=True)
        self._project(db, visibility="public", campaigns=[c1, c2])

        update_project(db, 1, visibility="private")

        for campaign in (c1, c2):
            assert "anyone" not in campaign.settings.labelling_policy["explore"]["kinds"]

    def test_already_private_to_private_does_not_touch_policy(self):
        db = _mock_db()
        campaign = self._campaign_with_policy(is_public=True)
        original = dict(campaign.settings.labelling_policy)
        self._project(db, visibility="private", campaigns=[campaign])

        update_project(db, 1, visibility="private")

        assert campaign.settings.labelling_policy == original

    def test_org_public_to_private_does_not_strip_policy(self):
        # 'anyone' could never be stored while org-public; nothing to strip.
        db = _mock_db()
        campaign = self._campaign_with_policy(is_public=False)
        original = dict(campaign.settings.labelling_policy)
        self._project(db, visibility="organization", campaigns=[campaign])

        update_project(db, 1, visibility="private")

        assert campaign.settings.labelling_policy == original

    def test_flipping_to_public_does_not_strip_policy(self):
        db = _mock_db()
        campaign = self._campaign_with_policy(is_public=False)
        original = dict(campaign.settings.labelling_policy)
        self._project(db, visibility="private", campaigns=[campaign])

        update_project(db, 1, visibility="public")

        assert campaign.settings.labelling_policy == original

    def test_visibility_none_leaves_visibility_untouched(self):
        db = _mock_db()
        campaign = self._campaign_with_policy(is_public=True)
        original = dict(campaign.settings.labelling_policy)
        project = self._project(db, visibility="public", campaigns=[campaign])

        update_project(db, 1, name="New name")

        assert project.visibility == "public"
        assert campaign.settings.labelling_policy == original
        assert project.name == "New name"

    def test_not_found_raises_404(self):
        db = _mock_db()
        db.get.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            update_project(db, 999, visibility="public")
        assert exc_info.value.status_code == 404


class TestListProjectCampaigns:
    def _campaign(self, campaign_id: int, created_at: datetime) -> SimpleNamespace:
        return SimpleNamespace(
            id=campaign_id,
            name=f"Campaign {campaign_id}",
            created_at=created_at,
            registration_status="ready",
            embedding_status="ready",
        )

    def _project(self, visibility="private"):
        return SimpleNamespace(id=4, visibility=visibility, organization_id=5)

    def _db_with(self, db, campaigns, membership, org_membership=None):
        db.scalars.return_value.all.return_value = campaigns
        # is_active_org_member (org-public projects only) reads db.scalars().first().
        db.scalars.return_value.first.return_value = org_membership
        db.get.return_value = membership

    def test_maps_campaigns_with_project_visibility(self):
        db = _mock_db()
        project = self._project("public")
        user = SimpleNamespace(id=uuid4(), is_admin=False)
        self._db_with(db, [self._campaign(1, datetime(2026, 1, 1))], ProjectUser(is_admin=False))

        items = list_project_campaigns(db, project, user)

        assert [i.id for i in items] == [1]
        assert items[0].project_id == 4
        assert items[0].is_public is True
        assert items[0].is_member is True
        assert items[0].is_admin is False
        assert items[0].registration_status == "ready"

    def test_project_admin_membership_marks_is_admin(self):
        db = _mock_db()
        project = self._project("private")
        user = SimpleNamespace(id=uuid4(), is_admin=False)
        self._db_with(db, [self._campaign(1, datetime(2026, 1, 1))], ProjectUser(is_admin=True))

        items = list_project_campaigns(db, project, user)

        assert items[0].is_admin is True
        assert items[0].is_member is True

    def test_non_member_on_public_project_is_neither_member_nor_admin(self):
        db = _mock_db()
        project = self._project("public")
        user = SimpleNamespace(id=uuid4(), is_admin=False)
        self._db_with(db, [self._campaign(1, datetime(2026, 1, 1))], None)

        items = list_project_campaigns(db, project, user)

        assert items[0].is_member is False
        assert items[0].is_admin is False

    def test_org_member_on_org_public_project_is_member_without_admin(self):
        db = _mock_db()
        project = self._project("organization")
        user = SimpleNamespace(id=uuid4(), is_admin=False)
        self._db_with(
            db, [self._campaign(1, datetime(2026, 1, 1))], None, org_membership=SimpleNamespace()
        )

        items = list_project_campaigns(db, project, user)

        assert items[0].is_member is True
        assert items[0].is_admin is False
        assert items[0].is_public is False

    def test_platform_admin_is_member_and_admin_without_membership(self):
        db = _mock_db()
        project = self._project("private")
        user = SimpleNamespace(id=uuid4(), is_admin=True)
        self._db_with(db, [self._campaign(1, datetime(2026, 1, 1))], None)

        items = list_project_campaigns(db, project, user)

        assert items[0].is_member is True
        assert items[0].is_admin is True

    def test_queries_project_campaigns_newest_first(self):
        db = _mock_db()
        project = self._project("private")
        user = SimpleNamespace(id=uuid4(), is_admin=False)
        self._db_with(db, [], ProjectUser(is_admin=False))

        list_project_campaigns(db, project, user)

        statement = str(db.scalars.call_args.args[0])
        assert "campaigns.project_id = " in statement
        assert statement.endswith("ORDER BY data.campaigns.created_at DESC")

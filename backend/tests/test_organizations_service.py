"""Tests for organizations service DB-bound logic (organizations/service.py).
Mirrors tests/test_projects_service.py's mock style."""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from src.organizations.models import Invite, Organization, OrganizationUser
from src.organizations.service import (
    add_users_by_email,
    consume_invites_for_new_user,
    invite_emails,
    is_active_org_member,
    revoke_invite,
    update_organization,
)
from src.projects.models import ProjectUser


def _mock_db():
    return MagicMock()


class TestUpdateOrganization:
    def test_renaming_to_an_existing_name_raises_409(self):
        db = _mock_db()
        org = Organization(id=1, name="Old Name")
        db.get.return_value = org
        db.scalar.return_value = Organization(id=2, name="Taken")

        with pytest.raises(HTTPException) as exc_info:
            update_organization(db, 1, name="Taken", description=None)

        assert exc_info.value.status_code == 409
        assert org.name == "Old Name"

    def test_renaming_to_the_same_name_skips_the_uniqueness_check(self):
        db = _mock_db()
        org = Organization(id=1, name="Same")
        db.get.return_value = org

        update_organization(db, 1, name="Same", description="new desc")

        assert org.description == "new desc"
        db.scalar.assert_not_called()

    def test_renaming_to_an_unused_name_succeeds(self):
        db = _mock_db()
        org = Organization(id=1, name="Old")
        db.get.return_value = org
        db.scalar.return_value = None

        update_organization(db, 1, name="New", description=None)

        assert org.name == "New"


def _added(db, model):
    return [call.args[0] for call in db.add.call_args_list if isinstance(call.args[0], model)]


class TestIsActiveOrgMember:
    """The org-membership input to the access rule: an ACTIVE row in an
    APPROVED org. An active member of a pending org gets no org-public access."""

    def test_requires_active_membership_in_an_approved_org(self):
        db = _mock_db()
        db.scalars.return_value.first.return_value = None

        assert is_active_org_member(db, uuid4(), 5) is False

        stmt = db.scalars.call_args.args[0]
        text = str(
            stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})
        )
        assert "JOIN data.organizations ON data.organizations.id = " in text
        assert "data.organization_users.status = 'active'" in text
        assert "data.organizations.status = 'approved'" in text

    def test_matching_row_means_membership(self):
        db = _mock_db()
        db.scalars.return_value.first.return_value = MagicMock()

        assert is_active_org_member(db, uuid4(), 5) is True


class TestInviteEmails:
    def test_unregistered_emails_become_invite_rows(self):
        db = _mock_db()
        inviter = uuid4()
        db.scalars.return_value.all.return_value = []  # no pending invites yet

        invited = invite_emails(db, ["a@x.org", "b@x.org"], invited_by=inviter, organization_id=5)

        assert invited == ["a@x.org", "b@x.org"]
        invites = _added(db, Invite)
        assert [(i.email, i.organization_id, i.project_id) for i in invites] == [
            ("a@x.org", 5, None),
            ("b@x.org", 5, None),
        ]
        assert all(i.invited_by == inviter for i in invites)

    def test_pending_invite_for_same_target_is_not_duplicated(self):
        db = _mock_db()
        db.scalars.return_value.all.return_value = ["a@x.org"]

        invited = invite_emails(db, ["a@x.org", "b@x.org"], invited_by=uuid4(), project_id=7)

        assert invited == ["a@x.org", "b@x.org"]  # still reported as invited
        assert [i.email for i in _added(db, Invite)] == ["b@x.org"]

    def test_no_emails_skips_the_query(self):
        db = _mock_db()
        assert invite_emails(db, [], invited_by=uuid4(), organization_id=5) == []
        db.scalars.assert_not_called()


class TestAddUsersByEmailInvitesUnknown:
    def test_unknown_emails_are_invited_not_dropped(self):
        db = _mock_db()
        known = MagicMock(id=uuid4())
        known.email = "known@x.org"
        db.scalars.return_value.all.side_effect = [[known], []]  # users, pending invites
        db.get.return_value = None  # not yet a member

        added, invited = add_users_by_email(db, 5, ["known@x.org", "new@x.org"], invited_by=uuid4())

        assert added == [known]
        assert invited == ["new@x.org"]
        assert [i.email for i in _added(db, Invite)] == ["new@x.org"]
        db.commit.assert_called_once()


class TestRevokeInvite:
    def test_unknown_invite_raises_404(self):
        db = _mock_db()
        db.get.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            revoke_invite(db, 9, organization_id=5)
        assert exc_info.value.status_code == 404

    def test_invite_for_another_target_raises_404(self):
        db = _mock_db()
        db.get.return_value = Invite(id=9, email="a@x.org", organization_id=6)

        with pytest.raises(HTTPException) as exc_info:
            revoke_invite(db, 9, organization_id=5)
        assert exc_info.value.status_code == 404
        db.delete.assert_not_called()

    def test_consumed_invite_raises_404(self):
        db = _mock_db()
        invite = Invite(id=9, email="a@x.org", organization_id=5)
        invite.consumed_at = MagicMock()
        db.get.return_value = invite

        with pytest.raises(HTTPException) as exc_info:
            revoke_invite(db, 9, organization_id=5)
        assert exc_info.value.status_code == 404

    def test_pending_invite_is_deleted(self):
        db = _mock_db()
        invite = Invite(id=9, email="a@x.org", project_id=7)
        db.get.return_value = invite

        revoke_invite(db, 9, project_id=7)

        db.delete.assert_called_once_with(invite)
        db.commit.assert_called_once()


class TestConsumeInvitesForNewUser:
    def _user(self, email="new@x.org"):
        user = MagicMock()
        user.id = uuid4()
        user.email = email
        return user

    def test_org_invite_becomes_active_non_admin_membership(self):
        db = _mock_db()
        user = self._user()
        invite = Invite(id=1, email="new@x.org", organization_id=5)
        db.scalars.return_value.all.return_value = [invite]
        db.get.return_value = None

        consume_invites_for_new_user(db, user)

        [membership] = _added(db, OrganizationUser)
        assert membership.user_id == user.id
        assert membership.organization_id == 5
        assert membership.is_admin is False
        assert membership.status == "active"
        assert invite.consumed_at is not None
        assert invite.consumed_by == user.id

    def test_project_invite_becomes_non_admin_non_authoritative_membership(self):
        db = _mock_db()
        user = self._user()
        invite = Invite(id=1, email="new@x.org", project_id=7)
        db.scalars.return_value.all.return_value = [invite]
        db.get.return_value = None

        consume_invites_for_new_user(db, user)

        [membership] = _added(db, ProjectUser)
        assert membership.user_id == user.id
        assert membership.project_id == 7
        assert membership.is_admin is False
        assert membership.is_authoritative_reviewer is False
        assert invite.consumed_at is not None

    def test_matches_on_the_lowercased_email(self):
        db = _mock_db()
        db.scalars.return_value.all.return_value = []

        consume_invites_for_new_user(db, self._user(email="MiXeD@X.org"))

        stmt = db.scalars.call_args.args[0]
        compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        assert "mixed@x.org" in compiled

    def test_duplicate_invites_for_one_target_grant_one_membership_and_consume_both(self):
        """A read-then-insert race can leave two unconsumed invites for the same
        email+target; consumption must stay idempotent per target or the second
        add blows up registration on the membership PK, permanently."""
        db = _mock_db()
        user = self._user()
        first = Invite(id=1, email="new@x.org", organization_id=5)
        second = Invite(id=2, email="new@x.org", organization_id=5)
        db.scalars.return_value.all.return_value = [first, second]
        db.get.return_value = None  # autoflush=False: the pending add stays invisible

        consume_invites_for_new_user(db, user)

        assert len(_added(db, OrganizationUser)) == 1
        assert first.consumed_at is not None and second.consumed_at is not None
        assert second.consumed_by == user.id

    def test_never_commits_itself(self):
        """Consumption runs inside register_user's transaction; a commit here
        would break its all-or-nothing registration."""
        db = _mock_db()
        invite = Invite(id=1, email="new@x.org", organization_id=5)
        db.scalars.return_value.all.return_value = [invite]
        db.get.return_value = None

        consume_invites_for_new_user(db, self._user())

        db.commit.assert_not_called()

"""Tests for campaigns/router.py functions that carry logic beyond plain
dependency wiring. Direct function calls with a mocked db, mirroring
tests/test_auth_service.py's TestListUsersVisibility style."""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

from src.campaigns.router import _with_viewer_roles
from src.campaigns.schemas import CampaignOut

PROJECT_ID = 3


def _out() -> CampaignOut:
    return CampaignOut.model_construct()


def _user(is_admin: bool):
    return SimpleNamespace(id=uuid4(), is_admin=is_admin)


def _db(membership):
    db = MagicMock()
    db.get.return_value = membership
    return db


class TestViewerRoleFlags:
    def test_platform_admin_gets_all_flags_without_membership(self):
        db = _db(None)

        out = _with_viewer_roles(_out(), db, _user(is_admin=True), PROJECT_ID)

        assert (out.viewer_is_admin, out.viewer_is_member) == (True, True)
        assert out.viewer_is_authoritative_reviewer is True
        db.get.assert_not_called()

    def test_project_admin_gets_admin_and_member_flags(self):
        membership = SimpleNamespace(is_admin=True, is_authoritative_reviewer=False)
        user = _user(is_admin=False)
        db = _db(membership)

        out = _with_viewer_roles(_out(), db, user, PROJECT_ID)

        assert (out.viewer_is_admin, out.viewer_is_member) == (True, True)
        assert out.viewer_is_authoritative_reviewer is False
        assert db.get.call_args.args[1] == (user.id, PROJECT_ID)

    def test_authoritative_reviewer_flag_comes_from_membership(self):
        membership = SimpleNamespace(is_admin=False, is_authoritative_reviewer=True)
        db = _db(membership)

        out = _with_viewer_roles(_out(), db, _user(is_admin=False), PROJECT_ID)

        assert out.viewer_is_admin is False
        assert (out.viewer_is_member, out.viewer_is_authoritative_reviewer) == (True, True)

    def test_plain_member_gets_member_flag_only(self):
        membership = SimpleNamespace(is_admin=False, is_authoritative_reviewer=False)
        db = _db(membership)

        out = _with_viewer_roles(_out(), db, _user(is_admin=False), PROJECT_ID)

        assert out.viewer_is_member is True
        assert (out.viewer_is_admin, out.viewer_is_authoritative_reviewer) == (False, False)

    def test_non_member_gets_no_flags(self):
        db = _db(None)

        out = _with_viewer_roles(_out(), db, _user(is_admin=False), PROJECT_ID)

        assert (out.viewer_is_admin, out.viewer_is_member) == (False, False)
        assert out.viewer_is_authoritative_reviewer is False

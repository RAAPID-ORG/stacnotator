"""Tests for campaigns/router.py functions that carry logic beyond plain
dependency wiring. Direct function calls with a mocked db, mirroring
tests/test_auth_service.py's TestListUsersVisibility style."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

from src.campaigns import router as campaigns_router
from src.campaigns.router import _with_viewer_roles
from src.campaigns.schemas import CampaignOut, UpdateCampaignLabelsRequest
from src.projects.models import ProjectUser

PROJECT_ID = 3


def _out() -> CampaignOut:
    return CampaignOut.model_construct()


def _user(is_admin: bool):
    return SimpleNamespace(id=uuid4(), is_admin=is_admin)


def _db(membership, project=None, org_membership=None):
    project = project or SimpleNamespace(visibility="private", organization_id=5)
    db = MagicMock()
    db.get.side_effect = lambda model, key: membership if model is ProjectUser else project
    # is_active_org_member reads the active-org-membership row via db.scalars.
    db.scalars.return_value.first.return_value = org_membership
    return db


class TestViewerRoleFlags:
    def test_platform_admin_is_admin_and_member_without_membership(self):
        db = _db(None)

        out = _with_viewer_roles(_out(), db, _user(is_admin=True), PROJECT_ID)

        assert (out.viewer_is_admin, out.viewer_is_member) == (True, True)

    def test_platform_admin_is_not_authoritative_without_the_membership_flag(self):
        """Enforcement reads the membership row alone for authoritative submit, so
        claiming the role here would hand a platform admin a button that 403s."""
        for membership in (None, SimpleNamespace(is_admin=False, is_authoritative_reviewer=False)):
            out = _with_viewer_roles(_out(), _db(membership), _user(is_admin=True), PROJECT_ID)

            assert out.viewer_is_authoritative_reviewer is False

    def test_platform_admin_is_authoritative_when_the_membership_grants_it(self):
        membership = SimpleNamespace(is_admin=False, is_authoritative_reviewer=True)

        out = _with_viewer_roles(_out(), _db(membership), _user(is_admin=True), PROJECT_ID)

        assert out.viewer_is_authoritative_reviewer is True

    def test_project_admin_gets_admin_and_member_flags(self):
        membership = SimpleNamespace(is_admin=True, is_authoritative_reviewer=False)
        user = _user(is_admin=False)
        db = _db(membership)

        out = _with_viewer_roles(_out(), db, user, PROJECT_ID)

        assert (out.viewer_is_admin, out.viewer_is_member) == (True, True)
        assert out.viewer_is_authoritative_reviewer is False
        assert db.get.call_args_list[0].args[1] == (user.id, PROJECT_ID)

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

    def test_org_member_on_org_public_project_is_member_without_roles(self):
        """Org-public access must advertise the member standing enforcement
        grants (build_policy_context), and nothing more."""
        project = SimpleNamespace(visibility="organization", organization_id=5)
        db = _db(None, project=project, org_membership=SimpleNamespace())

        out = _with_viewer_roles(_out(), db, _user(is_admin=False), PROJECT_ID)

        assert out.viewer_is_member is True
        assert (out.viewer_is_admin, out.viewer_is_authoritative_reviewer) == (False, False)

    def test_non_org_member_on_org_public_project_gets_no_flags(self):
        project = SimpleNamespace(visibility="organization", organization_id=5)
        db = _db(None, project=project)

        out = _with_viewer_roles(_out(), db, _user(is_admin=False), PROJECT_ID)

        assert out.viewer_is_member is False


def _campaign_row():
    """Minimal ORM-shaped stand-in that CampaignOut.model_validate accepts."""
    return SimpleNamespace(
        id=11,
        project_id=PROJECT_ID,
        name="Campaign",
        created_at=datetime(2026, 1, 1),
        mode="open",
        settings=SimpleNamespace(
            labels={"1": {"name": "Forest", "geometry_type": "polygon"}},
            bbox_west=0.0,
            bbox_south=0.0,
            bbox_east=1.0,
            bbox_north=1.0,
            embedding_year=None,
            guide_markdown=None,
            sample_extent_meters=None,
            labelling_policy={},
            form_fields=[],
        ),
        imagery_sources=[],
        imagery_views=[],
        basemaps=[],
        time_series=[],
    )


class TestMutationResponsesCarryViewerFlags:
    """Settings tabs write mutation replies straight over their campaign object, so a
    mutation that dropped the flags would strip an admin's affordances until reload."""

    def test_label_update_stamps_project_admin_flags(self, monkeypatch):
        row = _campaign_row()
        monkeypatch.setattr(
            campaigns_router.service,
            "update_campaign_labels",
            lambda db, campaign_id, labels: row,
        )
        db = _db(SimpleNamespace(is_admin=True, is_authoritative_reviewer=False))

        out = campaigns_router.update_campaign_labels(
            campaign_id=row.id,
            req=UpdateCampaignLabelsRequest(labels=[]),
            db=db,
            campaign=row,
            user=_user(is_admin=False),
        )

        assert isinstance(out, CampaignOut)
        assert (out.viewer_is_admin, out.viewer_is_member) == (True, True)
        assert out.viewer_is_authoritative_reviewer is False

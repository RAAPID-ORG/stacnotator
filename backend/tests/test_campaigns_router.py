"""Tests for campaigns/router.py functions that carry logic beyond plain
dependency wiring. Direct function calls with a mocked db, mirroring
tests/test_auth_service.py's TestListUsersVisibility style."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.campaigns import router as campaigns_router
from src.campaigns.router import _with_viewer_roles
from src.campaigns.schemas import (
    CampaignDuplicateRequest,
    CampaignOut,
    UpdateCampaignLabelsRequest,
)
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
            research_sharing=False,
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


class TestDuplicateTarget:
    """The gate on copying a campaign into another project: who may, and what
    that project's organization has to be able to serve."""

    CAMPAIGN = SimpleNamespace(id=1, project_id=PROJECT_ID)

    def _request(self, **overrides):
        return CampaignDuplicateRequest(
            **{"include_tasks": False, "include_annotations": False, **overrides}
        )

    def _target(self, monkeypatch, req, *, unmet=()):
        project = SimpleNamespace(
            id=99, organization=SimpleNamespace(id=5, name="Harvest", allowed_tiler_names=[])
        )
        monkeypatch.setattr(
            campaigns_router, "assert_project_admin", lambda db, user, project_id: project
        )
        monkeypatch.setattr(
            campaigns_router.duplication,
            "unmet_org_requirements",
            lambda db, campaign, organization: list(unmet),
        )
        return campaigns_router._duplicate_target(
            MagicMock(), self.CAMPAIGN, req, _user(is_admin=False)
        )

    def test_no_target_is_a_plain_in_project_duplicate(self, monkeypatch):
        assert self._target(monkeypatch, self._request()) is None

    def test_the_campaigns_own_project_is_a_plain_in_project_duplicate(self, monkeypatch):
        req = self._request(target_project_id=PROJECT_ID)

        assert self._target(monkeypatch, req) is None

    def test_another_project_is_resolved_through_the_admin_check(self, monkeypatch):
        target = self._target(monkeypatch, self._request(target_project_id=99))

        assert target is not None and target.id == 99

    def test_annotations_across_projects_are_refused(self, monkeypatch):
        req = self._request(target_project_id=99, include_annotations=True)

        with pytest.raises(HTTPException) as exc:
            self._target(monkeypatch, req)
        assert exc.value.status_code == 400

    def test_imagery_the_target_organization_cannot_serve_is_refused(self, monkeypatch):
        """Copying anyway would land a campaign whose tiles never arrive."""
        req = self._request(target_project_id=99)

        with pytest.raises(HTTPException) as exc:
            self._target(monkeypatch, req, unmet=["tiler 'mpc'"])
        assert exc.value.status_code == 403
        assert "mpc" in exc.value.detail

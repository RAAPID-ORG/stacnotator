"""Project and campaign gates: who gets in. The access matrix itself is
tests/unit/test_project_flags.py; these check the gates read it."""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.projects.dependencies import require_project_access, require_project_admin
from src.projects.models import Project, ProjectUser


def _db(project=None, membership=None, org_member=False):
    db = MagicMock()
    db.get.side_effect = lambda model, key: {Project: project, ProjectUser: membership}.get(model)
    db.scalars.return_value.first.return_value = MagicMock() if org_member else None
    campaign = MagicMock(project=project, project_id=1) if project else None
    db.execute.return_value.scalar_one_or_none.return_value = campaign
    return db


def _user(is_admin=False):
    return MagicMock(id=uuid4(), is_platform_admin=is_admin)


def _project(visibility="private"):
    return MagicMock(id=1, visibility=visibility, organization_id=5)


@pytest.mark.parametrize("gate", [require_project_access, require_project_admin])
def test_missing_project_raises_404(gate):
    with pytest.raises(HTTPException) as exc:
        gate(project_id=9, db=_db(), user=_user())
    assert exc.value.status_code == 404


@pytest.mark.parametrize("gate", [require_campaign_access, require_campaign_admin])
def test_missing_campaign_raises_404(gate):
    with pytest.raises(HTTPException) as exc:
        gate(campaign_id=9, db=_db(), user=_user())
    assert exc.value.status_code == 404


def test_org_member_without_project_membership_denied_on_private():
    db = _db(_project("private"), org_member=True)
    with pytest.raises(HTTPException) as exc:
        require_project_access(project_id=1, db=db, user=_user())
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException):
        require_campaign_access(campaign_id=1, db=db, user=_user())


def test_public_project_open_to_any_registered_user():
    project = _project("public")
    assert require_project_access(project_id=1, db=_db(project), user=_user()) is project
    campaign = require_campaign_access(campaign_id=1, db=_db(project), user=_user())
    assert campaign.project is project


def test_org_public_project_open_to_active_org_members_only():
    project = _project("organization")
    db = _db(project, org_member=True)
    assert require_project_access(project_id=1, db=db, user=_user()) is project
    with pytest.raises(HTTPException) as exc:
        require_project_access(project_id=1, db=_db(project), user=_user())
    assert exc.value.status_code == 403


def test_member_passes_access_and_only_admin_members_pass_the_admin_gate():
    project = _project("private")
    member = _db(project, MagicMock(is_admin=False))
    admin = _db(project, MagicMock(is_admin=True))
    assert require_project_access(project_id=1, db=member, user=_user()) is project
    for gate, kw in (
        (require_project_admin, "project_id"),
        (require_campaign_admin, "campaign_id"),
    ):
        with pytest.raises(HTTPException) as exc:
            gate(**{kw: 1}, db=member, user=_user())
        assert exc.value.status_code == 403
        assert gate(**{kw: 1}, db=admin, user=_user()) is not None


def test_platform_admin_passes_every_gate():
    project = _project("private")
    db = _db(project)
    assert require_project_admin(project_id=1, db=db, user=_user(is_admin=True)) is project
    assert require_campaign_admin(campaign_id=1, db=db, user=_user(is_admin=True))

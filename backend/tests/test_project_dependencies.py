"""Tests for project access dependencies, mock style as test_campaign_dependencies."""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException


def _db(project, membership):
    results = [project, membership]
    call_index = {"i": 0}

    def _execute(*_a, **_k):
        chain = MagicMock()
        i = call_index["i"]
        call_index["i"] += 1
        chain.scalar_one_or_none.return_value = results[i] if i < len(results) else None
        return chain

    db = MagicMock()
    db.execute.side_effect = _execute
    return db


def _user(is_admin=False):
    return MagicMock(id=uuid4(), is_admin=is_admin)


def test_missing_project_raises_404():
    from src.projects.dependencies import require_project_access

    with pytest.raises(HTTPException) as exc:
        require_project_access(project_id=9, db=_db(None, None), user=_user())
    assert exc.value.status_code == 404


def test_org_member_without_project_membership_denied():
    from src.projects.dependencies import require_project_access

    project = MagicMock(is_public=False)
    with pytest.raises(HTTPException) as exc:
        require_project_access(project_id=1, db=_db(project, None), user=_user())
    assert exc.value.status_code == 403


def test_public_project_open_to_any_registered_user():
    from src.projects.dependencies import require_project_access

    project = MagicMock(is_public=True)
    assert require_project_access(project_id=1, db=_db(project, None), user=_user()) is project


def test_member_passes_and_non_admin_member_fails_admin_gate():
    from src.projects.dependencies import require_project_access, require_project_admin

    project = MagicMock(is_public=False)
    membership = MagicMock(is_admin=False)
    assert (
        require_project_access(project_id=1, db=_db(project, membership), user=_user()) is project
    )
    with pytest.raises(HTTPException) as exc:
        require_project_admin(project_id=1, db=_db(project, None), user=_user())
    assert exc.value.status_code == 403


def test_platform_admin_bypasses_both_gates():
    from src.projects.dependencies import require_project_admin

    project = MagicMock(is_public=False)
    assert (
        require_project_admin(project_id=1, db=_db(project, None), user=_user(is_admin=True))
        is project
    )

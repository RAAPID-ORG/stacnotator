"""Tests for org access dependencies (organizations/dependencies.py).
Mirrors tests/test_campaign_dependencies.py's mock style."""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.organizations.models import MEMBER_STATUS_ACTIVE, MEMBER_STATUS_PENDING


def _db(org, membership):
    results = [org, membership]
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


def test_missing_org_raises_404():
    from src.organizations.dependencies import require_org_member

    with pytest.raises(HTTPException) as exc:
        require_org_member(organization_id=99, db=_db(None, None), user=_user())
    assert exc.value.status_code == 404


def test_non_member_raises_403():
    from src.organizations.dependencies import require_org_member

    with pytest.raises(HTTPException) as exc:
        require_org_member(organization_id=1, db=_db(MagicMock(), None), user=_user())
    assert exc.value.status_code == 403


def test_pending_member_raises_403():
    from src.organizations.dependencies import require_org_member

    membership = MagicMock(status=MEMBER_STATUS_PENDING)
    with pytest.raises(HTTPException) as exc:
        require_org_member(organization_id=1, db=_db(MagicMock(), membership), user=_user())
    assert exc.value.status_code == 403


def test_active_member_passes():
    from src.organizations.dependencies import require_org_member

    org = MagicMock()
    membership = MagicMock(status=MEMBER_STATUS_ACTIVE, is_admin=False)
    assert require_org_member(organization_id=1, db=_db(org, membership), user=_user()) is org


def test_platform_admin_bypasses_membership():
    from src.organizations.dependencies import require_org_admin

    org = MagicMock()
    assert require_org_admin(organization_id=1, db=_db(org, None), user=_user(is_admin=True)) is org


def test_plain_member_is_not_org_admin():
    from src.organizations.dependencies import require_org_admin

    membership = MagicMock(status=MEMBER_STATUS_ACTIVE, is_admin=False)
    with pytest.raises(HTTPException) as exc:
        require_org_admin(organization_id=1, db=_db(MagicMock(), membership), user=_user())
    assert exc.value.status_code == 403

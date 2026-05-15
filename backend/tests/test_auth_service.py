"""Tests for auth service layer and auth dependencies."""

import asyncio
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.auth.constants import ROLE_ADMIN, ROLE_APPROVED
from src.auth.dependencies import require_admin, require_approved_user
from src.auth.models import User, UserRole
from src.auth.service import (
    approve_user,
    deny_user,
    grant_admin,
    register_user,
    revoke_admin,
    revoke_approval,
)


def _mock_db():
    return MagicMock()


def _make_user(user_id=None, email="test@example.com", roles=None):
    """Build a User-like mock with working role properties."""
    user = MagicMock(spec=User)
    user.id = user_id or uuid4()
    user.email = email
    user.display_name = "Test"
    user.issuer = "firebase"
    user.external_uid = f"ext-{user.id}"

    role_objects = []
    for r in roles or []:
        role_obj = MagicMock(spec=UserRole)
        role_obj.role = r
        role_objects.append(role_obj)

    user.roles = role_objects

    # Wire up the property logic since MagicMock won't run the real @property
    type(user).is_approved = property(lambda self: any(r.role == ROLE_APPROVED for r in self.roles))
    type(user).is_admin = property(lambda self: any(r.role == ROLE_ADMIN for r in self.roles))

    return user


class TestRegisterUser:
    def test_existing_user_returned(self):
        db = _mock_db()
        existing = _make_user(email="existing@test.com")

        with patch("src.auth.service._get_user_by_external_id", return_value=existing):
            result = register_user(db, {"uid": "ext-1", "email": "existing@test.com"}, "firebase")

        assert result is existing
        db.add.assert_not_called()

    def test_new_user_created(self):
        db = _mock_db()

        with patch("src.auth.service._get_user_by_external_id", return_value=None):
            register_user(db, {"uid": "new-1", "email": "new@test.com"}, "firebase")

        db.add.assert_called_once()
        created = db.add.call_args[0][0]
        assert isinstance(created, User)
        assert created.email == "new@test.com"
        assert created.issuer == "firebase"
        db.commit.assert_called_once()

    def test_display_name_from_token(self):
        db = _mock_db()

        with patch("src.auth.service._get_user_by_external_id", return_value=None):
            register_user(db, {"uid": "new-1", "email": "a@b.com", "name": "Alice"}, "firebase")

        created = db.add.call_args[0][0]
        assert created.display_name == "Alice"

    def test_display_name_fallback_to_email_prefix(self):
        db = _mock_db()

        with patch("src.auth.service._get_user_by_external_id", return_value=None):
            register_user(db, {"uid": "new-1", "email": "bob@example.com"}, "firebase")

        created = db.add.call_args[0][0]
        assert created.display_name == "bob"

    def test_missing_email_raises(self):
        db = _mock_db()

        with (
            patch("src.auth.service._get_user_by_external_id", return_value=None),
            pytest.raises(ValueError, match="email"),
        ):
            register_user(db, {"uid": "new-1"}, "firebase")


class TestApproveUser:
    def test_approve_new_user(self):
        db = _mock_db()
        user_id = uuid4()
        user = _make_user(user_id=user_id)
        db.get.return_value = user

        with patch("src.auth.service.has_role", return_value=False):
            result = approve_user(db, user_id)

        assert result is user
        db.add.assert_called_once()
        added_role = db.add.call_args[0][0]
        assert isinstance(added_role, UserRole)
        assert added_role.role == ROLE_APPROVED

    def test_approve_already_approved_is_noop(self):
        db = _mock_db()
        user_id = uuid4()
        user = _make_user(user_id=user_id, roles=[ROLE_APPROVED])
        db.get.return_value = user

        with patch("src.auth.service.has_role", return_value=True):
            result = approve_user(db, user_id)

        assert result is user
        db.add.assert_not_called()

    def test_approve_nonexistent_returns_none(self):
        db = _mock_db()
        db.get.return_value = None

        result = approve_user(db, uuid4())
        assert result is None


class TestRevokeApproval:
    def test_revoke_removes_role(self):
        db = _mock_db()
        user_id = uuid4()
        user = _make_user(user_id=user_id, roles=[ROLE_APPROVED])
        role_record = MagicMock()
        db.get.return_value = user
        db.scalar.return_value = role_record

        revoke_approval(db, user_id)

        db.delete.assert_called_once_with(role_record)
        db.commit.assert_called_once()

    def test_revoke_nonexistent_returns_none(self):
        db = _mock_db()
        db.get.return_value = None

        result = revoke_approval(db, uuid4())
        assert result is None


class TestGrantAdmin:
    def test_grants_admin_and_approved(self):
        db = _mock_db()
        user_id = uuid4()
        user = _make_user(user_id=user_id)
        db.get.return_value = user

        with patch("src.auth.service._get_roles", return_value=set()):
            grant_admin(db, user_id)

        # Should add both APPROVED and ADMIN roles
        assert db.add.call_count == 2
        added_roles = {db.add.call_args_list[i][0][0].role for i in range(2)}
        assert ROLE_APPROVED in added_roles
        assert ROLE_ADMIN in added_roles

    def test_grants_admin_already_approved(self):
        db = _mock_db()
        user_id = uuid4()
        user = _make_user(user_id=user_id, roles=[ROLE_APPROVED])
        db.get.return_value = user

        with patch("src.auth.service._get_roles", return_value={ROLE_APPROVED}):
            grant_admin(db, user_id)

        # Should only add ADMIN
        assert db.add.call_count == 1
        assert db.add.call_args[0][0].role == ROLE_ADMIN


class TestRevokeAdmin:
    def test_revoke_admin(self):
        db = _mock_db()
        user_id = uuid4()
        user = _make_user(user_id=user_id, roles=[ROLE_APPROVED, ROLE_ADMIN])
        role_record = MagicMock()
        db.get.return_value = user
        db.scalar.return_value = role_record

        with patch("src.auth.service._admin_count", return_value=2):
            revoke_admin(db, user_id)

        db.delete.assert_called_once_with(role_record)

    def test_revoke_last_admin_raises(self):
        db = _mock_db()
        user_id = uuid4()
        user = _make_user(user_id=user_id, roles=[ROLE_ADMIN])
        db.get.return_value = user
        db.scalar.return_value = MagicMock()  # role exists

        with (
            patch("src.auth.service._admin_count", return_value=1),
            pytest.raises(HTTPException) as exc_info,
        ):
            revoke_admin(db, user_id)

        assert exc_info.value.status_code == 409
        assert "last admin" in exc_info.value.detail.lower()

    def test_revoke_nonexistent_returns_none(self):
        db = _mock_db()
        db.get.return_value = None

        result = revoke_admin(db, uuid4())
        assert result is None


class TestDenyUser:
    def test_deny_unapproved_user(self):
        db = _mock_db()
        user_id = uuid4()
        user = _make_user(user_id=user_id)
        db.get.return_value = user

        with patch("src.auth.service.has_role", return_value=False):
            result = deny_user(db, user_id)

        assert result is user
        db.delete.assert_called_once_with(user)
        db.commit.assert_called_once()

    def test_deny_approved_user_raises(self):
        db = _mock_db()
        user_id = uuid4()
        user = _make_user(user_id=user_id, roles=[ROLE_APPROVED])
        db.get.return_value = user

        def mock_has_role(db, uid, role):
            return role == ROLE_APPROVED

        with (
            patch("src.auth.service.has_role", side_effect=mock_has_role),
            pytest.raises(HTTPException) as exc_info,
        ):
            deny_user(db, user_id)

        assert exc_info.value.status_code == 409
        assert "approved" in exc_info.value.detail.lower()
        db.delete.assert_not_called()

    def test_deny_admin_raises(self):
        db = _mock_db()
        user_id = uuid4()
        user = _make_user(user_id=user_id, roles=[ROLE_ADMIN])
        db.get.return_value = user

        def mock_has_role(db, uid, role):
            if role == ROLE_APPROVED:
                return False
            return role == ROLE_ADMIN

        with (
            patch("src.auth.service.has_role", side_effect=mock_has_role),
            pytest.raises(HTTPException) as exc_info,
        ):
            deny_user(db, user_id)

        assert exc_info.value.status_code == 409
        assert "admin" in exc_info.value.detail.lower()

    def test_deny_nonexistent_returns_none(self):
        db = _mock_db()
        db.get.return_value = None

        result = deny_user(db, uuid4())
        assert result is None


class TestRequireApprovedUser:
    def test_approved_user_passes(self):
        user = _make_user(roles=[ROLE_APPROVED])
        db = _mock_db()

        result = asyncio.run(require_approved_user(user=user, db=db))
        assert result is user

    def test_unapproved_user_raises_403(self):
        user = _make_user(roles=[])
        db = _mock_db()

        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(require_approved_user(user=user, db=db))

        assert exc_info.value.status_code == 403


class TestRequireAdmin:
    def test_admin_passes(self):
        user = _make_user(roles=[ROLE_APPROVED, ROLE_ADMIN])
        db = _mock_db()

        result = require_admin(user=user, db=db)
        assert result is user

    def test_approved_but_not_admin_raises_403(self):
        user = _make_user(roles=[ROLE_APPROVED])
        db = _mock_db()

        with pytest.raises(HTTPException) as exc_info:
            require_admin(user=user, db=db)

        assert exc_info.value.status_code == 403

    def test_unapproved_non_admin_raises_403(self):
        user = _make_user(roles=[])
        db = _mock_db()

        with pytest.raises(HTTPException) as exc_info:
            require_admin(user=user, db=db)

        assert exc_info.value.status_code == 403

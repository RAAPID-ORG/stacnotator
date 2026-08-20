"""Tests for auth service layer and auth dependencies."""

import asyncio
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.auth.constants import ROLE_ADMIN, TERMS_VERSION
from src.auth.dependencies import (
    require_admin,
    require_authenticated_user,
)
from src.auth.exceptions import ExternalAuthEmailNotVerified
from src.auth.models import User, UserRole
from src.auth.router import edit_user_info as router_edit_user_info
from src.auth.router import list_users
from src.auth.service import (
    accept_terms,
    edit_user_info,
    grant_admin,
    grant_admin_bulk,
    register_user,
    revoke_admin,
    revoke_admin_bulk,
)


def _mock_db():
    db = MagicMock()
    # register_user's invite-consumption pass queries pending invites; no
    # invites by default so tests only configure what they assert.
    db.scalars.return_value.all.return_value = []
    return db


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

        with (
            patch("src.auth.service._get_user_by_external_id", return_value=None),
            patch("src.auth.service._get_user_by_email", return_value=None),
        ):
            register_user(db, {"uid": "new-1", "email": "new@test.com"}, "firebase")

        created = db.add.call_args_list[0].args[0]
        assert isinstance(created, User)
        assert created.email == "new@test.com"
        assert created.issuer == "firebase"
        db.commit.assert_called_once()

    def test_no_username_is_derived_from_the_token(self):
        """The provider's name is not unique, and usernames have to be: the
        client asks the user for one instead."""
        db = _mock_db()

        with (
            patch("src.auth.service._get_user_by_external_id", return_value=None),
            patch("src.auth.service._get_user_by_email", return_value=None),
        ):
            register_user(db, {"uid": "new-1", "email": "a@b.com", "name": "Alice"}, "firebase")

        created = db.add.call_args_list[0].args[0]
        assert created.display_name is None

    def test_missing_email_raises(self):
        db = _mock_db()

        with (
            patch("src.auth.service._get_user_by_external_id", return_value=None),
            pytest.raises(ValueError, match="email"),
        ):
            register_user(db, {"uid": "new-1"}, "firebase")

    def test_duplicate_email_different_uid_raises_409(self):
        db = _mock_db()
        existing = _make_user(email="taken@test.com")

        with (
            patch("src.auth.service._get_user_by_external_id", return_value=None),
            patch("src.auth.service._get_user_by_email", return_value=existing),
            pytest.raises(HTTPException) as exc_info,
        ):
            register_user(db, {"uid": "new-uid", "email": "taken@test.com"}, "firebase")

        assert exc_info.value.status_code == 409
        db.add.assert_not_called()

    def test_registration_consumes_matching_invites_in_the_same_transaction(self):
        from src.organizations.models import Invite, OrganizationUser
        from src.projects.models import ProjectUser

        db = _mock_db()
        org_invite = Invite(id=1, email="new@test.com", organization_id=5)
        project_invite = Invite(id=2, email="new@test.com", project_id=7)
        db.scalars.return_value.all.return_value = [org_invite, project_invite]
        db.get.return_value = None  # a brand-new user holds no membership rows

        with (
            patch("src.auth.service._get_user_by_external_id", return_value=None),
            patch("src.auth.service._get_user_by_email", return_value=None),
        ):
            register_user(db, {"uid": "new-1", "email": "new@test.com"}, "firebase")

        added = [call.args[0] for call in db.add.call_args_list]
        assert [m.organization_id for m in added if isinstance(m, OrganizationUser)] == [5]
        assert [m.project_id for m in added if isinstance(m, ProjectUser)] == [7]
        assert org_invite.consumed_at is not None
        assert project_invite.consumed_at is not None
        db.commit.assert_called_once()


class TestGrantAdmin:
    def test_grants_admin_role(self):
        db = _mock_db()
        user_id = uuid4()
        db.get.return_value = _make_user(user_id=user_id)

        with patch("src.auth.service._get_roles", return_value=set()):
            grant_admin(db, user_id)

        assert db.add.call_args[0][0].role == ROLE_ADMIN
        db.commit.assert_called_once()

    def test_grant_admin_already_admin_is_noop(self):
        db = _mock_db()
        user_id = uuid4()
        db.get.return_value = _make_user(user_id=user_id, roles=[ROLE_ADMIN])

        with patch("src.auth.service._get_roles", return_value={ROLE_ADMIN}):
            grant_admin(db, user_id)

        db.add.assert_not_called()
        db.commit.assert_not_called()

    def test_grant_admin_nonexistent_returns_none(self):
        db = _mock_db()
        db.get.return_value = None

        assert grant_admin(db, uuid4()) is None


class TestRevokeAdmin:
    def test_revoke_admin(self):
        db = _mock_db()
        user_id = uuid4()
        user = _make_user(user_id=user_id, roles=[ROLE_ADMIN])
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


class TestRequireAdmin:
    def test_admin_passes(self):
        user = _make_user(roles=[ROLE_ADMIN])
        db = _mock_db()

        result = require_admin(user=user, db=db)
        assert result is user

    def test_non_admin_raises_403(self):
        user = _make_user(roles=[])
        db = _mock_db()

        with pytest.raises(HTTPException) as exc_info:
            require_admin(user=user, db=db)

        assert exc_info.value.status_code == 403


class TestBulkRoleOperations:
    """The bulk helpers share one code path; cover the branches unique to it."""

    def test_revoke_admin_bulk_refuses_to_remove_last_admin(self):
        db = _mock_db()
        user_id = uuid4()
        user = _make_user(user_id=user_id, roles=[ROLE_ADMIN])
        db.get.return_value = user
        db.scalar.return_value = MagicMock()  # admin role row exists

        with (
            patch("src.auth.service._admin_count", return_value=1),
            pytest.raises(HTTPException) as exc_info,
        ):
            revoke_admin_bulk(db, [user_id])

        assert exc_info.value.status_code == 409
        db.delete.assert_not_called()  # guard aborts before any deletion

    def test_grant_admin_bulk_skips_existing_admin(self):
        db = _mock_db()
        u1, u2 = uuid4(), uuid4()
        user1 = _make_user(user_id=u1)
        user2 = _make_user(user_id=u2, roles=[ROLE_ADMIN])
        users = {u1: user1, u2: user2}
        db.get.side_effect = lambda _model, uid: users[uid]

        roles = {u1: set(), u2: {ROLE_ADMIN}}
        with patch("src.auth.service._get_roles", side_effect=lambda _db, uid: roles[uid]):
            result = grant_admin_bulk(db, [u1, u2])

        assert result.success == [user1]
        assert result.already_in_state == [user2]  # already admin
        assert db.add.call_args[0][0].role == ROLE_ADMIN


class TestRequireAuthenticatedUser:
    """The authentication entry point every request passes through."""

    @staticmethod
    def _provider(*, returns=None, raises=None):
        provider = MagicMock()
        provider.name = "firebase"

        async def authenticate(_request):
            if raises is not None:
                raise raises
            return returns

        provider.authenticate = authenticate
        return provider

    def test_email_not_verified_raises_403(self):
        provider = self._provider(raises=ExternalAuthEmailNotVerified())

        with (
            patch("src.auth.dependencies.get_auth_provider", return_value=provider),
            pytest.raises(HTTPException) as exc_info,
        ):
            asyncio.run(require_authenticated_user(request=MagicMock(), db=_mock_db()))

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "email_not_verified"

    def test_no_authenticated_user_raises_401(self):
        provider = self._provider(returns=None)

        with (
            patch("src.auth.dependencies.get_auth_provider", return_value=provider),
            pytest.raises(HTTPException) as exc_info,
        ):
            asyncio.run(require_authenticated_user(request=MagicMock(), db=_mock_db()))

        assert exc_info.value.status_code == 401

    def test_authenticated_user_is_registered_and_returned(self):
        provider = self._provider(returns={"uid": "x", "email": "a@b.com"})
        user = _make_user()

        with (
            patch("src.auth.dependencies.get_auth_provider", return_value=provider),
            patch("src.auth.dependencies.service.register_user", return_value=user) as register,
        ):
            result = asyncio.run(require_authenticated_user(request=MagicMock(), db=_mock_db()))

        assert result is user
        register.assert_called_once()


class TestListUsersVisibility:
    """Only platform admins see account details through the user list."""

    def test_admin_sees_detailed_records(self):
        admin = _make_user(roles=[ROLE_ADMIN])
        other = _make_user()
        everyone = [admin, other]

        with patch("src.auth.router.service.get_all_users", return_value=everyone):
            result = list_users(user=admin, db=_mock_db())

        assert result == everyone

    def test_non_admin_gets_names_without_emails_or_detailed_fields(self):
        """Non-admins pick members by display name: no issuer/external_uid, and
        no email either, so the list is not the platform's address book."""
        viewer = _make_user()
        other = _make_user()

        with patch("src.auth.router.service.get_all_users", return_value=[viewer, other]):
            result = list_users(user=viewer, db=_mock_db())

        assert [u.id for u in result] == [viewer.id, other.id]
        assert set(type(result[0]).model_fields) == {"id", "email", "display_name"}
        assert [u.email for u in result] == [None, None]
        assert all(u.display_name for u in result)


class TestEditUserInfoAuthorization:
    def test_non_admin_editing_another_user_raises_403(self):
        actor = _make_user()

        with pytest.raises(HTTPException) as exc_info:
            router_edit_user_info(user_id=uuid4(), new_display_name="X", user=actor, db=_mock_db())

        assert exc_info.value.status_code == 403

    def test_user_can_edit_own_info(self):
        actor = _make_user()
        updated = _make_user(user_id=actor.id)

        with patch("src.auth.router.service.edit_user_info", return_value=updated) as edit:
            result = router_edit_user_info(
                user_id=actor.id, new_display_name="New", user=actor, db=_mock_db()
            )

        assert result is updated
        edit.assert_called_once()

    def test_admin_can_edit_another_user(self):
        admin = _make_user(roles=[ROLE_ADMIN])
        other_id = uuid4()
        updated = _make_user(user_id=other_id)

        with patch("src.auth.router.service.edit_user_info", return_value=updated):
            result = router_edit_user_info(
                user_id=other_id, new_display_name="New", user=admin, db=_mock_db()
            )

        assert result is updated


class TestEditUserInfo:
    def _db_with(self, user, taken=False):
        db = _mock_db()
        db.get.return_value = user
        db.scalar.return_value = uuid4() if taken else None
        return db

    def test_rejects_a_malformed_username(self):
        user = _make_user()
        db = self._db_with(user)

        with pytest.raises(HTTPException) as exc_info:
            edit_user_info(db, user.id, "ada lovelace")

        assert exc_info.value.status_code == 400
        db.commit.assert_not_called()

    def test_rejects_a_username_someone_else_holds(self):
        user = _make_user()
        db = self._db_with(user, taken=True)

        with pytest.raises(HTTPException) as exc_info:
            edit_user_info(db, user.id, "ada")

        assert exc_info.value.status_code == 409
        db.commit.assert_not_called()

    def test_stores_a_free_username_trimmed(self):
        user = _make_user()
        db = self._db_with(user)

        edit_user_info(db, user.id, "  ada.lovelace  ")

        assert user.display_name == "ada.lovelace"
        db.commit.assert_called_once()

    def test_unknown_user_is_not_found(self):
        db = _mock_db()
        db.get.return_value = None

        assert edit_user_info(db, uuid4(), "ada") is None


class TestAcceptTerms:
    def test_accepting_the_current_version_records_it(self):
        db = _mock_db()
        user = _make_user()
        user.terms_accepted_version = None

        accept_terms(db, user, TERMS_VERSION)

        assert user.terms_accepted_version == TERMS_VERSION
        db.commit.assert_called_once()

    def test_accepting_a_stale_version_is_refused(self):
        db = _mock_db()
        user = _make_user()
        user.terms_accepted_version = None

        with pytest.raises(HTTPException) as exc_info:
            accept_terms(db, user, "1970-01-01")

        assert exc_info.value.status_code == 409
        assert user.terms_accepted_version is None
        db.commit.assert_not_called()

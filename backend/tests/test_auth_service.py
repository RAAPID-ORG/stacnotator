"""Tests for auth service layer and auth dependencies."""

import asyncio
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.auth.constants import TERMS_VERSION
from src.auth.dependencies import require_authenticated_user, require_platform_admin
from src.auth.models import User
from src.auth.providers.base import ExternalAuthEmailNotVerified
from src.auth.router import edit_user_info as router_edit_user_info
from src.auth.router import list_users
from src.auth.service import (
    accept_terms,
    edit_user_info,
    get_all_users,
    grant_admin_bulk,
    register_user,
    revoke_admin_bulk,
)


def _mock_db():
    db = MagicMock()
    # register_user's invite-consumption pass queries pending invites; no
    # invites by default so tests only configure what they assert.
    db.scalars.return_value.all.return_value = []
    return db


def _make_user(user_id=None, email="test@example.com", admin=False):
    user = MagicMock(spec=User)
    user.id = user_id or uuid4()
    user.email = email
    user.display_name = "Test"
    user.issuer = "firebase"
    user.external_uid = f"ext-{user.id}"
    user.is_platform_admin = admin
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

    def test_registration_redeems_matching_invites_in_the_same_transaction(self):
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
        assert [c.args[0] for c in db.delete.call_args_list] == [org_invite, project_invite]
        db.commit.assert_called_once()


class TestRequirePlatformAdmin:
    def test_admin_passes(self):
        user = _make_user(admin=True)
        assert require_platform_admin(user=user) is user

    def test_non_admin_raises_403(self):
        with pytest.raises(HTTPException) as exc_info:
            require_platform_admin(user=_make_user())

        assert exc_info.value.status_code == 403


class TestPlatformAdminChanges:
    def test_revoke_refuses_to_remove_the_last_admin(self):
        db = _mock_db()
        user = _make_user(admin=True)
        db.get.return_value = user

        with (
            patch("src.auth.service._admin_count", return_value=1),
            pytest.raises(HTTPException) as exc_info,
        ):
            revoke_admin_bulk(db, [user.id])

        assert exc_info.value.status_code == 409
        assert user.is_platform_admin is True
        db.commit.assert_not_called()

    def test_revoke_leaves_other_admins(self):
        db = _mock_db()
        user = _make_user(admin=True)
        db.get.return_value = user

        with patch("src.auth.service._admin_count", return_value=2):
            result = revoke_admin_bulk(db, [user.id])

        assert result.success == [user]
        assert user.is_platform_admin is False

    def test_grant_skips_existing_admin_and_reports_unknown_ids(self):
        db = _mock_db()
        u1, u2, missing = uuid4(), uuid4(), uuid4()
        user1 = _make_user(user_id=u1)
        user2 = _make_user(user_id=u2, admin=True)
        users = {u1: user1, u2: user2}
        db.get.side_effect = lambda _model, uid: users.get(uid)

        result = grant_admin_bulk(db, [u1, u2, missing])

        assert result.success == [user1]
        assert result.already_in_state == [user2]
        assert result.not_found == [str(missing)]
        assert user1.is_platform_admin is True


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
        admin = _make_user(admin=True)
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
        admin = _make_user(admin=True)
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


def test_the_address_book_leaves_labelling_agents_out():
    """/auth/users is what admins pick new members from, so agent users stay out of it."""
    db = MagicMock()

    get_all_users(db)

    statement = str(db.scalars.call_args.args[0].compile(compile_kwargs={"literal_binds": True}))
    assert "users.issuer != 'agent'" in statement

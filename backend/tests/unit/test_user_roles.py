"""DB-free tests for the role predicates that gate capabilities.

`is_internal` decides whether a user may point imagery collections and custom maps at
internal storage, which the tiler reads with its managed identity (see the
`_require_internal_for_internal_storage` guards in imagery/router and custom_maps/router).
Keep this honest.
"""

from src.auth.constants import ROLE_ADMIN, ROLE_APPROVED, ROLE_INTERNAL
from src.auth.models import User, UserRole


def _user(*roles: str) -> User:
    u = User()
    u.roles = [UserRole(role=r) for r in roles]
    return u


def test_internal_role_is_internal():
    assert _user(ROLE_APPROVED, ROLE_INTERNAL).is_internal


def test_admin_is_internal():
    assert _user(ROLE_ADMIN).is_internal


def test_plain_approved_user_is_not_internal():
    assert not _user(ROLE_APPROVED).is_internal

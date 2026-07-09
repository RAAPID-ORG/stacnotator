"""DB-free tests for the role predicates that gate capabilities.

`is_internal` decides whether a user's tiler token carries `azure:read` (see
auth/router.get_tiler_token), which in turn lets the tiler use its managed identity to
read Azure custom-map COGs. Keep this honest.
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

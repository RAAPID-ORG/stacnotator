from collections.abc import Callable
from typing import NamedTuple
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.auth.constants import ROLE_ADMIN, TERMS_VERSION
from src.auth.models import User, UserRole
from src.auth.providers.base import AuthenticatedUser
from src.organizations.service import consume_invites_for_new_user

# ============================================================================
# Internal Helper Functions
# ============================================================================


def _get_roles(db: Session, user_id: UUID) -> set[str]:
    """Retrieve all roles for a user."""
    stmt = select(UserRole.role).where(UserRole.user_id == user_id)
    return set(db.scalars(stmt).all())


def _admin_count(db: Session) -> int:
    """Count total number of admin users in the system."""
    stmt = select(func.count()).select_from(UserRole).where(UserRole.role == ROLE_ADMIN)
    return db.scalar(stmt) or 0


def _grant_role(db: Session, user_id: UUID, role: str) -> User | None:
    """Grant `role` to a single user. Users who already hold it are returned unchanged."""
    user = db.get(User, user_id)
    if not user:
        return None

    if role not in _get_roles(db, user_id):
        db.add(UserRole(user_id=user_id, role=role))
        db.commit()
        db.refresh(user)

    return user


def _revoke_role(
    db: Session,
    user_id: UUID,
    role: str,
    *,
    guard: Callable[[], None] | None = None,
) -> User | None:
    """Remove `role` from a single user. Users without `role` are returned
    unchanged. An optional `guard` may raise to abort before deletion."""
    user = db.get(User, user_id)
    if not user:
        return None

    stmt = select(UserRole).where(UserRole.user_id == user_id, UserRole.role == role)
    role_row = db.scalar(stmt)
    if not role_row:
        return user

    if guard:
        guard()

    db.delete(role_row)
    db.commit()
    db.refresh(user)
    return user


def _get_user_by_external_id(
    db: Session,
    issuer: str,
    external_uid: str,
) -> User | None:
    stmt = select(User).where(
        User.issuer == issuer,
        User.external_uid == external_uid,
    )
    return db.scalar(stmt)


def _get_user_by_email(db: Session, email: str) -> User | None:
    stmt = select(User).where(User.email == email)
    return db.scalar(stmt)


# ============================================================================
# User Registration & Retrieval
# ============================================================================


def register_user(
    db: Session,
    token: AuthenticatedUser,
    issuer: str,
    bootstrap_roles: tuple[str, ...] = (),
) -> User:
    """
    Register or retrieve user from external authentication token.

    If user already exists, returns existing user. Otherwise creates
    a new user record.

    Args:
        db: Database session
        token: Authenticated user data from external provider
        issuer: Name of the authentication provider
        bootstrap_roles: Roles to grant on first registration, from the
            provider's bootstrap_roles (e.g. local auth grants itself admin)

    Returns:
        User object (existing or newly created)
    """
    user = _get_user_by_external_id(
        db,
        issuer=issuer,
        external_uid=token["uid"],
    )

    if user:
        return user

    email = token.get("email")
    if not email:
        raise ValueError("Cannot register user without email from authentication provider")

    if _get_user_by_email(db, email):
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists under a different login method.",
        )

    display_name = token.get("name") or email.split("@")[0]

    user = User(
        issuer=issuer,
        external_uid=token["uid"],
        email=email,
        display_name=display_name,
    )

    db.add(user)
    db.flush()

    for role in bootstrap_roles:
        db.add(UserRole(user_id=user.id, role=role))
    consume_invites_for_new_user(db, user)

    db.commit()
    db.refresh(user)

    return user


def get_all_users(db: Session) -> list[User]:
    """Retrieve all users in the system, sorted by display name (email fallback)."""
    stmt = select(User).order_by(func.lower(func.coalesce(User.display_name, User.email)))
    return list(db.scalars(stmt).all())


# ============================================================================
# Role Checking
# ============================================================================


def has_role(db: Session, user_id: UUID, role: str) -> bool:
    """
    Check if a user has a specific role.

    Args:
        db: Database session
        user_id: User ID to check
        role: Role name to check for

    Returns:
        True if user has the role, False otherwise
    """
    stmt = select(UserRole).where(
        UserRole.user_id == user_id,
        UserRole.role == role,
    )
    return db.execute(stmt).first() is not None


def is_admin(db: Session, user_id: UUID) -> bool:
    """Check if user has admin role."""
    return has_role(db, user_id, ROLE_ADMIN)


# ============================================================================
# Admin Role Management
# ============================================================================


def grant_admin(db: Session, user_id: UUID) -> User | None:
    """Grant platform admin to a user."""
    return _grant_role(db, user_id, ROLE_ADMIN)


def revoke_admin(db: Session, user_id: UUID) -> User | None:
    """Revoke admin from a user, refusing to remove the last admin in the system."""

    def keep_one_admin() -> None:
        if _admin_count(db) <= 1:
            raise HTTPException(
                status_code=409, detail="Cannot revoke admin from the last admin user"
            )

    return _revoke_role(db, user_id, ROLE_ADMIN, guard=keep_one_admin)


# ============================================================================
# Tiler Access Management
# ============================================================================


# ============================================================================
# Bulk Operations
# ============================================================================


class BulkRoleChangeResult(NamedTuple):
    """Outcome of a bulk role change, shaped to match BulkUserActionResponse
    (`already_in_state` covers users who already held/lacked the role)."""

    success: list[User]
    not_found: list[str]
    already_in_state: list[User]


def _bulk_grant_role(db: Session, user_ids: list[UUID], role: str) -> BulkRoleChangeResult:
    """Grant `role` to many users in one transaction. Users who already hold
    `role` are skipped."""
    success, not_found, already_in_state = [], [], []

    for user_id in user_ids:
        user = db.get(User, user_id)
        if not user:
            not_found.append(str(user_id))
            continue

        if role in _get_roles(db, user_id):
            already_in_state.append(user)
            continue

        db.add(UserRole(user_id=user_id, role=role))
        success.append(user)

    if success:
        db.commit()
        for user in success:
            db.refresh(user)

    return BulkRoleChangeResult(success, not_found, already_in_state)


def _bulk_revoke_role(
    db: Session,
    user_ids: list[UUID],
    role: str,
    *,
    guard: Callable[[list[User]], None] | None = None,
) -> BulkRoleChangeResult:
    """Remove `role` from many users in one transaction. Users without `role`
    are skipped. An optional `guard` receives the users about to be revoked and
    may raise to abort before anything is deleted."""
    success, not_found, already_in_state = [], [], []
    targets = []

    for user_id in user_ids:
        user = db.get(User, user_id)
        if not user:
            not_found.append(str(user_id))
            continue

        stmt = select(UserRole).where(UserRole.user_id == user_id, UserRole.role == role)
        role_row = db.scalar(stmt)
        if role_row:
            targets.append((user, role_row))
        else:
            already_in_state.append(user)

    if guard:
        guard([user for user, _ in targets])

    for user, role_row in targets:
        db.delete(role_row)
        success.append(user)

    if success:
        db.commit()
        for user in success:
            db.refresh(user)

    return BulkRoleChangeResult(success, not_found, already_in_state)


def grant_admin_bulk(db: Session, user_ids: list[UUID]) -> BulkRoleChangeResult:
    """Grant platform admin to multiple users."""
    return _bulk_grant_role(db, user_ids, ROLE_ADMIN)


def revoke_admin_bulk(db: Session, user_ids: list[UUID]) -> BulkRoleChangeResult:
    """Revoke admin from multiple users, refusing to remove the last admin."""

    def keep_one_admin(users_to_revoke: list[User]) -> None:
        if _admin_count(db) - len(users_to_revoke) < 1:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Cannot revoke admin from {len(users_to_revoke)} user(s). "
                    "This would leave no admin users in the system."
                ),
            )

    return _bulk_revoke_role(db, user_ids, ROLE_ADMIN, guard=keep_one_admin)


# ============================================================================
# Admin Metadata Management
# ============================================================================


def edit_user_info(
    db: Session,
    user_id: UUID,
    display_name: str,
) -> User | None:
    """
    Edit user metadata such as display name
    """
    user = db.get(User, user_id)
    if not user:
        return None

    user.display_name = display_name
    db.commit()
    db.refresh(user)
    return user


def accept_terms(db: Session, user: User, version: str) -> User:
    """Record which terms the user accepted. Accepting a version that is no longer
    in force is refused - the client rendered stale text and has to reload."""
    if version != TERMS_VERSION:
        raise HTTPException(
            status_code=409,
            detail="These terms are out of date. Reload and accept the current terms.",
        )

    user.terms_accepted_version = version
    db.commit()
    db.refresh(user)
    return user

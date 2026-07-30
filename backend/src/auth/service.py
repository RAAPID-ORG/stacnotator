from collections.abc import Callable
from typing import NamedTuple
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.auth.constants import (
    ROLE_ADMIN,
    ROLE_APPROVED,
    ROLE_INTERNAL,
    ROLE_VISITOR,
)
from src.auth.models import User, UserRole, UserTiler
from src.auth.providers.base import AuthenticatedUser
from src.tilers import registry

# ============================================================================
# Internal Helper Functions
# ============================================================================


def _get_roles(db: Session, user_id: UUID) -> set[str]:
    """Retrieve all roles for a user."""
    stmt = select(UserRole.role).where(UserRole.user_id == user_id)
    return set(db.scalars(stmt).all())


def _delete_role(db: Session, user_id: UUID, role: str) -> bool:
    """Delete a role row from a user if present. Does not commit. Returns True if deleted."""
    stmt = select(UserRole).where(UserRole.user_id == user_id, UserRole.role == role)
    existing = db.scalar(stmt)
    if existing:
        db.delete(existing)
        return True
    return False


def _admin_count(db: Session) -> int:
    """Count total number of admin users in the system."""
    stmt = select(func.count()).select_from(UserRole).where(UserRole.role == ROLE_ADMIN)
    return db.scalar(stmt) or 0


def _apply_grant(
    db: Session,
    user_id: UUID,
    role: str,
    roles: set[str],
    also_remove: tuple[str, ...],
) -> bool:
    """Ensure a user holds `role` (and approval) and clear `also_remove` roles.

    `roles` is the user's current role set. Stages changes without committing;
    returns True if anything was staged. This is the single place that encodes
    grant policy (e.g. admins/visitors are always approved), shared by the
    single-user and bulk grant helpers.
    """
    changed = False
    if ROLE_APPROVED not in roles:
        db.add(UserRole(user_id=user_id, role=ROLE_APPROVED))
        changed = True
    if role != ROLE_APPROVED and role not in roles:
        db.add(UserRole(user_id=user_id, role=role))
        changed = True
    for stale in also_remove:
        if _delete_role(db, user_id, stale):
            changed = True
    return changed


def _grant_role(
    db: Session,
    user_id: UUID,
    role: str,
    *,
    also_remove: tuple[str, ...] = (),
) -> User | None:
    """Grant `role` to a single user, ensuring approval and clearing `also_remove`."""
    user = db.get(User, user_id)
    if not user:
        return None

    if _apply_grant(db, user_id, role, _get_roles(db, user_id), also_remove):
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

    for tiler_name in registry.default_access_names():
        db.add(UserTiler(user_id=user.id, tiler_name=tiler_name))

    db.commit()
    db.refresh(user)

    return user


def get_all_users(db: Session) -> list[User]:
    """Retrieve all users in the system."""
    stmt = select(User)
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


def is_approved(db: Session, user_id: UUID) -> bool:
    """Check if user has approved role."""
    return has_role(db, user_id, ROLE_APPROVED)


def is_visitor(db: Session, user_id: UUID) -> bool:
    """Check if user has visitor role (approved but cannot create campaigns)."""
    return has_role(db, user_id, ROLE_VISITOR)


# ============================================================================
# User Approval Management
# ============================================================================


def approve_user(db: Session, user_id: UUID) -> User | None:
    """Grant approval to a user, required to access most application features."""
    return _grant_role(db, user_id, ROLE_APPROVED)


def revoke_approval(db: Session, user_id: UUID) -> User | None:
    """Revoke approval from a user, removing access to most application features."""
    return _revoke_role(db, user_id, ROLE_APPROVED)


# ============================================================================
# Admin Role Management
# ============================================================================


def grant_admin(db: Session, user_id: UUID) -> User | None:
    """Grant admin to a user, granting approval and clearing visitor (admins can
    create campaigns, so they cannot be visitors)."""
    return _grant_role(db, user_id, ROLE_ADMIN, also_remove=(ROLE_VISITOR,))


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


def grant_tiler(db: Session, user_id: UUID, tiler_name: str) -> User | None:
    """Grant a user access to an extra hosted tiler. Idempotent; returns the user
    (or None if the user doesn't exist)."""
    user = db.get(User, user_id)
    if not user:
        return None
    if db.get(UserTiler, (user_id, tiler_name)) is None:
        db.add(UserTiler(user_id=user_id, tiler_name=tiler_name))
        db.commit()
        db.refresh(user)
    return user


def revoke_tiler(db: Session, user_id: UUID, tiler_name: str) -> User | None:
    """Revoke a user's access to an extra hosted tiler. Idempotent; returns the user
    (or None if the user doesn't exist)."""
    user = db.get(User, user_id)
    if not user:
        return None
    row = db.get(UserTiler, (user_id, tiler_name))
    if row is not None:
        db.delete(row)
        db.commit()
        db.refresh(user)
    return user


# ============================================================================
# Visitor Role Management
# ============================================================================


def grant_visitor(db: Session, user_id: UUID) -> User | None:
    """Grant visitor to a user (approved, but cannot create campaigns), granting
    approval if needed. Has no effect on admins, who retain campaign creation."""
    return _grant_role(db, user_id, ROLE_VISITOR)


def revoke_visitor(db: Session, user_id: UUID) -> User | None:
    """Revoke visitor from a user; they remain a standard approved user."""
    return _revoke_role(db, user_id, ROLE_VISITOR)


# ============================================================================
# Internal Role Management
# ============================================================================


def grant_internal(db: Session, user_id: UUID) -> User | None:
    """Mark a user as first-party staff, granting approval if needed. Internal is
    orthogonal to the admin/visitor/standard ladder: it only unlocks pointing
    imagery and custom maps at managed-identity storage."""
    return _grant_role(db, user_id, ROLE_INTERNAL)


def revoke_internal(db: Session, user_id: UUID) -> User | None:
    """Unmark a user as first-party staff. Admins stay internal by definition, so
    this cannot make an admin external."""
    return _revoke_role(db, user_id, ROLE_INTERNAL)


# ============================================================================
# Bulk Operations
# ============================================================================


class BulkRoleChangeResult(NamedTuple):
    """Outcome of a bulk role change, shaped to match BulkUserActionResponse
    (`already_in_state` covers users who already held/lacked the role)."""

    success: list[User]
    not_found: list[str]
    already_in_state: list[User]


def _bulk_grant_role(
    db: Session,
    user_ids: list[UUID],
    role: str,
    *,
    also_remove: tuple[str, ...] = (),
) -> BulkRoleChangeResult:
    """Grant `role` to many users in one transaction, ensuring approval and
    clearing any `also_remove` roles. Users who already hold `role` are skipped."""
    success, not_found, already_in_state = [], [], []

    for user_id in user_ids:
        user = db.get(User, user_id)
        if not user:
            not_found.append(str(user_id))
            continue

        roles = _get_roles(db, user_id)
        if role in roles:
            already_in_state.append(user)
            continue

        _apply_grant(db, user_id, role, roles, also_remove)
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


def approve_users_bulk(db: Session, user_ids: list[UUID]) -> BulkRoleChangeResult:
    """Grant approval to multiple users."""
    return _bulk_grant_role(db, user_ids, ROLE_APPROVED)


def revoke_approval_bulk(db: Session, user_ids: list[UUID]) -> BulkRoleChangeResult:
    """Revoke approval from multiple users."""
    return _bulk_revoke_role(db, user_ids, ROLE_APPROVED)


def grant_admin_bulk(db: Session, user_ids: list[UUID]) -> BulkRoleChangeResult:
    """Grant admin to multiple users, granting approval and clearing visitor."""
    return _bulk_grant_role(db, user_ids, ROLE_ADMIN, also_remove=(ROLE_VISITOR,))


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


def grant_visitor_bulk(db: Session, user_ids: list[UUID]) -> BulkRoleChangeResult:
    """Grant visitor to multiple users, granting approval if needed."""
    return _bulk_grant_role(db, user_ids, ROLE_VISITOR)


def revoke_visitor_bulk(db: Session, user_ids: list[UUID]) -> BulkRoleChangeResult:
    """Revoke visitor from multiple users; each remains a standard approved user."""
    return _bulk_revoke_role(db, user_ids, ROLE_VISITOR)


# ============================================================================
# User Denial (Deletion of Unapproved Users)
# ============================================================================


def deny_user(db: Session, user_id: UUID) -> User | None:
    """
    Deny (delete) an unapproved user from the system.

    This permanently removes users who have not yet been approved.
    Prevents deletion of approved users or admins.

    Args:
        db: Database session
        user_id: User ID to deny/delete

    Returns:
        The deleted user object, or None if user not found

    Raises:
        HTTPException 409: If user is already approved or is an admin
    """
    user = db.get(User, user_id)
    if not user:
        return None

    # Prevent deletion of approved or admin users
    if has_role(db, user_id, ROLE_APPROVED):
        raise HTTPException(
            status_code=409, detail="Cannot deny an approved user. Use revoke approval instead."
        )

    if has_role(db, user_id, ROLE_ADMIN):
        raise HTTPException(
            status_code=409, detail="Cannot deny an admin user. Revoke admin role first."
        )

    # Delete the user (roles will be cascade deleted)
    db.delete(user)
    db.commit()

    return user


def deny_users_bulk(db: Session, user_ids: list[UUID]) -> BulkRoleChangeResult:
    """Deny (delete) multiple unapproved users. Approved or admin users are skipped."""
    success, not_found, already_in_state = [], [], []

    for user_id in user_ids:
        user = db.get(User, user_id)
        if not user:
            not_found.append(str(user_id))
            continue

        if has_role(db, user_id, ROLE_APPROVED) or has_role(db, user_id, ROLE_ADMIN):
            already_in_state.append(user)
            continue

        db.delete(user)
        success.append(user)

    if success:
        db.commit()

    return BulkRoleChangeResult(success, not_found, already_in_state)


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

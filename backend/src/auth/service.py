from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.auth.constants import ROLE_ADMIN, ROLE_APPROVED, ROLE_USER
from src.auth.models import User, UserRole
from src.auth.providers.base import AuthenticatedUser
from src.config import get_settings

settings = get_settings()


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


def _get_user_by_external_id(
    db: Session,
    issuer: str,
    external_uid: str,
) -> User | None:
    """Find user by external identity provider credentials."""
    stmt = select(User).where(
        User.issuer == issuer,
        User.external_uid == external_uid,
    )
    return db.scalar(stmt)


# ============================================================================
# User Registration & Retrieval
# ============================================================================


def register_user(db: Session, token: AuthenticatedUser, issuer: str) -> User:
    """
    Register or retrieve user from external authentication token.

    If user already exists, returns existing user. Otherwise creates
    a new user record.

    Args:
        db: Database session
        token: Authenticated user data from external provider
        issuer: Name of the authentication provider

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

    if not token.get("email"):
        raise ValueError("Cannot register user without email from authentication provider")

    display_name = token.get("name") or token["email"].split("@")[0]

    user = User(
        issuer=issuer,
        external_uid=token["uid"],
        email=token["email"],
        display_name=display_name,
    )

    db.add(user)
    db.flush()

    if issuer == "local":
        for role in (ROLE_USER, ROLE_APPROVED, ROLE_ADMIN):
            db.add(UserRole(user_id=user.id, role=role))

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


# ============================================================================
# User Approval Management
# ============================================================================


def approve_user(db: Session, user_id: UUID) -> User | None:
    """
    Grant approval role to a user.

    Approval is required for users to access most application features.

    Args:
        db: Database session
        user_id: User ID to approve

    Returns:
        Updated user object, or None if user not found
    """
    user = db.get(User, user_id)
    if not user:
        return None

    if not has_role(db, user_id, ROLE_APPROVED):
        db.add(UserRole(user_id=user_id, role=ROLE_APPROVED))
        db.commit()
        db.refresh(user)

    return user


def revoke_approval(db: Session, user_id: UUID) -> User | None:
    """
    Revoke approval role from a user.

    Removes user's access to most application features.

    Args:
        db: Database session
        user_id: User ID to revoke approval from

    Returns:
        Updated user object, or None if user not found
    """
    user = db.get(User, user_id)
    if not user:
        return None

    stmt = select(UserRole).where(
        UserRole.user_id == user_id,
        UserRole.role == ROLE_APPROVED,
    )
    role = db.scalar(stmt)

    if role:
        db.delete(role)
        db.commit()
        db.refresh(user)

    return user


# ============================================================================
# Admin Role Management
# ============================================================================


def grant_admin(db: Session, user_id: UUID) -> User | None:
    """
    Grant admin role to a user.

    Automatically grants approved role if not already present.
    Admins have full system access.

    Args:
        db: Database session
        user_id: User ID to grant admin role to

    Returns:
        Updated user object, or None if user not found
    """
    user = db.get(User, user_id)
    if not user:
        return None

    roles = _get_roles(db, user_id)

    # Admins must also be approved
    if ROLE_APPROVED not in roles:
        db.add(UserRole(user_id=user_id, role=ROLE_APPROVED))

    if ROLE_ADMIN not in roles:
        db.add(UserRole(user_id=user_id, role=ROLE_ADMIN))

    db.commit()
    db.refresh(user)
    return user


def revoke_admin(db: Session, user_id: UUID) -> User | None:
    """
    Revoke admin role from a user.

    Prevents revoking admin from the last admin user in the system.

    Args:
        db: Database session
        user_id: User ID to revoke admin role from

    Returns:
        Updated user object, or None if user not found

    Raises:
        HTTPException 409: If attempting to revoke the last admin user
    """
    user = db.get(User, user_id)
    if not user:
        return None

    stmt = select(UserRole).where(
        UserRole.user_id == user_id,
        UserRole.role == ROLE_ADMIN,
    )
    role = db.scalar(stmt)

    if not role:
        return user  # Already not admin

    # Prevent removing the last admin
    if _admin_count(db) <= 1:
        raise HTTPException(status_code=409, detail="Cannot revoke admin from the last admin user")

    db.delete(role)
    db.commit()
    db.refresh(user)
    return user


# ============================================================================
# Bulk Operations
# ============================================================================


def approve_users_bulk(db: Session, user_ids: list[UUID]) -> dict:
    """
    Grant approval role to multiple users.

    Processes all users in a single transaction. Returns results indicating
    which users were approved, which were not found, and which failed.

    Args:
        db: Database session
        user_ids: List of user IDs to approve

    Returns:
        Dictionary with 'approved', 'not_found', and 'already_approved' lists
    """
    result = {
        "approved": [],
        "not_found": [],
        "already_approved": [],
    }

    for user_id in user_ids:
        user = db.get(User, user_id)
        if not user:
            result["not_found"].append(str(user_id))
            continue

        if has_role(db, user_id, ROLE_APPROVED):
            result["already_approved"].append(user)
        else:
            db.add(UserRole(user_id=user_id, role=ROLE_APPROVED))
            result["approved"].append(user)

    if result["approved"]:
        db.commit()
        # Refresh all approved users
        for user in result["approved"]:
            db.refresh(user)

    return result


def revoke_approval_bulk(db: Session, user_ids: list[UUID]) -> dict:
    """
    Revoke approval role from multiple users.

    Processes all users in a single transaction. Returns results indicating
    which users had approval revoked, which were not found, and which weren't approved.

    Args:
        db: Database session
        user_ids: List of user IDs to revoke approval from

    Returns:
        Dictionary with 'revoked', 'not_found', and 'not_approved' lists
    """
    result = {
        "revoked": [],
        "not_found": [],
        "not_approved": [],
    }

    for user_id in user_ids:
        user = db.get(User, user_id)
        if not user:
            result["not_found"].append(str(user_id))
            continue

        stmt = select(UserRole).where(
            UserRole.user_id == user_id,
            UserRole.role == ROLE_APPROVED,
        )
        role = db.scalar(stmt)

        if role:
            db.delete(role)
            result["revoked"].append(user)
        else:
            result["not_approved"].append(user)

    if result["revoked"]:
        db.commit()
        # Refresh all revoked users
        for user in result["revoked"]:
            db.refresh(user)

    return result


def grant_admin_bulk(db: Session, user_ids: list[UUID]) -> dict:
    """
    Grant admin role to multiple users.

    Automatically grants approved role if not already present for each user.
    Processes all users in a single transaction.

    Args:
        db: Database session
        user_ids: List of user IDs to grant admin role to

    Returns:
        Dictionary with 'granted', 'not_found', and 'already_admin' lists
    """
    result = {
        "granted": [],
        "not_found": [],
        "already_admin": [],
    }

    for user_id in user_ids:
        user = db.get(User, user_id)
        if not user:
            result["not_found"].append(str(user_id))
            continue

        roles = _get_roles(db, user_id)

        if ROLE_ADMIN in roles:
            result["already_admin"].append(user)
            continue

        # Admins must also be approved
        if ROLE_APPROVED not in roles:
            db.add(UserRole(user_id=user_id, role=ROLE_APPROVED))

        db.add(UserRole(user_id=user_id, role=ROLE_ADMIN))
        result["granted"].append(user)

    if result["granted"]:
        db.commit()
        # Refresh all granted users
        for user in result["granted"]:
            db.refresh(user)

    return result


def revoke_admin_bulk(db: Session, user_ids: list[UUID]) -> dict:
    """
    Revoke admin role from multiple users.

    Prevents revoking admin from users if it would leave no admins in the system.
    Processes all users in a single transaction.

    Args:
        db: Database session
        user_ids: List of user IDs to revoke admin role from

    Returns:
        Dictionary with 'revoked', 'not_found', and 'not_admin' lists

    Raises:
        HTTPException 409: If attempting to revoke all remaining admin users
    """
    result = {
        "revoked": [],
        "not_found": [],
        "not_admin": [],
    }

    # Check how many admins would remain
    current_admin_count = _admin_count(db)
    admin_users_to_revoke = []

    for user_id in user_ids:
        user = db.get(User, user_id)
        if not user:
            result["not_found"].append(str(user_id))
            continue

        stmt = select(UserRole).where(
            UserRole.user_id == user_id,
            UserRole.role == ROLE_ADMIN,
        )
        role = db.scalar(stmt)

        if role:
            admin_users_to_revoke.append((user, role))
        else:
            result["not_admin"].append(user)

    # Prevent removing all admins
    admins_after_revoke = current_admin_count - len(admin_users_to_revoke)
    if admins_after_revoke < 1:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot revoke admin from {len(admin_users_to_revoke)} user(s). "
                f"This would leave no admin users in the system."
            ),
        )

    # Perform revocations
    for user, role in admin_users_to_revoke:
        db.delete(role)
        result["revoked"].append(user)

    if result["revoked"]:
        db.commit()
        # Refresh all revoked users
        for user in result["revoked"]:
            db.refresh(user)

    return result


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


def deny_users_bulk(db: Session, user_ids: list[UUID]) -> dict:
    """
    Deny (delete) multiple unapproved users from the system.

    Processes all users in a single transaction. Returns results indicating
    which users were deleted, which were not found, and which couldn't be denied.

    Args:
        db: Database session
        user_ids: List of user IDs to deny/delete

    Returns:
        Dictionary with 'denied', 'not_found', and 'cannot_deny' lists
    """
    result = {
        "denied": [],
        "not_found": [],
        "cannot_deny": [],
    }

    users_to_delete = []

    for user_id in user_ids:
        user = db.get(User, user_id)
        if not user:
            result["not_found"].append(str(user_id))
            continue

        # Check if user can be denied
        if has_role(db, user_id, ROLE_APPROVED) or has_role(db, user_id, ROLE_ADMIN):
            result["cannot_deny"].append(user)
            continue

        users_to_delete.append(user)

    # Delete all eligible users
    for user in users_to_delete:
        db.delete(user)
        result["denied"].append(user)

    if result["denied"]:
        db.commit()

    return result


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

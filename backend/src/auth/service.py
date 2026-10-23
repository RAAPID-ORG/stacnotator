from typing import NamedTuple
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.auth.constants import AGENT_ISSUER, TERMS_VERSION
from src.auth.models import User
from src.auth.providers.base import AuthenticatedUser
from src.auth.usernames import username_error
from src.organizations.service import consume_invites_for_new_user

# ============================================================================
# Internal Helper Functions
# ============================================================================


def _admin_count(db: Session) -> int:
    return db.scalar(select(func.count()).where(User.is_platform_admin)) or 0


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
    grants_platform_admin: bool = False,
) -> User:
    """
    Register or retrieve user from external authentication token.

    If user already exists, returns existing user. Otherwise creates
    a new user record.

    Args:
        db: Database session
        token: Authenticated user data from external provider
        issuer: Name of the authentication provider
        grants_platform_admin: Whether a first registration through this
            provider makes the user a platform admin (local auth does)

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

    # No name is derived here: a username has to be unique, and the one the
    # provider hands over (a Google display name, an email local part) is not.
    # The client asks for one before the app opens up.
    user = User(
        issuer=issuer,
        external_uid=token["uid"],
        email=email,
        display_name=None,
        is_platform_admin=grants_platform_admin,
    )

    db.add(user)
    db.flush()

    consume_invites_for_new_user(db, user)

    db.commit()
    db.refresh(user)

    return user


def get_all_users(db: Session) -> list[User]:
    """Every person in the system, sorted by display name (email fallback). Labelling
    agents are left out: this list is what admins pick members from."""
    stmt = (
        select(User)
        .where(User.issuer != AGENT_ISSUER)
        .order_by(func.lower(func.coalesce(User.display_name, User.email)))
    )
    return list(db.scalars(stmt).all())


# ============================================================================
# Platform Admin Management
# ============================================================================


class BulkAdminChangeResult(NamedTuple):
    """Shaped to match BulkUserActionResponse."""

    success: list[User]
    not_found: list[str]
    already_in_state: list[User]


def _set_platform_admin(db: Session, user_ids: list[UUID], value: bool) -> BulkAdminChangeResult:
    success, not_found, already_in_state = [], [], []
    for user_id in user_ids:
        user = db.get(User, user_id)
        if user is None:
            not_found.append(str(user_id))
        elif user.is_platform_admin == value:
            already_in_state.append(user)
        else:
            success.append(user)

    if not value and _admin_count(db) - len(success) < 1:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot revoke admin from {len(success)} user(s). "
                "This would leave no admin users in the system."
            ),
        )

    for user in success:
        user.is_platform_admin = value
    if success:
        db.commit()
        for user in success:
            db.refresh(user)
    return BulkAdminChangeResult(success, not_found, already_in_state)


def grant_admin_bulk(db: Session, user_ids: list[UUID]) -> BulkAdminChangeResult:
    return _set_platform_admin(db, user_ids, True)


def revoke_admin_bulk(db: Session, user_ids: list[UUID]) -> BulkAdminChangeResult:
    """Refuses to remove the last platform admin."""
    return _set_platform_admin(db, user_ids, False)


# ============================================================================
# Admin Metadata Management
# ============================================================================


def edit_user_info(
    db: Session,
    user_id: UUID,
    display_name: str,
) -> User | None:
    """Set the user's username, the single name they are known by.

    Rejects a malformed name (400) and one already taken (409). The lookup is
    case-insensitive to match the unique index behind it, which is what keeps
    two people from becoming the same name through a race."""
    user = db.get(User, user_id)
    if not user:
        return None

    display_name = display_name.strip()
    invalid = username_error(display_name)
    if invalid:
        raise HTTPException(status_code=400, detail=invalid)
    if is_username_taken(db, display_name, exclude_user_id=user_id):
        raise HTTPException(status_code=409, detail="That username is already taken")

    user.display_name = display_name
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="That username is already taken") from exc
    db.refresh(user)
    return user


def is_username_taken(db: Session, username: str, *, exclude_user_id: UUID | None = None) -> bool:
    stmt = select(User.id).where(func.lower(User.display_name) == username.lower())
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    return db.scalar(stmt) is not None


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

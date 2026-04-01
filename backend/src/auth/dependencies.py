from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from src.auth import service
from src.auth.exceptions import ExternalAuthEmailNotVerified
from src.auth.models import User
from src.auth.providers import get_auth_provider
from src.database import get_db


async def require_authenticated_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    """
    Verify user is authenticated via external provider and exists in database.

    Authenticates the request against the configured auth provider,
    then ensures the user record exists in the local database.

    Args:
        request: FastAPI request object
        db: Database session

    Returns:
        Authenticated user from database

    Raises:
        HTTPException: 401 if authentication fails
        HTTPException: 403 if email is not verified
    """
    auth_provider = get_auth_provider()
    try:
        auth_user = await auth_provider.authenticate(request)
    except ExternalAuthEmailNotVerified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="email_not_verified",
        ) from None

    if not auth_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )

    # Ensure user exists in DB (creates if first login)
    user = service.register_user(db, auth_user, auth_provider.name)
    return user


async def require_approved_user(
    user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db),
) -> User:
    """
    Verify user is authenticated and has approved status.

    Ensures the user has been granted the 'approved' role,
    which is required for most application features.

    # TODO might want to add this directly in most routers

    Args:
        user: Authenticated user
        db: Database session

    Returns:
        Approved user

    Raises:
        HTTPException: 403 if user is not approved
    """
    if not user.is_approved:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account not approved",
        )
    return user


def require_admin(
    user: User = Depends(require_approved_user),
    db: Session = Depends(get_db),
) -> User:
    """
    Verify user is authenticated, approved, and has admin privileges.

    Ensures the user has admin role for platform administrative operations.

    Args:
        user: Authenticated and approved user
        db: Database session

    Returns:
        Admin user

    Raises:
        HTTPException: 403 if user is not an admin
    """
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user

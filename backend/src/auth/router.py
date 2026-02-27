from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth import service
from src.auth.dependencies import require_admin, require_authenticated_user
from src.auth.models import User
from src.auth.schemas import (
    BulkUserActionRequest,
    BulkUserActionResponse,
    UserOutDetailed,
)
from src.database import get_db
from src.utils import FunctionNameOperationIdRoute

bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    prefix="/auth",
    tags=["Auth"],
    dependencies=[Depends(bearer)],
    route_class=FunctionNameOperationIdRoute,
)


# ============================================================================
# User Info & Listing & Edit Info
# ============================================================================


@router.get("/me", response_model=UserOutDetailed)
def me(
    user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db),
):
    """Get current authenticated user's details."""
    return user


@router.get("/users", response_model=list[UserOutDetailed])
def list_users(
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """List all users in the system (admin only)."""
    return service.get_all_users(db)


@router.patch("/users/{user_id}", response_model=UserOutDetailed)
def edit_user_info(
    user_id: UUID,
    new_display_name: str,
    user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db),
):
    """
    Edit user display name.

    Users can edit their own information.
    Admins can edit any user's information.
    """
    if user.id != user_id and not user.is_admin:
        raise HTTPException(
            status_code=403, detail="Not authorized to edit this user's information"
        )

    updated_user = service.edit_user_info(db, user_id, new_display_name)

    if updated_user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return updated_user


# ============================================================================
#  User Approval Operations
# ============================================================================


@router.post("/users/{user_id}/approve", response_model=UserOutDetailed)
def approve_user(
    user_id: UUID,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Approve a single user (admin only).

    Grants approval role to the specified user.
    """
    approved_user = service.approve_user(db, user_id)

    if approved_user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return approved_user


@router.post("/users/{user_id}/revoke", response_model=UserOutDetailed)
def revoke_user(
    user_id: UUID,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Revoke approval from a single user (admin only).

    Removes approval role from the specified user.
    """
    revoked_user = service.revoke_approval(db, user_id)

    if revoked_user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return revoked_user


@router.post("/users/{user_id}/deny", response_model=UserOutDetailed)
def deny_user(
    user_id: UUID,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Deny (delete) an unapproved user from the system (admin only).

    Permanently removes users who have not been approved yet.
    Cannot be used on approved users or admins.
    """
    try:
        denied_user = service.deny_user(db, user_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    if denied_user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return denied_user


@router.post("/users/approve", response_model=BulkUserActionResponse)
def approve_users_bulk(
    request: BulkUserActionRequest,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Approve multiple users (admin only).

    Grants approval role to all specified users in a single transaction.
    """
    result = service.approve_users_bulk(db, request.user_ids)

    return BulkUserActionResponse(
        success=result["approved"],
        not_found=result["not_found"],
        already_in_state=result["already_approved"],
    )


@router.post("/users/revoke", response_model=BulkUserActionResponse)
def revoke_users_bulk(
    request: BulkUserActionRequest,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Revoke approval from multiple users (admin only).

    Removes approval role from all specified users in a single transaction.
    """
    result = service.revoke_approval_bulk(db, request.user_ids)

    return BulkUserActionResponse(
        success=result["revoked"],
        not_found=result["not_found"],
        already_in_state=result["not_approved"],
    )


@router.post("/users/deny", response_model=BulkUserActionResponse)
def deny_users_bulk(
    request: BulkUserActionRequest,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Deny (delete) multiple unapproved users from the system (admin only).

    Permanently removes users who have not been approved yet.
    Users who are already approved or are admins will not be deleted.
    """
    result = service.deny_users_bulk(db, request.user_ids)

    return BulkUserActionResponse(
        success=result["denied"],
        not_found=result["not_found"],
        already_in_state=result["cannot_deny"],
    )


# ============================================================================
# Admin Role Operations
# ============================================================================


@router.post("/users/{user_id}/grant-admin", response_model=UserOutDetailed)
def grant_admin_single(
    user_id: UUID,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Grant admin role to a single user (admin only).

    Grants admin and approval roles to the specified user.
    """
    user = service.grant_admin(db, user_id)

    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return user


@router.post("/users/{user_id}/revoke-admin", response_model=UserOutDetailed)
def revoke_admin_single(
    user_id: UUID,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Revoke admin role from a single user (admin only).

    Removes admin role from the specified user.
    Prevents revoking admin from the last admin user.
    """
    try:
        user = service.revoke_admin(db, user_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return user


@router.post("/users/grant-admin", response_model=BulkUserActionResponse)
def grant_admin(
    request: BulkUserActionRequest,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Grant admin role to multiple users (admin only).

    Grants admin and approval roles to all specified users in a single transaction.
    """
    result = service.grant_admin_bulk(db, request.user_ids)

    return BulkUserActionResponse(
        success=result["granted"],
        not_found=result["not_found"],
        already_in_state=result["already_admin"],
    )


@router.post("/users/revoke-admin", response_model=BulkUserActionResponse)
def revoke_admin(
    request: BulkUserActionRequest,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Revoke admin role from multiple users (admin only).

    Removes admin role from all specified users in a single transaction.
    Prevents revoking admin from all users if it would leave no admins.
    """
    try:
        result = service.revoke_admin_bulk(db, request.user_ids)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e

    return BulkUserActionResponse(
        success=result["revoked"],
        not_found=result["not_found"],
        already_in_state=result["not_admin"],
    )

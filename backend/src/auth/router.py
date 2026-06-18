from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth import service
from src.auth.dependencies import require_admin, require_approved_user, require_authenticated_user
from src.auth.models import User
from src.auth.schemas import (
    BulkUserActionRequest,
    BulkUserActionResponse,
    UserOutDetailed,
)
from src.campaigns.service import list_campaigns_with_user_roles
from src.config import get_settings
from src.database import get_db
from src.tiling import registry
from src.tiling.tiler_token import mint as mint_tiler_token
from src.utils import FunctionNameOperationIdRoute

bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    prefix="/auth",
    tags=["Auth"],
    dependencies=[Depends(bearer)],
    route_class=FunctionNameOperationIdRoute,
)


def _bulk_response(result: dict) -> BulkUserActionResponse:
    """Map a bulk service result ({success, not_found, skipped}) to the response."""
    return BulkUserActionResponse(
        success=result["success"],
        not_found=result["not_found"],
        already_in_state=result["skipped"],
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


TILER_TOKEN_TTL = 3600  # 1 hour


@router.get("/tiler-token")
def get_tiler_token(
    response: Response,
    user: User = Depends(require_approved_user),
    db: Session = Depends(get_db),
):
    """Set a short-lived, campaign-scoped tiler HttpOnly cookie (approved users only)."""
    settings = get_settings()
    campaigns = [str(row["campaign"].id) for row in list_campaigns_with_user_roles(db, user.id)]
    token = mint_tiler_token(user.id, campaigns, scope=["tiles:read"], ttl=TILER_TOKEN_TTL)
    response.set_cookie(
        key="tiler_token",
        value=token,
        max_age=TILER_TOKEN_TTL,
        httponly=True,
        secure=settings.TILER_COOKIE_SECURE,
        samesite=settings.TILER_COOKIE_SAMESITE,
        domain=settings.TILER_COOKIE_DOMAIN,
        path="/",
    )
    return {"expires_in": TILER_TOKEN_TTL}


@router.get("/users", response_model=list[UserOutDetailed])
def list_users(
    user: User = Depends(require_approved_user),
    db: Session = Depends(get_db),
):
    """
    List users in the system.

    Platform admins see all users (including pending/denied). Other approved
    users see only approved users - needed so campaign admins can pick members
    to add to their campaigns.
    """
    users = service.get_all_users(db)
    if user.is_admin:
        return users
    return [u for u in users if u.is_approved]


@router.patch("/users/{user_id}", response_model=UserOutDetailed)
def edit_user_info(
    user_id: UUID,
    new_display_name: str = Query(..., min_length=1, max_length=100),
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
    denied_user = service.deny_user(db, user_id)

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
    return _bulk_response(service.approve_users_bulk(db, request.user_ids))


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
    return _bulk_response(service.revoke_approval_bulk(db, request.user_ids))


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
    return _bulk_response(service.deny_users_bulk(db, request.user_ids))


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
    user = service.revoke_admin(db, user_id)

    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return user


def _validate_grantable_tiler(tiler_name: str) -> None:
    if not registry.is_known(tiler_name):
        raise HTTPException(status_code=400, detail=f"Unknown tiler '{tiler_name}'")


@router.get("/grantable-tilers", response_model=list[str])
def list_grantable_tilers(_: dict = Depends(require_admin)):
    """All configured tilers an admin can toggle per user (MPC + hosted)."""
    return registry.all_names()


@router.post("/users/{user_id}/tilers/{tiler_name}", response_model=UserOutDetailed)
def grant_tiler_single(
    user_id: UUID,
    tiler_name: str,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Grant a user access to an extra hosted tiler (admin only)."""
    _validate_grantable_tiler(tiler_name)
    user = service.grant_tiler(db, user_id, tiler_name)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.delete("/users/{user_id}/tilers/{tiler_name}", response_model=UserOutDetailed)
def revoke_tiler_single(
    user_id: UUID,
    tiler_name: str,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Revoke a user's access to an extra hosted tiler (admin only)."""
    _validate_grantable_tiler(tiler_name)
    user = service.revoke_tiler(db, user_id, tiler_name)
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
    return _bulk_response(service.grant_admin_bulk(db, request.user_ids))


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
    return _bulk_response(service.revoke_admin_bulk(db, request.user_ids))


# ============================================================================
# Visitor Role Operations
# ============================================================================


@router.post("/users/{user_id}/grant-visitor", response_model=UserOutDetailed)
def grant_visitor_single(
    user_id: UUID,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Grant visitor role to a single user (admin only).

    Grants the visitor and approval roles. Visitors cannot create campaigns.
    """
    user = service.grant_visitor(db, user_id)

    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return user


@router.post("/users/{user_id}/revoke-visitor", response_model=UserOutDetailed)
def revoke_visitor_single(
    user_id: UUID,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Revoke visitor role from a single user (admin only).

    The user remains approved (standard) and regains campaign-creation access.
    """
    user = service.revoke_visitor(db, user_id)

    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return user


@router.post("/users/grant-visitor", response_model=BulkUserActionResponse)
def grant_visitor(
    request: BulkUserActionRequest,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Grant visitor role to multiple users (admin only).

    Grants the visitor and approval roles to all specified users in a single
    transaction.
    """
    return _bulk_response(service.grant_visitor_bulk(db, request.user_ids))


@router.post("/users/revoke-visitor", response_model=BulkUserActionResponse)
def revoke_visitor(
    request: BulkUserActionRequest,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Revoke visitor role from multiple users (admin only).

    Each user remains approved (standard). Processes all users in a single
    transaction.
    """
    return _bulk_response(service.revoke_visitor_bulk(db, request.user_ids))

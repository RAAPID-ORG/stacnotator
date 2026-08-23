from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth import service
from src.auth.dependencies import require_admin, require_authenticated_user
from src.auth.models import User
from src.auth.schemas import (
    AcceptTermsRequest,
    BulkUserActionRequest,
    BulkUserActionResponse,
    MeOut,
    UserOut,
    UserOutDetailed,
)
from src.campaigns.service import visible_campaign_ids
from src.database import get_db
from src.tilers import registry
from src.tilers.tokens import TILER_TOKEN_TTL, set_tiler_cookie

bearer = HTTPBearer()  # Using only for adding bearer scheme to Swagger OpenAPI
router = APIRouter(
    prefix="/auth",
    tags=["Auth"],
    dependencies=[Depends(bearer)],
)


def _user_or_404(user: User | None) -> User:
    """Unwrap a service call's optional result, or raise the standard 404."""
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# ============================================================================
# User Info & Listing & Edit Info
# ============================================================================


@router.get("/me", response_model=MeOut)
def me(
    user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db),
):
    """Get current authenticated user's details."""
    return user


@router.post("/me/accept-terms", response_model=MeOut)
def accept_terms(
    request: AcceptTermsRequest,
    user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db),
):
    """Record that this user accepted the terms they were shown."""
    return service.accept_terms(db, user, request.version)


@router.get("/tiler-token")
def get_tiler_token(
    response: Response,
    user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db),
):
    """Set a short-lived, campaign-scoped tiler HttpOnly cookie (authenticated users only)."""
    set_tiler_cookie(response, sub=str(user.id), campaigns=visible_campaign_ids(db, user.id))
    return {"expires_in": TILER_TOKEN_TTL}


@router.get("/users", response_model=list[UserOutDetailed] | list[UserOut])
def list_users(
    user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db),
):
    """
    List users in the system.

    Platform admins get the full detailed record (email, issuer, external_uid).
    Everyone else gets id and display name only - enough for org and project
    admins to pick members to add, without handing out the platform's address book.
    """
    users = service.get_all_users(db)
    if user.is_admin:
        return users
    return [UserOut.for_viewer(u, with_email=False) for u in users]


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

    return _user_or_404(service.edit_user_info(db, user_id, new_display_name))


# ============================================================================
# Admin Role Operations
# ============================================================================


@router.post("/users/{user_id}/grant-admin", response_model=UserOutDetailed)
def grant_admin_single(
    user_id: UUID,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Grant the platform admin role to a single user (admin only)."""
    return _user_or_404(service.grant_admin(db, user_id))


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
    return _user_or_404(service.revoke_admin(db, user_id))


@router.get("/grantable-tilers", response_model=list[str])
def list_grantable_tilers(_: dict = Depends(require_admin)):
    """All configured tilers an admin can grant to an organization (MPC + hosted)."""
    return registry.all_names()


@router.post("/users/grant-admin", response_model=BulkUserActionResponse)
def grant_admin(
    request: BulkUserActionRequest,
    _: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Grant the platform admin role to multiple users in one transaction (admin only)."""
    return service.grant_admin_bulk(db, request.user_ids)


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
    return service.revoke_admin_bulk(db, request.user_ids)

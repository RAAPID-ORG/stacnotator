from uuid import UUID

from pydantic import BaseModel, ConfigDict


class UserOut(BaseModel):
    """Basic user information."""

    id: UUID
    email: str
    display_name: str | None = None

    model_config = ConfigDict(from_attributes=True)


class UserOutDetailed(UserOut):
    """Detailed user information."""

    is_approved: bool
    is_visitor: bool
    is_admin: bool
    issuer: str
    external_uid: str
    display_name: str
    # All tilers this user may set up imagery on (defaults seeded; extras added).
    allowed_tilers: list[str] = []

    model_config = ConfigDict(from_attributes=True)


class BulkUserActionRequest(BaseModel):
    """Request body for bulk user operations."""

    user_ids: list[UUID]


class BulkUserActionResponse(BaseModel):
    """Response for bulk user operations."""

    success: list[UserOutDetailed]
    not_found: list[str]
    already_in_state: list[UserOutDetailed]

    model_config = ConfigDict(from_attributes=True)

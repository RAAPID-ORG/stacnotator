from uuid import UUID

from pydantic import BaseModel, ConfigDict

from src.auth.models import User


class UserOut(BaseModel):
    """A user as other users see them. `email` is filled for platform admins
    only; everyone else identifies people by display name."""

    id: UUID
    email: str | None = None
    display_name: str

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def for_viewer(cls, user: User, *, with_email: bool) -> "UserOut":
        """display_name falls back to the email local part, which is what
        sign-up derives it from anyway, so there is always a name to show."""
        return cls(
            id=user.id,
            email=user.email if with_email else None,
            display_name=user.display_name or user.email.split("@", 1)[0],
        )


class UserOutDetailed(UserOut):
    """Detailed user information (platform admins only)."""

    email: str
    is_admin: bool
    issuer: str
    external_uid: str

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

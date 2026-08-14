from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from src.auth.schemas import UserOut


class OrganizationOut(BaseModel):
    id: int
    name: str
    description: str | None = None
    status: str
    allows_internal_storage: bool
    # Viewer-relative flag, filled by the service.
    is_admin: bool = False

    model_config = ConfigDict(from_attributes=True)


class OrganizationsListResponse(BaseModel):
    items: list[OrganizationOut]


MembershipStanding = Literal["none", "pending", "active"]


class OrganizationDirectoryEntry(BaseModel):
    """An organization as a non-member sees it, with where they stand: not in
    it, waiting on an access request, or already a member."""

    id: int
    name: str
    description: str | None = None
    membership: MembershipStanding


class OrganizationDirectoryResponse(BaseModel):
    items: list[OrganizationDirectoryEntry]


class AccessRequestCreate(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class AccessRequestOut(BaseModel):
    user: UserOut
    note: str | None = None
    requested_at: datetime


class AccessRequestsResponse(BaseModel):
    items: list[AccessRequestOut]


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class OrganizationUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None


class InternalStorageUpdateRequest(BaseModel):
    allows_internal_storage: bool


class OrganizationUserOut(BaseModel):
    user: UserOut
    is_admin: bool
    status: str

    model_config = ConfigDict(from_attributes=True)


class OrganizationUsersResponse(BaseModel):
    organization_id: int
    users: list[OrganizationUserOut]


class AddUsersByEmailRequest(BaseModel):
    emails: list[str] = Field(min_length=1)


class AddUsersByEmailResult(BaseModel):
    added: list[UserOut]
    # Not-yet-registered emails, stored as invites: they join automatically
    # once they sign up with that email.
    invited_emails: list[str]


class InviteOut(BaseModel):
    id: int
    email: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InvitesListResponse(BaseModel):
    items: list[InviteOut]


class OrganizationTilersOut(BaseModel):
    tiler_names: list[str]


class SetOrganizationTilersRequest(BaseModel):
    tiler_names: list[str]

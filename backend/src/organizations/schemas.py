from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from src import net_guard
from src.auth.schemas import UserOut


class OrganizationOut(BaseModel):
    id: int
    name: str
    description: str | None = None
    status: str
    allows_internal_storage: bool
    # Viewer-relative flags, filled by the service. The count is the admin's
    # to-do list (access requests waiting on them) and stays 0 for everyone else.
    is_admin: bool = False
    pending_access_requests: int = 0

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
    # These reach a SQL lookup and, when unmatched, become stored invites, so the
    # field has to mean "address" rather than "string": a bare str let a NUL byte
    # through to psycopg2 as a 500 and let junk be persisted as an invite.
    emails: list[EmailStr] = Field(min_length=1)


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


def _tile_host(raw: str) -> str:
    """The hostname an admin named for a key, however they wrote it.

    A pasted URL is as good as a bare host. The dot is the one shape check: it
    rejects a key value fat-fingered into this box, which would otherwise bind
    the key to a host that can never match and silently stop its tiles.
    """
    host = net_guard.hostname_of(raw)
    if host is None or "." not in host:
        raise ValueError("Enter the provider's tile host, e.g. tiles.planet.com")
    return host


class OrganizationApiKeyOut(BaseModel):
    """A stored provider key, named. The secret itself is never returned."""

    id: int
    name: str
    # Null only on keys stored before hosts were bound; those serve no tiles
    # until an admin sets one.
    allowed_tile_host: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OrganizationApiKeysResponse(BaseModel):
    items: list[OrganizationApiKeyOut]


class OrganizationApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    value: str = Field(min_length=1)
    # Required on the way in: a key with nowhere to go is the state this binding
    # exists to prevent, so it is never one a new key can be created in.
    allowed_tile_host: str = Field(min_length=1, max_length=255)

    _normalize_host = field_validator("allowed_tile_host")(_tile_host)


class OrganizationApiKeyUpdate(BaseModel):
    """Rotation: the same key under the same name, optionally re-pointed."""

    value: str = Field(min_length=1)
    allowed_tile_host: str | None = Field(default=None, max_length=255)

    @field_validator("allowed_tile_host")
    @classmethod
    def _normalize_host(cls, v: str | None) -> str | None:
        return None if v is None else _tile_host(v)


class OrganizationTilersOut(BaseModel):
    tiler_names: list[str]


class SetOrganizationTilersRequest(BaseModel):
    tiler_names: list[str]

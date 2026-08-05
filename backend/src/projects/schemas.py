from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.auth.schemas import UserOut


class ProjectOut(BaseModel):
    id: int
    organization_id: int
    name: str
    description: str | None = None
    is_public: bool
    created_at: datetime
    # Viewer-relative flags, filled by the service.
    is_admin: bool = False
    is_member: bool = False
    has_access: bool = False
    campaign_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ProjectsListResponse(BaseModel):
    items: list[ProjectOut]


class ProjectCreate(BaseModel):
    organization_id: int
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    is_public: bool = False


class ProjectUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    is_public: bool | None = None


class TilerOption(BaseModel):
    """A tiler the owning organization may use, from the unified registry."""

    name: str
    kind: str  # "mpc" | "hosted"
    url: str | None = None  # browser-facing URL (hosted only; null for MPC)
    is_default: bool  # default hosted pick for non-MPC collections


class ProjectTilersOut(BaseModel):
    """What the imagery wizard may configure for a project: the organization's
    tiler allowlist and whether its imagery may sit in internal storage."""

    tilers: list[TilerOption]
    allows_internal_storage: bool


class ProjectUserOut(BaseModel):
    user: UserOut
    is_admin: bool
    is_authoritative_reviewer: bool

    model_config = ConfigDict(from_attributes=True)


class ProjectUsersResponse(BaseModel):
    project_id: int
    users: list[ProjectUserOut]


class AddProjectUsersByEmailRequest(BaseModel):
    emails: list[str] = Field(min_length=1)


class AddProjectUsersByIdsRequest(BaseModel):
    user_ids: list[UUID] = Field(min_length=1)

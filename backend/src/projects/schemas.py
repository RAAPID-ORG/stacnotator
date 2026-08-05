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

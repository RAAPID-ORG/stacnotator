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
    # Not-yet-registered emails. Phase 3 turns these into stored invites;
    # for now the caller relays them back to the admin.
    unknown_emails: list[str]


class OrganizationTilersOut(BaseModel):
    tiler_names: list[str]


class SetOrganizationTilersRequest(BaseModel):
    tiler_names: list[str]

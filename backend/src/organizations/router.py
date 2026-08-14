from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import require_admin, require_authenticated_user
from src.auth.models import User
from src.auth.schemas import UserOut
from src.database import get_db
from src.organizations import service
from src.organizations.dependencies import require_org_admin, require_org_member
from src.organizations.models import Organization
from src.organizations.schemas import (
    AccessRequestCreate,
    AccessRequestOut,
    AccessRequestsResponse,
    AddUsersByEmailRequest,
    AddUsersByEmailResult,
    InternalStorageUpdateRequest,
    InviteOut,
    InvitesListResponse,
    OrganizationCreate,
    OrganizationDirectoryEntry,
    OrganizationDirectoryResponse,
    OrganizationOut,
    OrganizationsListResponse,
    OrganizationTilersOut,
    OrganizationUpdateRequest,
    OrganizationUserOut,
    OrganizationUsersResponse,
    SetOrganizationTilersRequest,
)

bearer = HTTPBearer()
router = APIRouter(
    prefix="/organizations",
    tags=["Organizations"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


def _to_out(org: Organization, is_admin: bool) -> OrganizationOut:
    out = OrganizationOut.model_validate(org)
    out.is_admin = is_admin
    return out


@router.post("/", response_model=OrganizationOut, status_code=201)
def request_organization(
    body: OrganizationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
):
    org = service.request_organization(db, name=body.name, description=body.description, user=user)
    return _to_out(org, is_admin=True)


@router.get("/", response_model=OrganizationsListResponse)
def list_organizations(
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
):
    pairs = service.list_organizations_for_user(db, user)
    return OrganizationsListResponse(items=[_to_out(org, admin) for org, admin in pairs])


@router.get("/directory", response_model=OrganizationDirectoryResponse)
def list_organization_directory(
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
):
    """Every approved organization, whether or not the viewer belongs to it,
    so they can find one to ask to join."""
    return OrganizationDirectoryResponse(
        items=[
            OrganizationDirectoryEntry(
                id=org.id, name=org.name, description=org.description, membership=membership
            )
            for org, membership in service.list_directory(db, user)
        ]
    )


@router.post("/{organization_id}/access-request", status_code=204)
def request_organization_access(
    organization_id: int,
    body: AccessRequestCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
):
    service.request_access(db, organization_id, user, body.note)


@router.get("/{organization_id}/access-requests", response_model=AccessRequestsResponse)
def list_organization_access_requests(
    organization_id: int,
    db: Session = Depends(get_db),
    org: Organization = Depends(require_org_admin),
):
    requests = service.list_access_requests(db, organization_id)
    return AccessRequestsResponse(
        items=[
            AccessRequestOut(
                user=UserOut.model_validate(r.user),
                note=r.request_note,
                requested_at=r.created_at,
            )
            for r in requests
        ]
    )


@router.post("/{organization_id}/access-requests/{user_id}/approve", status_code=204)
def approve_organization_access_request(
    organization_id: int,
    user_id: UUID,
    db: Session = Depends(get_db),
    org: Organization = Depends(require_org_admin),
):
    service.approve_access_request(db, organization_id, user_id)


@router.post("/{organization_id}/access-requests/{user_id}/reject", status_code=204)
def reject_organization_access_request(
    organization_id: int,
    user_id: UUID,
    db: Session = Depends(get_db),
    org: Organization = Depends(require_org_admin),
):
    service.reject_access_request(db, organization_id, user_id)


@router.post("/{organization_id}/approve", response_model=OrganizationOut)
def approve_organization(
    organization_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    return _to_out(service.approve_organization(db, organization_id), is_admin=True)


@router.post("/{organization_id}/reject", response_model=OrganizationOut)
def reject_organization(
    organization_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    return _to_out(service.reject_organization(db, organization_id), is_admin=True)


@router.patch("/{organization_id}", response_model=OrganizationOut)
def update_organization(
    organization_id: int,
    body: OrganizationUpdateRequest,
    db: Session = Depends(get_db),
    org: Organization = Depends(require_org_admin),
):
    updated = service.update_organization(
        db, organization_id, name=body.name, description=body.description
    )
    return _to_out(updated, is_admin=True)


@router.patch("/{organization_id}/internal-storage", response_model=OrganizationOut)
def update_internal_storage(
    organization_id: int,
    body: InternalStorageUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    updated = service.set_internal_storage(db, organization_id, body.allows_internal_storage)
    return _to_out(updated, is_admin=True)


@router.get("/{organization_id}/users", response_model=OrganizationUsersResponse)
def get_organization_users(
    organization_id: int,
    db: Session = Depends(get_db),
    org: Organization = Depends(require_org_member),
):
    org_users = service.get_org_users(db, organization_id)
    users = [OrganizationUserOut.model_validate(ou) for ou in org_users]
    return OrganizationUsersResponse(organization_id=organization_id, users=users)


@router.post("/{organization_id}/users", response_model=AddUsersByEmailResult)
def add_organization_users(
    organization_id: int,
    body: AddUsersByEmailRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
    org: Organization = Depends(require_org_admin),
):
    added, invited = service.add_users_by_email(
        db, organization_id, body.emails, invited_by=user.id
    )
    users = [UserOut.model_validate(u) for u in added]
    return AddUsersByEmailResult(added=users, invited_emails=invited)


@router.get("/{organization_id}/invites", response_model=InvitesListResponse)
def list_organization_invites(
    organization_id: int,
    db: Session = Depends(get_db),
    org: Organization = Depends(require_org_admin),
):
    invites = service.list_pending_invites(db, organization_id=organization_id)
    return InvitesListResponse(items=[InviteOut.model_validate(i) for i in invites])


@router.delete("/{organization_id}/invites/{invite_id}", status_code=204)
def revoke_organization_invite(
    organization_id: int,
    invite_id: int,
    db: Session = Depends(get_db),
    org: Organization = Depends(require_org_admin),
):
    service.revoke_invite(db, invite_id, organization_id=organization_id)


@router.post("/{organization_id}/users/{user_id}/make-admin", status_code=204)
def make_organization_admin(
    organization_id: int,
    user_id: UUID,
    db: Session = Depends(get_db),
    org: Organization = Depends(require_org_admin),
):
    service.make_org_admin(db, organization_id, user_id)


@router.post("/{organization_id}/users/{user_id}/demote-admin", status_code=204)
def demote_organization_admin(
    organization_id: int,
    user_id: UUID,
    db: Session = Depends(get_db),
    org: Organization = Depends(require_org_admin),
):
    service.demote_org_admin(db, organization_id, user_id)


@router.delete("/{organization_id}/users/{user_id}", status_code=204)
def remove_organization_member(
    organization_id: int,
    user_id: UUID,
    db: Session = Depends(get_db),
    org: Organization = Depends(require_org_admin),
):
    service.remove_member(db, organization_id, user_id)


@router.get("/{organization_id}/tilers", response_model=OrganizationTilersOut)
def get_organization_tilers(
    organization_id: int,
    db: Session = Depends(get_db),
    org: Organization = Depends(require_org_member),
):
    return OrganizationTilersOut(tiler_names=service.get_org_tilers(db, organization_id))


@router.put("/{organization_id}/tilers", response_model=OrganizationTilersOut)
def set_organization_tilers(
    organization_id: int,
    body: SetOrganizationTilersRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    service.set_org_tilers(db, organization_id, body.tiler_names)
    return OrganizationTilersOut(tiler_names=service.get_org_tilers(db, organization_id))

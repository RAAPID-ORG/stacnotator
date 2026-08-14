from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, joinedload

from src.auth.models import User
from src.crypto import encrypt
from src.organizations.models import (
    MEMBER_STATUS_ACTIVE,
    MEMBER_STATUS_PENDING,
    ORG_STATUS_APPROVED,
    ORG_STATUS_PENDING,
    ORG_STATUS_REJECTED,
    Invite,
    Organization,
    OrganizationApiKey,
    OrganizationTiler,
    OrganizationUser,
)
from src.organizations.schemas import MembershipStanding
from src.projects.models import Project, ProjectUser
from src.tilers import registry


def normalize_emails(emails: list[str]) -> list[str]:
    """Trim, lowercase, and dedupe (preserving order), dropping empties."""
    seen: set[str] = set()
    out: list[str] = []
    for email in emails:
        normalized = email.strip().lower()
        if normalized and normalized not in seen:
            seen.add(normalized)
            out.append(normalized)
    return out


def is_active_org_member(db: Session, user_id: UUID, organization_id: int) -> bool:
    """The raw org-membership input to the access rule in projects/access.py:
    an active (not pending) membership row in an APPROVED org. Pending or
    rejected orgs grant nothing, so their members get no org-public access."""
    return (
        db.scalars(
            select(OrganizationUser)
            .join(Organization, Organization.id == OrganizationUser.organization_id)
            .where(
                OrganizationUser.user_id == user_id,
                OrganizationUser.organization_id == organization_id,
                OrganizationUser.status == MEMBER_STATUS_ACTIVE,
                Organization.status == ORG_STATUS_APPROVED,
            )
        ).first()
        is not None
    )


def _get_org(db: Session, organization_id: int) -> Organization:
    org = db.get(Organization, organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


def _seed_default_tilers(db: Session, organization_id: int) -> None:
    existing = set(
        db.scalars(
            select(OrganizationTiler.tiler_name).where(
                OrganizationTiler.organization_id == organization_id
            )
        )
    )
    for name in registry.default_access_names() - existing:
        db.add(OrganizationTiler(organization_id=organization_id, tiler_name=name))


def request_organization(
    db: Session, *, name: str, description: str | None, user: User
) -> Organization:
    """Create an org request. Platform admins get it approved immediately;
    everyone else waits in the pending queue. The creator becomes org admin."""
    if db.scalar(select(Organization).where(Organization.name == name)):
        raise HTTPException(status_code=409, detail="An organization with this name already exists")

    status = ORG_STATUS_APPROVED if user.is_admin else ORG_STATUS_PENDING
    org = Organization(name=name, description=description, status=status, created_by=user.id)
    db.add(org)
    db.flush()
    db.add(
        OrganizationUser(
            user_id=user.id,
            organization_id=org.id,
            is_admin=True,
            status=MEMBER_STATUS_ACTIVE,
        )
    )
    if status == ORG_STATUS_APPROVED:
        _seed_default_tilers(db, org.id)
    db.commit()
    db.refresh(org)
    return org


def approve_organization(db: Session, organization_id: int) -> Organization:
    org = _get_org(db, organization_id)
    org.status = ORG_STATUS_APPROVED
    _seed_default_tilers(db, org.id)
    db.commit()
    db.refresh(org)
    return org


def reject_organization(db: Session, organization_id: int) -> Organization:
    org = _get_org(db, organization_id)
    org.status = ORG_STATUS_REJECTED
    db.commit()
    db.refresh(org)
    return org


def list_organizations_for_user(db: Session, user: User) -> list[tuple[Organization, bool]]:
    """(org, viewer_is_org_admin) pairs. Platform admins see every org
    (flagged admin); others see only orgs they belong to."""
    if user.is_admin:
        orgs = db.scalars(select(Organization).order_by(Organization.created_at)).all()
        return [(org, True) for org in orgs]
    rows = db.execute(
        select(Organization, OrganizationUser.is_admin)
        .join(OrganizationUser, OrganizationUser.organization_id == Organization.id)
        .where(OrganizationUser.user_id == user.id)
        .order_by(Organization.created_at)
    ).all()
    return [(org, bool(is_admin)) for org, is_admin in rows]


def membership_standing(status: str | None) -> MembershipStanding:
    """How a membership row reads to the user it belongs to. Anything other
    than a known status means they are simply not in."""
    if status == MEMBER_STATUS_ACTIVE:
        return "active"
    if status == MEMBER_STATUS_PENDING:
        return "pending"
    return "none"


def list_directory(db: Session, user: User) -> list[tuple[Organization, MembershipStanding]]:
    """Every approved org with the viewer's standing ('none', 'pending' or
    'active'). The one listing not scoped to membership: it is what a newly
    registered user browses to find the org to ask to join. Authentication
    already requires a verified email, so every caller has one."""
    rows = db.execute(
        select(Organization, OrganizationUser.status)
        .outerjoin(
            OrganizationUser,
            (OrganizationUser.organization_id == Organization.id)
            & (OrganizationUser.user_id == user.id),
        )
        .where(Organization.status == ORG_STATUS_APPROVED)
        .order_by(func.lower(Organization.name))
    ).all()
    return [(org, membership_standing(status)) for org, status in rows]


def access_request_block(org_status: str, membership_status: str | None) -> str | None:
    """Why this user may not request access, or None when they may. An
    outstanding request is not a block: asking again just rewrites the note."""
    if org_status != ORG_STATUS_APPROVED:
        return "This organization is not accepting access requests"
    if membership_status == MEMBER_STATUS_ACTIVE:
        return "You are already a member of this organization"
    return None


def request_access(db: Session, organization_id: int, user: User, note: str | None) -> None:
    org = _get_org(db, organization_id)
    membership = db.get(OrganizationUser, (user.id, organization_id))
    blocked = access_request_block(org.status, membership.status if membership else None)
    if blocked:
        raise HTTPException(status_code=409, detail=blocked)
    if membership is None:
        db.add(
            OrganizationUser(
                user_id=user.id,
                organization_id=organization_id,
                is_admin=False,
                status=MEMBER_STATUS_PENDING,
                request_note=note,
            )
        )
    else:
        membership.request_note = note
    db.commit()


def list_access_requests(db: Session, organization_id: int) -> list[OrganizationUser]:
    return list(
        db.scalars(
            select(OrganizationUser)
            .where(
                OrganizationUser.organization_id == organization_id,
                OrganizationUser.status == MEMBER_STATUS_PENDING,
            )
            .options(joinedload(OrganizationUser.user))
            .order_by(OrganizationUser.created_at)
        ).all()
    )


def _get_access_request(db: Session, organization_id: int, user_id: UUID) -> OrganizationUser:
    membership = db.get(OrganizationUser, (user_id, organization_id))
    if membership is None or membership.status != MEMBER_STATUS_PENDING:
        raise HTTPException(status_code=404, detail="No pending access request for this user")
    return membership


def approve_access_request(db: Session, organization_id: int, user_id: UUID) -> None:
    membership = _get_access_request(db, organization_id, user_id)
    membership.status = MEMBER_STATUS_ACTIVE
    membership.request_note = None
    db.commit()


def reject_access_request(db: Session, organization_id: int, user_id: UUID) -> None:
    """Drop the request outright. The user keeps no trace of it and may ask
    again - an org admin declining once is not a permanent ban."""
    db.delete(_get_access_request(db, organization_id, user_id))
    db.commit()


def update_organization(
    db: Session, organization_id: int, *, name: str | None, description: str | None
) -> Organization:
    org = _get_org(db, organization_id)
    if name is not None and name != org.name:
        if db.scalar(select(Organization).where(Organization.name == name)):
            raise HTTPException(
                status_code=409, detail="An organization with this name already exists"
            )
        org.name = name
    if description is not None:
        org.description = description
    db.commit()
    db.refresh(org)
    return org


def set_internal_storage(db: Session, organization_id: int, allowed: bool) -> Organization:
    org = _get_org(db, organization_id)
    org.allows_internal_storage = allowed
    db.commit()
    db.refresh(org)
    return org


def get_org_users(db: Session, organization_id: int) -> list[OrganizationUser]:
    """Active members only. Pending rows are access requests waiting on an
    admin, and are listed by list_access_requests instead."""
    return list(
        db.scalars(
            select(OrganizationUser)
            .where(
                OrganizationUser.organization_id == organization_id,
                OrganizationUser.status == MEMBER_STATUS_ACTIVE,
            )
            .options(joinedload(OrganizationUser.user))
            .join(User, User.id == OrganizationUser.user_id)
            .order_by(func.lower(func.coalesce(User.display_name, User.email)))
        ).all()
    )


def _invite_target_filter(organization_id: int | None, project_id: int | None):
    """WHERE clause pinning invites to exactly one org or project target."""
    if (organization_id is None) == (project_id is None):
        raise ValueError("Invites target exactly one of organization_id or project_id")
    if organization_id is not None:
        return Invite.organization_id == organization_id
    return Invite.project_id == project_id


def invite_emails(
    db: Session,
    emails: list[str],
    *,
    invited_by: UUID,
    organization_id: int | None = None,
    project_id: int | None = None,
) -> list[str]:
    """Store pre-authorization invites for not-yet-registered emails (already
    normalized), skipping emails that still hold an unconsumed invite for the
    same target. Returns every email as invited either way; does not commit -
    runs inside the caller's add-by-email transaction."""
    if not emails:
        return []
    pending = set(
        db.scalars(
            select(Invite.email).where(
                Invite.consumed_at.is_(None),
                _invite_target_filter(organization_id, project_id),
            )
        ).all()
    )
    for email in emails:
        if email not in pending:
            db.add(
                Invite(
                    email=email,
                    organization_id=organization_id,
                    project_id=project_id,
                    invited_by=invited_by,
                )
            )
    return list(emails)


def list_pending_invites(
    db: Session, *, organization_id: int | None = None, project_id: int | None = None
) -> list[Invite]:
    return list(
        db.scalars(
            select(Invite)
            .where(
                Invite.consumed_at.is_(None),
                _invite_target_filter(organization_id, project_id),
            )
            .order_by(Invite.created_at)
        ).all()
    )


def revoke_invite(
    db: Session,
    invite_id: int,
    *,
    organization_id: int | None = None,
    project_id: int | None = None,
) -> None:
    """Delete a pending invite. 404s when it does not exist, was already
    consumed, or belongs to a different target than the admin is acting on."""
    invite = db.get(Invite, invite_id)
    if (
        invite is None
        or invite.consumed_at is not None
        or (organization_id is not None and invite.organization_id != organization_id)
        or (project_id is not None and invite.project_id != project_id)
    ):
        raise HTTPException(status_code=404, detail="Invite not found")
    db.delete(invite)
    db.commit()


def consume_invites_for_new_user(db: Session, user: User) -> None:
    """Redeem every unconsumed invite matching the new user's lowercased
    email: org invites become active non-admin memberships, project invites
    non-admin non-authoritative ones. Flushes only - runs inside
    register_user's transaction so registration stays all-or-nothing."""
    invites = db.scalars(
        select(Invite).where(
            Invite.email == user.email.lower(),
            Invite.consumed_at.is_(None),
        )
    ).all()
    now = datetime.now(UTC)
    # Track per-target grants: under autoflush=False a pending add is invisible
    # to db.get, so a duplicate invite for one target (pre-index rows, races)
    # would otherwise insert a second membership and abort the registration.
    granted_orgs: set[int] = set()
    granted_projects: set[int] = set()
    for invite in invites:
        org_id, project_id = invite.organization_id, invite.project_id
        if org_id is not None:
            if org_id not in granted_orgs and db.get(OrganizationUser, (user.id, org_id)) is None:
                db.add(
                    OrganizationUser(
                        user_id=user.id,
                        organization_id=org_id,
                        is_admin=False,
                        status=MEMBER_STATUS_ACTIVE,
                    )
                )
            granted_orgs.add(org_id)
        elif project_id is not None:
            if (
                project_id not in granted_projects
                and db.get(ProjectUser, (user.id, project_id)) is None
            ):
                db.add(
                    ProjectUser(
                        user_id=user.id,
                        project_id=project_id,
                        is_admin=False,
                        is_authoritative_reviewer=False,
                    )
                )
            granted_projects.add(project_id)
        invite.consumed_at = now
        invite.consumed_by = user.id


def add_users_by_email(
    db: Session, organization_id: int, emails: list[str], *, invited_by: UUID
) -> tuple[list[User], list[str]]:
    """Add registered users as active members; store invites for the rest so
    they join automatically when they sign up with that email."""
    normalized = normalize_emails(emails)
    users = db.scalars(select(User).where(func.lower(User.email).in_(normalized))).all()
    by_email = {u.email.lower(): u for u in users}
    added: list[User] = []
    for email in normalized:
        found = by_email.get(email)
        if found is None:
            continue
        if db.get(OrganizationUser, (found.id, organization_id)) is None:
            db.add(
                OrganizationUser(
                    user_id=found.id,
                    organization_id=organization_id,
                    is_admin=False,
                    status=MEMBER_STATUS_ACTIVE,
                )
            )
            added.append(found)
    unknown = [e for e in normalized if e not in by_email]
    invited = invite_emails(db, unknown, invited_by=invited_by, organization_id=organization_id)
    db.commit()
    return added, invited


def _assert_not_last_org_admin(db: Session, organization_id: int, user_id: UUID) -> None:
    membership = db.get(OrganizationUser, (user_id, organization_id))
    if membership is None or not membership.is_admin:
        return
    admin_count = db.scalar(
        select(func.count())
        .select_from(OrganizationUser)
        .where(
            OrganizationUser.organization_id == organization_id,
            OrganizationUser.is_admin.is_(True),
        )
    )
    if (admin_count or 0) <= 1:
        raise HTTPException(status_code=409, detail="Cannot remove the last organization admin")


def make_org_admin(db: Session, organization_id: int, user_id: UUID) -> None:
    membership = db.get(OrganizationUser, (user_id, organization_id))
    if membership is None:
        raise HTTPException(status_code=404, detail="User is not a member of this organization")
    membership.is_admin = True
    db.commit()


def demote_org_admin(db: Session, organization_id: int, user_id: UUID) -> None:
    _assert_not_last_org_admin(db, organization_id, user_id)
    membership = db.get(OrganizationUser, (user_id, organization_id))
    if membership is None or not membership.is_admin:
        raise HTTPException(status_code=404, detail="User is not an admin of this organization")
    membership.is_admin = False
    db.commit()


def remove_member(db: Session, organization_id: int, user_id: UUID) -> None:
    """Remove a member and their memberships in the org's projects. Refuses if
    they are the last admin of the org or of any of its projects."""
    _assert_not_last_org_admin(db, organization_id, user_id)
    membership = db.get(OrganizationUser, (user_id, organization_id))
    if membership is None:
        raise HTTPException(status_code=404, detail="User is not a member of this organization")

    org_project_ids = select(Project.id).where(Project.organization_id == organization_id)
    sole_admin_projects = db.scalars(
        select(Project.name)
        .join(ProjectUser, ProjectUser.project_id == Project.id)
        .where(
            Project.id.in_(org_project_ids),
            ProjectUser.user_id == user_id,
            ProjectUser.is_admin.is_(True),
            ~select(ProjectUser.user_id)
            .where(
                ProjectUser.project_id == Project.id,
                ProjectUser.is_admin.is_(True),
                ProjectUser.user_id != user_id,
            )
            .correlate(Project)
            .exists(),
        )
    ).all()
    if sole_admin_projects:
        raise HTTPException(
            status_code=409,
            detail=(
                "User is the only admin of: "
                + ", ".join(sole_admin_projects)
                + ". Assign another project admin first."
            ),
        )

    db.execute(
        delete(ProjectUser).where(
            ProjectUser.user_id == user_id, ProjectUser.project_id.in_(org_project_ids)
        )
    )
    db.delete(membership)
    db.commit()


def list_api_keys(db: Session, organization_id: int) -> list[OrganizationApiKey]:
    return list(
        db.scalars(
            select(OrganizationApiKey)
            .where(OrganizationApiKey.organization_id == organization_id)
            .order_by(func.lower(OrganizationApiKey.name))
        ).all()
    )


def create_api_key(
    db: Session, organization_id: int, *, name: str, value: str, created_by: UUID
) -> OrganizationApiKey:
    if db.scalar(
        select(OrganizationApiKey).where(
            OrganizationApiKey.organization_id == organization_id,
            OrganizationApiKey.name == name,
        )
    ):
        raise HTTPException(status_code=409, detail="A key with this name already exists")
    key = OrganizationApiKey(
        organization_id=organization_id,
        name=name,
        encrypted_key=encrypt(value),
        created_by=created_by,
    )
    db.add(key)
    db.commit()
    db.refresh(key)
    return key


def _get_api_key(db: Session, organization_id: int, key_id: int) -> OrganizationApiKey:
    key = db.get(OrganizationApiKey, key_id)
    if key is None or key.organization_id != organization_id:
        raise HTTPException(status_code=404, detail="API key not found")
    return key


def rotate_api_key(db: Session, organization_id: int, key_id: int, value: str) -> None:
    """Replace the secret in place. Everything pointing at this key picks the
    new one up on its next tile request - that is the point of sharing it."""
    _get_api_key(db, organization_id, key_id).encrypted_key = encrypt(value)
    db.commit()


def delete_api_key(db: Session, organization_id: int, key_id: int) -> None:
    """Imagery pointing at this key is left without one (the FK nulls out), so
    its tiles start failing until an admin sets another."""
    db.delete(_get_api_key(db, organization_id, key_id))
    db.commit()


def get_org_tilers(db: Session, organization_id: int) -> list[str]:
    return list(
        db.scalars(
            select(OrganizationTiler.tiler_name)
            .where(OrganizationTiler.organization_id == organization_id)
            .order_by(OrganizationTiler.tiler_name)
        ).all()
    )


def set_org_tilers(db: Session, organization_id: int, tiler_names: list[str]) -> None:
    """Replace the org's tiler allowlist. Unknown names are rejected."""
    unknown = [n for n in tiler_names if not registry.is_known(n)]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown tilers: {', '.join(unknown)}")
    db.execute(
        delete(OrganizationTiler).where(OrganizationTiler.organization_id == organization_id)
    )
    db.flush()
    for name in dict.fromkeys(tiler_names):
        db.add(OrganizationTiler(organization_id=organization_id, tiler_name=name))
    db.commit()

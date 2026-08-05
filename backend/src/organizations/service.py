from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, joinedload

from src.auth.models import User
from src.organizations.models import (
    MEMBER_STATUS_ACTIVE,
    ORG_STATUS_APPROVED,
    ORG_STATUS_PENDING,
    ORG_STATUS_REJECTED,
    Organization,
    OrganizationTiler,
    OrganizationUser,
)
from src.projects.access import VISIBILITY_ORGANIZATION
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
    """The org-membership input to the access rule in projects/access.py:
    an active (not pending) membership row in the given org."""
    return (
        db.scalars(
            select(OrganizationUser).where(
                OrganizationUser.user_id == user_id,
                OrganizationUser.organization_id == organization_id,
                OrganizationUser.status == MEMBER_STATUS_ACTIVE,
            )
        ).first()
        is not None
    )


def grants_org_access(db: Session, user_id: UUID, project: Project) -> bool:
    """Whether org membership alone opens this project: org-public visibility
    plus an active membership in the owning org. The one DB-backed composition
    of the pure rule's org input, shared by every per-project access check."""
    return project.visibility == VISIBILITY_ORGANIZATION and is_active_org_member(
        db, user_id, project.organization_id
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
    return list(
        db.scalars(
            select(OrganizationUser)
            .where(OrganizationUser.organization_id == organization_id)
            .options(joinedload(OrganizationUser.user))
            .join(User, User.id == OrganizationUser.user_id)
            .order_by(func.lower(func.coalesce(User.display_name, User.email)))
        ).all()
    )


def add_users_by_email(
    db: Session, organization_id: int, emails: list[str]
) -> tuple[list[User], list[str]]:
    """Add registered users as active members; report unknown emails back.
    Phase 3 converts the unknown ones into stored invites."""
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
    db.commit()
    return added, unknown


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

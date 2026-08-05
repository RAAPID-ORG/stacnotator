from typing import NamedTuple
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.orm.attributes import flag_modified

from src.annotation.geometries import delete_orphan_geometries
from src.auth.models import User
from src.campaigns.models import Campaign
from src.campaigns.policy import _strip_anyone_kind
from src.campaigns.schemas import LabellingPolicy
from src.organizations.models import (
    MEMBER_STATUS_ACTIVE,
    ORG_STATUS_APPROVED,
    Organization,
    OrganizationUser,
)
from src.organizations.service import normalize_emails
from src.projects.models import Project, ProjectUser
from src.projects.schemas import ProjectOut


class ProjectFlags(NamedTuple):
    visible: bool
    has_access: bool
    is_member: bool
    is_admin: bool


def resolve_project_flags(
    *,
    is_public: bool,
    is_org_member: bool,
    is_member: bool,
    member_is_admin: bool,
    is_platform_admin: bool,
) -> ProjectFlags:
    """Pure visibility/permission matrix for one (project, viewer) pair.
    Org members see the project listed without access; access needs
    membership, a public project, or platform admin."""
    is_admin = is_platform_admin or (is_member and member_is_admin)
    has_access = is_public or is_member or is_platform_admin
    visible = has_access or is_org_member
    return ProjectFlags(visible, has_access, is_member or is_platform_admin, is_admin)


def _get_project(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _active_membership_in_approved_org(
    db: Session, user_id: UUID, organization_id: int
) -> OrganizationUser | None:
    return db.scalars(
        select(OrganizationUser)
        .join(Organization, Organization.id == OrganizationUser.organization_id)
        .where(
            OrganizationUser.user_id == user_id,
            OrganizationUser.organization_id == organization_id,
            OrganizationUser.status == MEMBER_STATUS_ACTIVE,
            Organization.status == ORG_STATUS_APPROVED,
        )
    ).first()


def create_project(
    db: Session,
    *,
    organization_id: int,
    name: str,
    description: str | None,
    is_public: bool,
    user: User,
) -> Project:
    """Any active member of an approved org may create a project in it and
    becomes its admin (and authoritative reviewer, matching campaign creation)."""
    org = db.get(Organization, organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    if not user.is_admin:
        if org.status != ORG_STATUS_APPROVED:
            raise HTTPException(status_code=403, detail="Organization is not approved yet")
        if _active_membership_in_approved_org(db, user.id, organization_id) is None:
            raise HTTPException(status_code=403, detail="You are not a member of this organization")

    project = Project(
        organization_id=organization_id,
        name=name,
        description=description,
        is_public=is_public,
        created_by=user.id,
    )
    db.add(project)
    db.flush()
    db.add(
        ProjectUser(
            user_id=user.id,
            project_id=project.id,
            is_admin=True,
            is_authoritative_reviewer=True,
        )
    )
    db.commit()
    db.refresh(project)
    return project


def create_wrapping_project(db: Session, *, name: str, is_public: bool, user: User) -> int:
    """Legacy shim: the pre-projects frontend creates campaigns without a
    project_id, so wrap the campaign in its own project in the user's oldest
    org - mirroring the migration backfill. Removed with Phase 2."""
    membership = db.scalars(
        select(OrganizationUser)
        .join(Organization, Organization.id == OrganizationUser.organization_id)
        .where(
            OrganizationUser.user_id == user.id,
            OrganizationUser.status == MEMBER_STATUS_ACTIVE,
            Organization.status == ORG_STATUS_APPROVED,
        )
        .order_by(OrganizationUser.created_at)
    ).first()
    if membership is None:
        raise HTTPException(status_code=403, detail="Join an organization to create campaigns")
    project = create_project(
        db,
        organization_id=membership.organization_id,
        name=name,
        description=None,
        is_public=is_public,
        user=user,
    )
    return project.id


def list_projects_for_user(db: Session, user: User) -> list[ProjectOut]:
    projects = db.scalars(select(Project).order_by(Project.created_at.desc())).all()
    memberships = {
        pu.project_id: pu
        for pu in db.scalars(select(ProjectUser).where(ProjectUser.user_id == user.id))
    }
    org_ids = set(
        db.scalars(
            select(OrganizationUser.organization_id).where(
                OrganizationUser.user_id == user.id,
                OrganizationUser.status == MEMBER_STATUS_ACTIVE,
            )
        )
    )
    rows = db.execute(select(Campaign.project_id, func.count()).group_by(Campaign.project_id)).all()
    counts: dict = {row[0]: row[1] for row in rows}
    viewer_is_platform_admin = user.is_admin

    items: list[ProjectOut] = []
    for project in projects:
        membership = memberships.get(project.id)
        flags = resolve_project_flags(
            is_public=project.is_public,
            is_org_member=project.organization_id in org_ids,
            is_member=membership is not None,
            member_is_admin=membership.is_admin if membership else False,
            is_platform_admin=viewer_is_platform_admin,
        )
        if not flags.visible:
            continue
        out = ProjectOut.model_validate(project)
        out.is_admin = flags.is_admin
        out.is_member = flags.is_member
        out.has_access = flags.has_access
        out.campaign_count = counts.get(project.id, 0)
        items.append(out)
    return items


def get_project_out(db: Session, project: Project, user: User) -> ProjectOut:
    membership = db.get(ProjectUser, (user.id, project.id))
    flags = resolve_project_flags(
        is_public=project.is_public,
        is_org_member=_active_membership_in_approved_org(db, user.id, project.organization_id)
        is not None,
        is_member=membership is not None,
        member_is_admin=membership.is_admin if membership else False,
        is_platform_admin=user.is_admin,
    )
    out = ProjectOut.model_validate(project)
    out.is_admin = flags.is_admin
    out.is_member = flags.is_member
    out.has_access = flags.has_access
    out.campaign_count = (
        db.scalar(
            select(func.count()).select_from(Campaign).where(Campaign.project_id == project.id)
        )
        or 0
    )
    return out


def _strip_anyone_from_campaign_policies(db: Session, project: Project) -> None:
    """Flipping a project private invalidates the 'anyone' audience on every
    campaign policy inside it - same invariant update_campaign_visibility
    enforced per campaign before projects existed."""
    for campaign in project.campaigns:
        if campaign.settings and campaign.settings.labelling_policy:
            policy = LabellingPolicy.model_validate(campaign.settings.labelling_policy)
            campaign.settings.labelling_policy = _strip_anyone_kind(policy).model_dump(mode="json")
            flag_modified(campaign.settings, "labelling_policy")


def update_project(
    db: Session,
    project_id: int,
    *,
    name: str | None = None,
    description: str | None = None,
    is_public: bool | None = None,
) -> Project:
    project = _get_project(db, project_id)
    if name is not None:
        project.name = name
    if description is not None:
        project.description = description
    if is_public is not None:
        project.is_public = is_public
        if not is_public:
            _strip_anyone_from_campaign_policies(db, project)
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project_id: int) -> None:
    """Deletes the project and, via cascade, all its campaigns. Annotation
    geometries have no campaign FK, so orphans are swept explicitly."""
    project = _get_project(db, project_id)
    db.delete(project)
    delete_orphan_geometries(db)
    db.commit()


def get_project_users(db: Session, project_id: int) -> list[ProjectUser]:
    return list(
        db.scalars(
            select(ProjectUser)
            .where(ProjectUser.project_id == project_id)
            .options(joinedload(ProjectUser.user))
            .join(User, User.id == ProjectUser.user_id)
            .order_by(func.lower(func.coalesce(User.display_name, User.email)))
        ).all()
    )


def add_users_by_email(
    db: Session, project_id: int, emails: list[str]
) -> tuple[list[User], list[str]]:
    """Add registered users (org-external allowed by design) as members;
    report unknown emails back. Phase 3 turns those into project invites."""
    normalized = normalize_emails(emails)
    users = db.scalars(select(User).where(func.lower(User.email).in_(normalized))).all()
    by_email = {u.email.lower(): u for u in users}
    added: list[User] = []
    for email in normalized:
        found = by_email.get(email)
        if found is None:
            continue
        if db.get(ProjectUser, (found.id, project_id)) is None:
            db.add(
                ProjectUser(
                    user_id=found.id,
                    project_id=project_id,
                    is_admin=False,
                    is_authoritative_reviewer=False,
                )
            )
            added.append(found)
    unknown = [e for e in normalized if e not in by_email]
    db.commit()
    return added, unknown


def add_users_by_ids(db: Session, project_id: int, user_ids: list[UUID]) -> None:
    """Bulk add by id (legacy assign-users shim + assignment modals). Unknown
    ids 404 the batch; existing members are skipped, not an error."""
    users = db.scalars(select(User).where(User.id.in_(user_ids))).all()
    missing = set(user_ids) - {u.id for u in users}
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Users not found with IDs: {', '.join(str(uid) for uid in missing)}",
        )
    for user in users:
        if db.get(ProjectUser, (user.id, project_id)) is None:
            db.add(
                ProjectUser(
                    user_id=user.id,
                    project_id=project_id,
                    is_admin=False,
                    is_authoritative_reviewer=False,
                )
            )
    db.commit()


def _assert_not_last_project_admin(db: Session, project_id: int, user_id: UUID) -> None:
    membership = db.get(ProjectUser, (user_id, project_id))
    if membership is None or not membership.is_admin:
        return
    admin_count = db.scalar(
        select(func.count())
        .select_from(ProjectUser)
        .where(ProjectUser.project_id == project_id, ProjectUser.is_admin.is_(True))
    )
    if (admin_count or 0) <= 1:
        raise HTTPException(status_code=409, detail="Cannot remove the last project admin")


def _get_membership(db: Session, project_id: int, user_id: UUID) -> ProjectUser:
    membership = db.get(ProjectUser, (user_id, project_id))
    if membership is None:
        raise HTTPException(status_code=404, detail="User is not a member of this project")
    return membership


def make_admin(db: Session, project_id: int, user_id: UUID) -> None:
    _get_membership(db, project_id, user_id).is_admin = True
    db.commit()


def demote_admin(db: Session, project_id: int, user_id: UUID) -> None:
    _assert_not_last_project_admin(db, project_id, user_id)
    _get_membership(db, project_id, user_id).is_admin = False
    db.commit()


def make_authoritative_reviewer(db: Session, project_id: int, user_id: UUID) -> None:
    _get_membership(db, project_id, user_id).is_authoritative_reviewer = True
    db.commit()


def demote_authoritative_reviewer(db: Session, project_id: int, user_id: UUID) -> None:
    _get_membership(db, project_id, user_id).is_authoritative_reviewer = False
    db.commit()


def remove_user(db: Session, project_id: int, user_id: UUID) -> None:
    _assert_not_last_project_admin(db, project_id, user_id)
    db.delete(_get_membership(db, project_id, user_id))
    db.commit()

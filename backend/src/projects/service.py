from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.orm.attributes import flag_modified

from src.annotation.geometries import delete_orphan_geometries
from src.auth.models import User
from src.campaigns.models import Campaign
from src.campaigns.policy import strip_anyone_kind
from src.campaigns.schemas import CampaignListItemOut, LabellingPolicy
from src.organizations.models import (
    MEMBER_STATUS_ACTIVE,
    ORG_STATUS_APPROVED,
    Organization,
    OrganizationUser,
)
from src.organizations.service import (
    invite_emails,
    is_active_org_member,
    normalize_emails,
)
from src.projects.access import (
    VISIBILITY_PUBLIC,
    is_policy_member,
    resolve_project_flags,
)
from src.projects.models import Project, ProjectUser
from src.projects.schemas import ProjectOut, ProjectTilersOut, TilerOption
from src.tilers import registry


def _get_project(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def create_project(
    db: Session,
    *,
    organization_id: int,
    name: str,
    description: str | None,
    visibility: str,
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
        if not is_active_org_member(db, user.id, organization_id):
            raise HTTPException(status_code=403, detail="You are not a member of this organization")

    project = Project(
        organization_id=organization_id,
        name=name,
        description=description,
        visibility=visibility,
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


def list_projects_for_user(db: Session, user: User) -> list[ProjectOut]:
    projects = db.scalars(select(Project).order_by(Project.created_at.desc())).all()
    memberships = {
        pu.project_id: pu
        for pu in db.scalars(select(ProjectUser).where(ProjectUser.user_id == user.id))
    }
    org_ids = set(
        db.scalars(
            select(OrganizationUser.organization_id)
            .join(Organization, Organization.id == OrganizationUser.organization_id)
            .where(
                OrganizationUser.user_id == user.id,
                OrganizationUser.status == MEMBER_STATUS_ACTIVE,
                Organization.status == ORG_STATUS_APPROVED,
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
            visibility=project.visibility,
            is_active_org_member=project.organization_id in org_ids,
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


def list_project_campaigns(db: Session, project: Project, user: User) -> list[CampaignListItemOut]:
    membership = db.get(ProjectUser, (user.id, project.id))
    is_member = is_policy_member(
        visibility=project.visibility,
        is_active_org_member=is_active_org_member(db, user.id, project.organization_id),
        is_member=membership is not None,
        is_platform_admin=user.is_admin,
    )
    is_admin = user.is_admin or (membership is not None and membership.is_admin)
    campaigns = db.scalars(
        select(Campaign)
        .where(Campaign.project_id == project.id)
        .order_by(Campaign.created_at.desc())
    ).all()
    return [
        CampaignListItemOut(
            id=c.id,
            name=c.name,
            created_at=c.created_at,
            project_id=project.id,
            is_admin=is_admin,
            is_member=is_member,
            is_public=project.visibility == VISIBILITY_PUBLIC,
            registration_status=c.registration_status,
            embedding_status=c.embedding_status,
        )
        for c in campaigns
    ]


def get_project_out(db: Session, project: Project, user: User) -> ProjectOut:
    membership = db.get(ProjectUser, (user.id, project.id))
    flags = resolve_project_flags(
        visibility=project.visibility,
        is_active_org_member=is_active_org_member(db, user.id, project.organization_id),
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
    """Leaving platform-public visibility (for 'organization' or 'private')
    invalidates the 'anyone' audience on every campaign policy inside the
    project - same invariant update_campaign_visibility enforced per campaign
    before projects existed."""
    for campaign in project.campaigns:
        if campaign.settings and campaign.settings.labelling_policy:
            policy = LabellingPolicy.model_validate(campaign.settings.labelling_policy)
            campaign.settings.labelling_policy = strip_anyone_kind(policy).model_dump(mode="json")
            flag_modified(campaign.settings, "labelling_policy")


def update_project(
    db: Session,
    project_id: int,
    *,
    name: str | None = None,
    description: str | None = None,
    visibility: str | None = None,
) -> Project:
    project = _get_project(db, project_id)
    if name is not None:
        project.name = name
    if description is not None:
        project.description = description
    if visibility is not None:
        was_public = project.visibility == VISIBILITY_PUBLIC
        project.visibility = visibility
        if was_public and visibility != VISIBILITY_PUBLIC:
            _strip_anyone_from_campaign_policies(db, project)
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project_id: int) -> None:
    """Deletes the project and, via the database's own cascade, all its
    campaigns and everything under them. Deleting the ORM object instead would
    load every task and annotation into the session and delete them one
    statement at a time. Annotation geometries have no campaign FK, so orphans
    are swept explicitly."""
    _get_project(db, project_id)
    db.execute(delete(Project).where(Project.id == project_id))
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
    db: Session, project_id: int, emails: list[str], *, invited_by: UUID
) -> tuple[list[User], list[str]]:
    """Add registered users (org-external allowed by design) as members;
    store invites for the rest so they join automatically at sign-up."""
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
    invited = invite_emails(db, unknown, invited_by=invited_by, project_id=project_id)
    db.commit()
    return added, invited


def add_users_by_ids(db: Session, project_id: int, user_ids: list[UUID]) -> None:
    """Bulk add by id, used by the project members UI where the user was picked
    from a list rather than typed as an email. Unknown ids 404 the batch;
    existing members are skipped, not an error."""
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


def get_project_tilers(project: Project) -> ProjectTilersOut:
    """Tiler options for the project's imagery wizard: the registry entries the
    owning organization is allowed to use, in registry order."""
    allowed = set(project.organization.allowed_tiler_names)
    return ProjectTilersOut(
        tilers=[
            TilerOption(
                name=t.name,
                kind=t.kind,
                url=t.url,
                is_default=t.is_default,
                stac_url=t.stac_url,
                allows_ingest=t.allows_ingest,
            )
            for t in registry.all_tilers()
            if t.name in allowed
        ],
        allows_internal_storage=project.organization.allows_internal_storage,
    )

"""A viewer's standing on projects, read from the database and resolved through
the pure rule in projects/access.py."""

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.models import User
from src.organizations.service import active_organization_ids, is_active_org_member
from src.projects.access import ProjectFlags, resolve_project_flags
from src.projects.models import Project, ProjectUser


def _resolve(
    user: User, project: Project, membership: ProjectUser | None, is_org_member: bool
) -> ProjectFlags:
    return resolve_project_flags(
        visibility=project.visibility,
        is_active_org_member=is_org_member,
        is_member=membership is not None,
        member_is_admin=membership is not None and membership.is_admin,
        member_is_authoritative_reviewer=(
            membership is not None and membership.is_authoritative_reviewer
        ),
        is_platform_admin=user.is_platform_admin,
    )


def project_flags(db: Session, user: User, project: Project) -> ProjectFlags:
    membership = db.get(ProjectUser, (user.id, project.id))
    is_org_member = is_active_org_member(db, user.id, project.organization_id)
    return _resolve(user, project, membership, is_org_member)


class ViewerStanding:
    """Everything needed to resolve a viewer's flags on many projects, loaded in
    two queries rather than two per project."""

    def __init__(self, db: Session, user: User):
        self.user = user
        self.memberships: dict[int, ProjectUser] = {
            pu.project_id: pu
            for pu in db.scalars(select(ProjectUser).where(ProjectUser.user_id == user.id))
        }
        self.org_ids = set(db.scalars(active_organization_ids(user.id)))

    def flags(self, project: Project) -> ProjectFlags:
        return _resolve(
            self.user,
            project,
            self.memberships.get(project.id),
            project.organization_id in self.org_ids,
        )

    def visible(self, projects: Iterable[Project]) -> list[tuple[Project, ProjectFlags]]:
        flagged = ((project, self.flags(project)) for project in projects)
        return [(project, flags) for project, flags in flagged if flags.visible]

"""Single home for the project-visibility access rule.

Pure functional core (no DB, no FastAPI): every access decision that depends
on a project's visibility scope - dependencies, list/detail flags, tiler token
scoping, labelling-policy contexts - resolves through these helpers so the
rule exists exactly once. Callers fetch the inputs (row membership, active org
membership, platform-admin standing) themselves.
"""

from typing import Literal, NamedTuple

ProjectVisibility = Literal["private", "organization", "public"]

VISIBILITY_PRIVATE: ProjectVisibility = "private"
VISIBILITY_ORGANIZATION: ProjectVisibility = "organization"
VISIBILITY_PUBLIC: ProjectVisibility = "public"
PROJECT_VISIBILITIES: tuple[ProjectVisibility, ...] = (
    VISIBILITY_PRIVATE,
    VISIBILITY_ORGANIZATION,
    VISIBILITY_PUBLIC,
)


class ProjectFlags(NamedTuple):
    visible: bool
    has_access: bool
    is_member: bool
    is_admin: bool


def has_project_access(
    *,
    visibility: str,
    is_org_member: bool,
    is_member: bool,
    is_platform_admin: bool,
) -> bool:
    """Whether the viewer may open the project (and its campaigns) at all."""
    return (
        is_platform_admin
        or is_member
        or visibility == VISIBILITY_PUBLIC
        or (visibility == VISIBILITY_ORGANIZATION and is_org_member)
    )


def is_policy_member(
    *,
    visibility: str,
    is_org_member: bool,
    is_member: bool,
    is_platform_admin: bool,
) -> bool:
    """Member-level standing for labelling policies and viewer flags: row
    membership, platform admin, or org-public access for active org members.
    Platform-public access alone never grants membership - the 'anyone'
    audience is the only door open to that crowd."""
    return (
        is_platform_admin or is_member or (visibility == VISIBILITY_ORGANIZATION and is_org_member)
    )


def resolve_project_flags(
    *,
    visibility: str,
    is_org_member: bool,
    is_member: bool,
    member_is_admin: bool,
    is_platform_admin: bool,
) -> ProjectFlags:
    """Visibility/permission matrix for one (project, viewer) pair. Org members
    always see the project listed; org-public access grants no roles and no
    display membership (the frontend renders those rows as "Org access")."""
    has_access = has_project_access(
        visibility=visibility,
        is_org_member=is_org_member,
        is_member=is_member,
        is_platform_admin=is_platform_admin,
    )
    visible = has_access or is_org_member
    is_admin = is_platform_admin or (is_member and member_is_admin)
    return ProjectFlags(visible, has_access, is_member or is_platform_admin, is_admin)

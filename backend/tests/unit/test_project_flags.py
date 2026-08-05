"""Pure visibility/permission matrix for the projects list.

Spec: mine = member; organization = all org projects listed (no access without
membership); public = platform-wide access; platform admins see and access all."""

from src.projects.service import resolve_project_flags


def _flags(**kw):
    defaults = dict(
        is_public=False,
        is_org_member=False,
        is_member=False,
        member_is_admin=False,
        is_platform_admin=False,
    )
    defaults.update(kw)
    return resolve_project_flags(**defaults)


def test_outsider_sees_nothing_private():
    f = _flags()
    assert not f.visible and not f.has_access


def test_public_project_grants_access_to_everyone():
    f = _flags(is_public=True)
    assert f.visible and f.has_access and not f.is_member and not f.is_admin


def test_org_member_sees_listing_but_gets_no_access():
    f = _flags(is_org_member=True)
    assert f.visible and not f.has_access


def test_project_member_gets_access():
    f = _flags(is_member=True)
    assert f.visible and f.has_access and f.is_member and not f.is_admin


def test_project_admin_flag_requires_membership_admin():
    assert _flags(is_member=True, member_is_admin=True).is_admin
    assert not _flags(member_is_admin=True).is_admin


def test_platform_admin_gets_everything():
    f = _flags(is_platform_admin=True)
    assert f.visible and f.has_access and f.is_member and f.is_admin


def test_cross_org_external_member_still_visible():
    # Invited into a project of an org the user does not belong to.
    f = _flags(is_member=True, is_org_member=False)
    assert f.visible and f.has_access

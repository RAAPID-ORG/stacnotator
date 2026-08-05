"""Pure visibility/permission matrix for projects (projects/access.py).

Spec: visibility is 'private' | 'organization' | 'public'. Access needs row
membership, platform admin, platform-public visibility, or - for org-public
projects - active membership in the owning org. Org-public access carries
member-level policy standing but no roles and no display membership.
"""

from src.projects.access import (
    PROJECT_VISIBILITIES,
    has_project_access,
    is_policy_member,
    resolve_project_flags,
)


def _flags(**kw):
    defaults = dict(
        visibility="private",
        is_org_member=False,
        is_member=False,
        member_is_admin=False,
        is_platform_admin=False,
    )
    defaults.update(kw)
    return resolve_project_flags(**defaults)


def test_visibility_constants():
    assert PROJECT_VISIBILITIES == ("private", "organization", "public")


def test_outsider_sees_nothing_private():
    f = _flags()
    assert not f.visible and not f.has_access


def test_public_project_grants_access_to_everyone():
    f = _flags(visibility="public")
    assert f.visible and f.has_access and not f.is_member and not f.is_admin


def test_org_member_on_private_project_sees_listing_but_gets_no_access():
    f = _flags(visibility="private", is_org_member=True)
    assert f.visible and not f.has_access


def test_org_member_on_org_public_project_gets_access_without_membership():
    f = _flags(visibility="organization", is_org_member=True)
    assert f.visible and f.has_access
    assert not f.is_member and not f.is_admin


def test_org_public_project_denies_non_org_outsiders():
    f = _flags(visibility="organization")
    assert not f.visible and not f.has_access


def test_project_member_gets_access():
    f = _flags(is_member=True)
    assert f.visible and f.has_access and f.is_member and not f.is_admin


def test_project_admin_flag_requires_membership_admin():
    assert _flags(is_member=True, member_is_admin=True).is_admin
    assert not _flags(member_is_admin=True).is_admin


def test_platform_admin_gets_everything():
    for visibility in PROJECT_VISIBILITIES:
        f = _flags(visibility=visibility, is_platform_admin=True)
        assert f.visible and f.has_access and f.is_member and f.is_admin


def test_cross_org_external_member_still_visible():
    # Invited into a project of an org the user does not belong to.
    f = _flags(is_member=True, is_org_member=False)
    assert f.visible and f.has_access


def test_has_project_access_matches_flags_matrix():
    for visibility in PROJECT_VISIBILITIES:
        for is_org_member in (False, True):
            for is_member in (False, True):
                for is_platform_admin in (False, True):
                    assert (
                        has_project_access(
                            visibility=visibility,
                            is_org_member=is_org_member,
                            is_member=is_member,
                            is_platform_admin=is_platform_admin,
                        )
                        is _flags(
                            visibility=visibility,
                            is_org_member=is_org_member,
                            is_member=is_member,
                            is_platform_admin=is_platform_admin,
                        ).has_access
                    )


def test_policy_member_row_membership_and_platform_admin():
    assert is_policy_member(
        visibility="private", is_org_member=False, is_member=True, is_platform_admin=False
    )
    assert is_policy_member(
        visibility="private", is_org_member=False, is_member=False, is_platform_admin=True
    )


def test_policy_member_org_public_grants_member_standing_to_org_members():
    assert is_policy_member(
        visibility="organization", is_org_member=True, is_member=False, is_platform_admin=False
    )
    assert not is_policy_member(
        visibility="organization", is_org_member=False, is_member=False, is_platform_admin=False
    )


def test_policy_member_platform_public_alone_is_not_membership():
    # 'anyone' stays the only audience open to the platform-public crowd.
    assert not is_policy_member(
        visibility="public", is_org_member=False, is_member=False, is_platform_admin=False
    )
    assert not is_policy_member(
        visibility="public", is_org_member=True, is_member=False, is_platform_admin=False
    )

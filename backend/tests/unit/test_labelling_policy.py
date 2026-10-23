"""Unit tests for the labelling-policy model layer: schema validation, the
pure policy.py evaluation core, and the admin update service call.

DB-free per repo convention: CampaignSettings/Campaign are plain SQLAlchemy
model instances (no session), and the DB session in service tests is a
MagicMock.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src.campaigns import service
from src.campaigns.models import Campaign, CampaignSettings
from src.campaigns.policy import (
    CampaignStanding,
    PolicyContext,
    build_policy_context,
    counts_toward_completion,
    get_labelling_policy,
    is_allowed,
    load_standing,
)
from src.campaigns.schemas import (
    LabellingPolicy,
    PolicyAudience,
    default_labelling_policy,
)
from src.projects.models import Project
from tests.conftest import make_policy


def _campaign(visibility: str = "private") -> Campaign:
    campaign = Campaign(id=1, name="x", default_work_mode="tasks")
    campaign.project = Project(id=1, visibility=visibility, organization_id=5)
    campaign.settings = CampaignSettings(campaign_id=1, labelling_policy={})
    return campaign


def _ctx(**overrides) -> PolicyContext:
    defaults = dict(
        user_id=None,
        is_admin=False,
        is_authoritative=False,
        is_member=False,
        is_assigned=False,
    )
    defaults.update(overrides)
    return PolicyContext(**defaults)


# ============================================================================
# Per-axis kind validation
# ============================================================================


def test_assignees_rejected_on_explore():
    with pytest.raises(ValidationError):
        make_policy(explore=PolicyAudience(kinds=["assignees"]))


def test_assignees_rejected_on_unassigned_tasks():
    with pytest.raises(ValidationError):
        make_policy(unassigned_tasks=PolicyAudience(kinds=["assignees"]))


def test_assignees_accepted_on_assigned_tasks():
    policy = make_policy(assigned_tasks=PolicyAudience(kinds=["assignees"]))
    assert policy.assigned_tasks.kinds == ["assignees"]


def test_assignees_accepted_on_complete_assigned():
    policy = make_policy(complete_assigned=PolicyAudience(kinds=["assignees"]))
    assert policy.complete_assigned.kinds == ["assignees"]


def test_anyone_rejected_on_complete_assigned():
    with pytest.raises(ValidationError):
        make_policy(complete_assigned=PolicyAudience(kinds=["anyone"]))


def test_anyone_accepted_on_explore_unassigned_and_assigned():
    policy = make_policy(
        explore=PolicyAudience(kinds=["anyone"]),
        unassigned_tasks=PolicyAudience(kinds=["anyone"]),
        assigned_tasks=PolicyAudience(kinds=["anyone"]),
    )
    assert policy.explore.kinds == ["anyone"]
    assert policy.unassigned_tasks.kinds == ["anyone"]
    assert policy.assigned_tasks.kinds == ["anyone"]


def test_authoritative_accepted_on_explore():
    """Running a campaign should not mean being locked out of its free-form
    labelling, so the explore axis takes reviewers like every other axis."""
    policy = make_policy(explore=PolicyAudience(kinds=["authoritative"]))
    assert policy.explore.kinds == ["authoritative"]


def test_admins_accepted_on_every_axis():
    policy = make_policy(
        explore=PolicyAudience(kinds=["admins"]),
        unassigned_tasks=PolicyAudience(kinds=["admins"]),
        assigned_tasks=PolicyAudience(kinds=["admins"]),
        complete_assigned=PolicyAudience(kinds=["admins"]),
    )
    assert all("admins" in getattr(policy, axis).kinds for axis in type(policy).model_fields)


# ============================================================================
# Defaults
# ============================================================================


def test_default_policy_shape():
    policy = default_labelling_policy()
    staff_and_members = {"admins", "authoritative", "members"}
    assert set(policy.explore.kinds) == staff_and_members
    assert policy.explore.user_ids == []
    assert set(policy.unassigned_tasks.kinds) == staff_and_members
    assert set(policy.assigned_tasks.kinds) == staff_and_members
    assert set(policy.complete_assigned.kinds) == {"assignees", "admins", "authoritative"}


def test_a_policy_missing_an_axis_is_rejected():
    """PATCH is a full-replace of the stored policy: omitting an axis must be
    a 422, not a silent default for that axis."""
    with pytest.raises(ValidationError):
        LabellingPolicy(
            unassigned_tasks=PolicyAudience(kinds=["members"]),
            assigned_tasks=PolicyAudience(kinds=["members"]),
            complete_assigned=PolicyAudience(kinds=["admins"]),
            modify_others=PolicyAudience(kinds=["admins"]),
        )


def test_default_policy_is_itself_valid():
    # Round-trips through validation without raising.
    LabellingPolicy(**default_labelling_policy().model_dump())


def test_default_policy_is_private_by_default():
    policy = default_labelling_policy()
    assert "anyone" not in policy.explore.kinds
    assert "anyone" not in policy.unassigned_tasks.kinds
    assert "anyone" not in policy.assigned_tasks.kinds


def test_public_default_policy_adds_anyone_to_three_axes():
    policy = default_labelling_policy(is_public=True)
    expected = {"admins", "authoritative", "members", "anyone"}
    assert set(policy.explore.kinds) == expected
    assert set(policy.unassigned_tasks.kinds) == expected
    assert set(policy.assigned_tasks.kinds) == expected


def test_public_default_policy_leaves_complete_assigned_unchanged():
    private_policy = default_labelling_policy(is_public=False)
    public_policy = default_labelling_policy(is_public=True)
    assert public_policy.complete_assigned == private_policy.complete_assigned
    assert "anyone" not in public_policy.complete_assigned.kinds


def test_public_default_policy_is_itself_valid():
    make_policy(**default_labelling_policy(is_public=True).model_dump())


# ============================================================================
# is_allowed truth table
# ============================================================================


def test_is_allowed_anyone_always_true():
    assert is_allowed(PolicyAudience(kinds=["anyone"]), _ctx()) is True


def test_is_allowed_members_true_when_member():
    audience = PolicyAudience(kinds=["members"])
    assert is_allowed(audience, _ctx(is_member=True)) is True
    assert is_allowed(audience, _ctx(is_member=False)) is False


def test_is_allowed_admins_true_when_admin():
    audience = PolicyAudience(kinds=["admins"])
    assert is_allowed(audience, _ctx(is_admin=True)) is True
    assert is_allowed(audience, _ctx(is_admin=False)) is False


def test_is_allowed_authoritative_true_when_authoritative():
    audience = PolicyAudience(kinds=["authoritative"])
    assert is_allowed(audience, _ctx(is_authoritative=True)) is True
    assert is_allowed(audience, _ctx(is_authoritative=False)) is False


def test_is_allowed_assignees_true_when_assigned():
    audience = PolicyAudience(kinds=["assignees"])
    assert is_allowed(audience, _ctx(is_assigned=True)) is True
    assert is_allowed(audience, _ctx(is_assigned=False)) is False


def test_is_allowed_selected_user_ids():
    user_id = uuid4()
    other_id = uuid4()
    audience = PolicyAudience(kinds=[], user_ids=[user_id])
    assert is_allowed(audience, _ctx(user_id=user_id)) is True
    assert is_allowed(audience, _ctx(user_id=other_id)) is False
    assert is_allowed(audience, _ctx(user_id=None)) is False


def test_is_allowed_no_one_when_kinds_and_user_ids_empty():
    audience = PolicyAudience(kinds=[], user_ids=[])
    ctx = _ctx(
        user_id=uuid4(),
        is_admin=True,
        is_authoritative=True,
        is_member=True,
        is_assigned=True,
    )
    assert is_allowed(audience, ctx) is False


# ============================================================================
# counts_toward_completion
# ============================================================================


def test_counts_toward_completion_uses_complete_assigned_axis_for_assigned_task():
    policy = default_labelling_policy()
    admin_ctx = _ctx(is_admin=True)
    assert counts_toward_completion(policy, True, admin_ctx) is True

    plain_member_ctx = _ctx(is_member=True)
    assert counts_toward_completion(policy, True, plain_member_ctx) is False


def test_counts_toward_completion_uses_unassigned_tasks_axis_for_unassigned_task():
    policy = default_labelling_policy()
    member_ctx = _ctx(is_member=True)
    assert counts_toward_completion(policy, False, member_ctx) is True

    non_member_ctx = _ctx(is_member=False)
    assert counts_toward_completion(policy, False, non_member_ctx) is False


# ============================================================================
# PATCH /campaigns/{id}/labelling-policy service call (mocked db)
# ============================================================================


def test_update_labelling_policy_rejects_anyone_for_private_campaign():
    campaign = _campaign(visibility="private")
    db = MagicMock()
    db.get.return_value = campaign

    req = make_policy(
        explore=PolicyAudience(kinds=["anyone"]),
        complete_assigned=PolicyAudience(kinds=["admins"]),
    )

    with pytest.raises(HTTPException) as exc_info:
        service.update_labelling_policy(db, campaign, req)

    assert exc_info.value.status_code == 400
    db.commit.assert_not_called()


def test_update_labelling_policy_allows_anyone_for_public_campaign():
    campaign = _campaign(visibility="public")
    db = MagicMock()
    db.get.return_value = campaign

    req = make_policy(
        explore=PolicyAudience(kinds=["anyone"]),
        complete_assigned=PolicyAudience(kinds=["admins"]),
    )

    result = service.update_labelling_policy(db, campaign, req)

    assert result.explore.kinds == ["anyone"]
    db.commit.assert_called_once()


def test_update_labelling_policy_persists_without_anyone_on_private_campaign():
    campaign = _campaign(visibility="private")
    db = MagicMock()
    db.get.return_value = campaign

    req = make_policy(
        explore=PolicyAudience(kinds=["members"]),
        complete_assigned=PolicyAudience(kinds=["admins"]),
    )

    result = service.update_labelling_policy(db, campaign, req)

    assert result.explore.kinds == ["members"]
    assert campaign.settings.labelling_policy["explore"]["kinds"] == ["members"]
    db.commit.assert_called_once()


# ============================================================================
# get_labelling_policy: campaign -> LabellingPolicy
# ============================================================================


def test_get_labelling_policy_reads_stored_policy():
    campaign = _campaign()
    campaign.settings.labelling_policy = {
        "explore": {"kinds": ["anyone"], "user_ids": []},
        "unassigned_tasks": {"kinds": ["members"], "user_ids": []},
        "assigned_tasks": {"kinds": ["members"], "user_ids": []},
        "complete_assigned": {"kinds": ["admins"], "user_ids": []},
        "modify_others": {"kinds": ["admins"], "user_ids": []},
    }
    policy = get_labelling_policy(campaign)
    assert policy.explore.kinds == ["anyone"]
    assert policy.complete_assigned.kinds == ["admins"]


# ============================================================================
# CampaignStanding: who is what in a campaign, through the one access rule
# ============================================================================


def _standing(visibility="private", **kwargs) -> CampaignStanding:
    return CampaignStanding(visibility=visibility, **{"roles": {}, **kwargs})


def test_stranger_has_no_standing():
    user_id = uuid4()
    assert _standing().context(user_id) == PolicyContext(
        user_id=user_id, is_admin=False, is_authoritative=False, is_member=False
    )


def test_membership_row_carries_its_roles():
    user_id = uuid4()
    ctx = _standing(roles={user_id: (True, True)}).context(user_id)
    assert (ctx.is_member, ctx.is_admin, ctx.is_authoritative) == (True, True, True)


def test_platform_admin_is_an_admin_member_without_a_row():
    """Platform admins are members everywhere, matching the viewer_is_member flag
    the campaign endpoints report - a members-only axis must let them through."""
    user_id = uuid4()
    ctx = _standing(platform_admins={user_id}).context(user_id)
    assert (ctx.is_member, ctx.is_admin, ctx.is_authoritative) == (True, True, False)
    assert is_allowed(PolicyAudience(kinds=["members"]), ctx) is True


def test_org_members_are_members_of_org_public_campaigns_only():
    user_id = uuid4()
    org_public = _standing("organization", org_members={user_id}).context(user_id)
    assert (org_public.is_member, org_public.is_admin) == (True, False)
    assert _standing("private", org_members={user_id}).context(user_id).is_member is False


def test_is_assigned_passes_through():
    user_id = uuid4()
    assert _standing().context(user_id, is_assigned=True).is_assigned is True


def test_load_standing_without_users_skips_queries():
    db = MagicMock()
    assert load_standing(db, _campaign(), []).roles == {}
    db.execute.assert_not_called()
    db.scalars.assert_not_called()


def test_load_standing_reads_org_members_only_for_org_public_projects():
    user_id = uuid4()
    db = MagicMock()
    db.execute.return_value.all.return_value = [(user_id, False, True)]
    db.scalars.return_value.all.return_value = []

    standing = load_standing(db, _campaign("private"), [user_id])

    assert standing.roles == {user_id: (False, True)}
    assert db.scalars.call_count == 1  # platform admins only


def test_build_policy_context_assigned_when_user_holds_any_assignment():
    user_id = uuid4()
    db = MagicMock()
    db.execute.return_value.all.return_value = []
    db.scalars.return_value.all.return_value = []
    mine = SimpleNamespace(assignments=[SimpleNamespace(user_id=user_id)])
    theirs = SimpleNamespace(assignments=[SimpleNamespace(user_id=uuid4())])

    assert build_policy_context(db, _campaign(), user_id, task=mine).is_assigned is True
    assert build_policy_context(db, _campaign(), user_id, task=theirs).is_assigned is False
    assert build_policy_context(db, _campaign(), user_id).is_assigned is False


# ============================================================================
# create_campaign: 'anyone' invariant enforced at creation, not just PATCH
# ============================================================================


def _campaign_settings_create() -> "service.CampaignSettingsCreate":
    from src.campaigns.schemas import CampaignSettingsCreate

    return CampaignSettingsCreate(
        labels=[], bbox_west=-10.0, bbox_south=-10.0, bbox_east=10.0, bbox_north=10.0
    )


def _db_capturing_campaign_settings() -> MagicMock:
    """A MagicMock db that mimics just enough of a real flush's relationship
    back-population for create_campaign to run past `campaign.settings.
    embedding_year`: when the CampaignSettings row is added, wire it onto the
    just-added Campaign's `.settings` the way a real flush/refresh would.
    """
    db = MagicMock()
    captured: dict = {}

    def _capture_add(obj):
        if isinstance(obj, Campaign):
            captured["campaign"] = obj
        elif isinstance(obj, CampaignSettings):
            captured["settings"] = obj
            captured["campaign"].settings = obj

    db.add.side_effect = _capture_add
    return db


def test_create_campaign_rejects_anyone_for_private_campaign():
    db = MagicMock()
    db.get.return_value = MagicMock(visibility="private")  # db.get(Project, project_id)
    policy = make_policy(explore=PolicyAudience(kinds=["anyone"]))

    with pytest.raises(HTTPException) as exc_info:
        service.create_campaign(
            db,
            name="x",
            default_work_mode="tasks",
            project_id=1,
            settings=_campaign_settings_create(),
            user_id=uuid4(),
            labelling_policy=policy,
        )

    assert exc_info.value.status_code == 400
    db.add.assert_not_called()


def test_create_campaign_allows_anyone_for_public_campaign():
    db = _db_capturing_campaign_settings()
    db.get.return_value = MagicMock(visibility="public")  # db.get(Project, project_id)
    policy = make_policy(explore=PolicyAudience(kinds=["anyone"]))

    service.create_campaign(
        db,
        name="x",
        default_work_mode="tasks",
        project_id=1,
        settings=_campaign_settings_create(),
        user_id=uuid4(),
        labelling_policy=policy,
    )

    db.add.assert_called()


def test_create_campaign_no_explicit_policy_public_gets_anyone_default():
    """create_campaign with no explicit policy on a public project should
    thread is_public into the default, granting 'anyone' on the three
    labellable axes - not the private default, which would immediately be
    inconsistent with a public project."""
    db = _db_capturing_campaign_settings()
    db.get.return_value = MagicMock(visibility="public")  # db.get(Project, project_id)

    service.create_campaign(
        db,
        name="x",
        default_work_mode="tasks",
        project_id=1,
        settings=_campaign_settings_create(),
        user_id=uuid4(),
    )

    settings_call = next(
        call for call in db.add.call_args_list if isinstance(call.args[0], CampaignSettings)
    )
    stored_policy = settings_call.args[0].labelling_policy
    assert "anyone" in stored_policy["explore"]["kinds"]


def test_create_campaign_no_explicit_policy_private_gets_private_default():
    db = _db_capturing_campaign_settings()
    db.get.return_value = MagicMock(visibility="private")  # db.get(Project, project_id)

    service.create_campaign(
        db,
        name="x",
        default_work_mode="tasks",
        project_id=1,
        settings=_campaign_settings_create(),
        user_id=uuid4(),
    )

    settings_call = next(
        call for call in db.add.call_args_list if isinstance(call.args[0], CampaignSettings)
    )
    stored_policy = settings_call.args[0].labelling_policy
    assert "anyone" not in stored_policy["explore"]["kinds"]


def test_modify_others_cannot_be_opened_to_anyone():
    """Undoing other people's work is not something a campaign opens to the
    public, however public its labelling is."""
    with pytest.raises(ValidationError):
        make_policy(modify_others=PolicyAudience(kinds=["anyone"]))

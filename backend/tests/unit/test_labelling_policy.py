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
    PolicyContext,
    build_policy_context,
    context_from_role_map,
    counts_toward_completion,
    get_campaign_role_map,
    get_labelling_policy,
    get_platform_admin_ids,
    is_allowed,
)
from src.campaigns.schemas import (
    LabellingPolicy,
    PolicyAudience,
    UpdateLabellingPolicyRequest,
    default_labelling_policy,
)


def _campaign(is_public: bool = False) -> Campaign:
    campaign = Campaign(id=1, name="x", mode="tasks", is_public=is_public)
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
        LabellingPolicy(explore=PolicyAudience(kinds=["assignees"]))


def test_assignees_rejected_on_unassigned_tasks():
    with pytest.raises(ValidationError):
        LabellingPolicy(unassigned_tasks=PolicyAudience(kinds=["assignees"]))


def test_assignees_accepted_on_assigned_tasks():
    policy = LabellingPolicy(assigned_tasks=PolicyAudience(kinds=["assignees"]))
    assert policy.assigned_tasks.kinds == ["assignees"]


def test_assignees_accepted_on_complete_assigned():
    policy = LabellingPolicy(complete_assigned=PolicyAudience(kinds=["assignees"]))
    assert policy.complete_assigned.kinds == ["assignees"]


def test_anyone_rejected_on_complete_assigned():
    with pytest.raises(ValidationError):
        LabellingPolicy(complete_assigned=PolicyAudience(kinds=["anyone"]))


def test_anyone_accepted_on_explore_unassigned_and_assigned():
    policy = LabellingPolicy(
        explore=PolicyAudience(kinds=["anyone"]),
        unassigned_tasks=PolicyAudience(kinds=["anyone"]),
        assigned_tasks=PolicyAudience(kinds=["anyone"]),
    )
    assert policy.explore.kinds == ["anyone"]
    assert policy.unassigned_tasks.kinds == ["anyone"]
    assert policy.assigned_tasks.kinds == ["anyone"]


def test_authoritative_rejected_on_explore():
    with pytest.raises(ValidationError):
        LabellingPolicy(explore=PolicyAudience(kinds=["authoritative"]))


def test_admins_accepted_on_every_axis():
    policy = LabellingPolicy(
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
    assert policy.explore.kinds == ["members"]
    assert policy.explore.user_ids == []
    assert policy.unassigned_tasks.kinds == ["members"]
    assert policy.assigned_tasks.kinds == ["members"]
    assert set(policy.complete_assigned.kinds) == {"assignees", "admins", "authoritative"}


def test_update_request_rejects_missing_axis():
    """PATCH is a full-replace of the stored policy: omitting an axis must be
    a 422, not a silent default to 'no one' for that axis."""
    with pytest.raises(ValidationError):
        UpdateLabellingPolicyRequest(
            unassigned_tasks=PolicyAudience(kinds=["members"]),
            assigned_tasks=PolicyAudience(kinds=["members"]),
            complete_assigned=PolicyAudience(kinds=["admins"]),
        )


def test_update_request_accepts_full_body():
    req = UpdateLabellingPolicyRequest(
        explore=PolicyAudience(kinds=["members"]),
        unassigned_tasks=PolicyAudience(kinds=["members"]),
        assigned_tasks=PolicyAudience(kinds=["members"]),
        complete_assigned=PolicyAudience(kinds=["admins"]),
    )
    assert req.explore.kinds == ["members"]


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
    assert set(policy.explore.kinds) == {"members", "anyone"}
    assert set(policy.unassigned_tasks.kinds) == {"members", "anyone"}
    assert set(policy.assigned_tasks.kinds) == {"members", "anyone"}


def test_public_default_policy_leaves_complete_assigned_unchanged():
    private_policy = default_labelling_policy(is_public=False)
    public_policy = default_labelling_policy(is_public=True)
    assert public_policy.complete_assigned == private_policy.complete_assigned
    assert "anyone" not in public_policy.complete_assigned.kinds


def test_public_default_policy_is_itself_valid():
    LabellingPolicy(**default_labelling_policy(is_public=True).model_dump())


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
    campaign = _campaign(is_public=False)
    db = MagicMock()
    db.get.return_value = campaign

    req = LabellingPolicy(
        explore=PolicyAudience(kinds=["anyone"]),
        complete_assigned=PolicyAudience(kinds=["admins"]),
    )

    with pytest.raises(HTTPException) as exc_info:
        service.update_labelling_policy(db, 1, req)

    assert exc_info.value.status_code == 400
    db.commit.assert_not_called()


def test_update_labelling_policy_allows_anyone_for_public_campaign():
    campaign = _campaign(is_public=True)
    db = MagicMock()
    db.get.return_value = campaign

    req = LabellingPolicy(
        explore=PolicyAudience(kinds=["anyone"]),
        complete_assigned=PolicyAudience(kinds=["admins"]),
    )

    result = service.update_labelling_policy(db, 1, req)

    assert result.explore.kinds == ["anyone"]
    db.commit.assert_called_once()


def test_update_labelling_policy_persists_without_anyone_on_private_campaign():
    campaign = _campaign(is_public=False)
    db = MagicMock()
    db.get.return_value = campaign

    req = LabellingPolicy(
        explore=PolicyAudience(kinds=["members"]),
        complete_assigned=PolicyAudience(kinds=["admins"]),
    )

    result = service.update_labelling_policy(db, 1, req)

    assert result.explore.kinds == ["members"]
    assert campaign.settings.labelling_policy["explore"]["kinds"] == ["members"]
    db.commit.assert_called_once()


def test_update_labelling_policy_missing_campaign_raises_404():
    db = MagicMock()
    db.get.return_value = None

    with pytest.raises(HTTPException) as exc_info:
        service.update_labelling_policy(db, 1, default_labelling_policy())

    assert exc_info.value.status_code == 404


# ============================================================================
# get_labelling_policy: campaign -> LabellingPolicy, with legacy fallback
# ============================================================================


def test_get_labelling_policy_returns_default_when_settings_missing():
    campaign = Campaign(id=1, name="x", mode="tasks")
    campaign.settings = None
    assert get_labelling_policy(campaign) == default_labelling_policy()


def test_get_labelling_policy_returns_default_when_column_empty():
    campaign = _campaign()  # labelling_policy={} per the shared helper
    assert get_labelling_policy(campaign) == default_labelling_policy()


def test_get_labelling_policy_reads_stored_policy():
    campaign = _campaign()
    campaign.settings.labelling_policy = {
        "explore": {"kinds": ["anyone"], "user_ids": []},
        "unassigned_tasks": {"kinds": ["members"], "user_ids": []},
        "assigned_tasks": {"kinds": ["members"], "user_ids": []},
        "complete_assigned": {"kinds": ["admins"], "user_ids": []},
    }
    policy = get_labelling_policy(campaign)
    assert policy.explore.kinds == ["anyone"]
    assert policy.complete_assigned.kinds == ["admins"]


# ============================================================================
# context_from_role_map: pure PolicyContext construction from pre-fetched maps
# ============================================================================


def test_context_from_role_map_non_member_defaults_false():
    user_id = uuid4()
    ctx = context_from_role_map(user_id, role_map={}, platform_admin_ids=set())
    assert ctx == PolicyContext(
        user_id=user_id, is_admin=False, is_authoritative=False, is_member=False, is_assigned=False
    )


def test_context_from_role_map_reads_campaign_admin_and_authoritative_flags():
    user_id = uuid4()
    ctx = context_from_role_map(user_id, role_map={user_id: (True, True)}, platform_admin_ids=set())
    assert ctx.is_member is True
    assert ctx.is_admin is True
    assert ctx.is_authoritative is True


def test_context_from_role_map_platform_admin_without_campaign_admin_flag():
    """A platform admin who isn't flagged is_admin on the CampaignUser row
    still resolves as an admin."""
    user_id = uuid4()
    ctx = context_from_role_map(
        user_id, role_map={user_id: (False, False)}, platform_admin_ids={user_id}
    )
    assert ctx.is_admin is True


def test_context_from_role_map_passes_through_is_assigned():
    user_id = uuid4()
    ctx = context_from_role_map(user_id, role_map={}, platform_admin_ids=set(), is_assigned=True)
    assert ctx.is_assigned is True


# ============================================================================
# get_campaign_role_map / get_platform_admin_ids: single-query batch lookups
# ============================================================================


def test_get_campaign_role_map_builds_dict_from_rows():
    user_a, user_b = uuid4(), uuid4()
    db = MagicMock()
    db.execute.return_value.all.return_value = [(user_a, True, False), (user_b, False, True)]

    role_map = get_campaign_role_map(db, campaign_id=1)

    assert role_map == {user_a: (True, False), user_b: (False, True)}


def test_get_platform_admin_ids_empty_input_skips_query():
    db = MagicMock()
    assert get_platform_admin_ids(db, []) == set()
    db.scalars.assert_not_called()


def test_get_platform_admin_ids_returns_matching_set():
    admin_id, other_id = uuid4(), uuid4()
    db = MagicMock()
    db.scalars.return_value.all.return_value = [admin_id]

    result = get_platform_admin_ids(db, [admin_id, other_id])

    assert result == {admin_id}


# ============================================================================
# build_policy_context: real-time, single-user PolicyContext for enforcement
# ============================================================================


def _db_with_campaign_user(cu=None, is_platform_admin=False):
    """A MagicMock db wired so the CampaignUser lookup (`db.scalars(...).first()`)
    and auth.service.is_admin's role check (`db.execute(...).first()`) - two
    different mock chains - can be configured independently. Both default to
    "no" so tests only need to name what they're asserting."""
    db = MagicMock()
    db.scalars.return_value.first.return_value = cu
    db.execute.return_value.first.return_value = ("admin",) if is_platform_admin else None
    return db


def test_build_policy_context_non_member_non_admin():
    campaign = _campaign()
    user_id = uuid4()
    db = _db_with_campaign_user(cu=None)

    ctx = build_policy_context(db, campaign, user_id)

    assert ctx == PolicyContext(
        user_id=user_id, is_admin=False, is_authoritative=False, is_member=False, is_assigned=False
    )


def test_build_policy_context_campaign_admin():
    campaign = _campaign()
    user_id = uuid4()
    cu = SimpleNamespace(is_admin=True, is_authoritative_reviewer=False)
    db = _db_with_campaign_user(cu=cu)

    ctx = build_policy_context(db, campaign, user_id)

    assert ctx.is_member is True
    assert ctx.is_admin is True
    assert ctx.is_authoritative is False


def test_build_policy_context_authoritative_reviewer():
    campaign = _campaign()
    user_id = uuid4()
    cu = SimpleNamespace(is_admin=False, is_authoritative_reviewer=True)
    db = _db_with_campaign_user(cu=cu)

    ctx = build_policy_context(db, campaign, user_id)

    assert ctx.is_authoritative is True
    assert ctx.is_admin is False


def test_build_policy_context_platform_admin_without_campaign_membership():
    campaign = _campaign()
    user_id = uuid4()
    db = _db_with_campaign_user(cu=None, is_platform_admin=True)

    ctx = build_policy_context(db, campaign, user_id)

    assert ctx.is_admin is True
    assert ctx.is_member is False


def test_build_policy_context_no_task_is_never_assigned():
    campaign = _campaign()
    user_id = uuid4()
    db = _db_with_campaign_user(cu=None)

    ctx = build_policy_context(db, campaign, user_id, task=None)

    assert ctx.is_assigned is False


def test_build_policy_context_assigned_when_user_holds_any_assignment():
    campaign = _campaign()
    user_id = uuid4()
    db = _db_with_campaign_user(cu=None)
    task = SimpleNamespace(assignments=[SimpleNamespace(user_id=user_id)])

    ctx = build_policy_context(db, campaign, user_id, task=task)

    assert ctx.is_assigned is True


def test_build_policy_context_not_assigned_when_task_assigned_to_others():
    campaign = _campaign()
    user_id = uuid4()
    db = _db_with_campaign_user(cu=None)
    task = SimpleNamespace(assignments=[SimpleNamespace(user_id=uuid4())])

    ctx = build_policy_context(db, campaign, user_id, task=task)

    assert ctx.is_assigned is False


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
    policy = LabellingPolicy(explore=PolicyAudience(kinds=["anyone"]))

    with pytest.raises(HTTPException) as exc_info:
        service.create_campaign(
            db,
            name="x",
            mode="tasks",
            is_public=False,
            settings=_campaign_settings_create(),
            user_id=uuid4(),
            labelling_policy=policy,
        )

    assert exc_info.value.status_code == 400
    db.add.assert_not_called()


def test_create_campaign_allows_anyone_for_public_campaign():
    db = _db_capturing_campaign_settings()
    policy = LabellingPolicy(explore=PolicyAudience(kinds=["anyone"]))

    service.create_campaign(
        db,
        name="x",
        mode="tasks",
        is_public=True,
        settings=_campaign_settings_create(),
        user_id=uuid4(),
        labelling_policy=policy,
    )

    db.add.assert_called()


def test_create_campaign_no_explicit_policy_public_gets_anyone_default():
    """create_campaign with no explicit policy on a public campaign should
    thread is_public into the default, granting 'anyone' on the three
    labellable axes - not the private default, which would immediately be
    inconsistent with a public campaign."""
    db = _db_capturing_campaign_settings()

    service.create_campaign(
        db,
        name="x",
        mode="tasks",
        is_public=True,
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

    service.create_campaign(
        db,
        name="x",
        mode="tasks",
        is_public=False,
        settings=_campaign_settings_create(),
        user_id=uuid4(),
    )

    settings_call = next(
        call for call in db.add.call_args_list if isinstance(call.args[0], CampaignSettings)
    )
    stored_policy = settings_call.args[0].labelling_policy
    assert "anyone" not in stored_policy["explore"]["kinds"]

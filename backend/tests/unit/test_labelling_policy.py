"""Unit tests for the labelling-policy model layer: schema validation, the
pure policy.py evaluation core, and the admin update service call.

DB-free per repo convention: CampaignSettings/Campaign are plain SQLAlchemy
model instances (no session), and the DB session in service tests is a
MagicMock.
"""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src.campaigns import service
from src.campaigns.models import Campaign, CampaignSettings
from src.campaigns.policy import PolicyContext, counts_toward_completion, is_allowed
from src.campaigns.schemas import (
    LabellingPolicy,
    PolicyAudience,
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


def test_default_policy_is_itself_valid():
    # Round-trips through validation without raising.
    LabellingPolicy(**default_labelling_policy().model_dump())


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

"""Unit tests for Campaign Pydantic schema validation."""

import pytest
from pydantic import ValidationError

from src.campaigns.schemas import AssignReviewersRequest, CampaignCreate, CampaignSettingsCreate


def _minimal_settings() -> dict:
    return {
        "labels": [],
        "bbox_west": -10.0,
        "bbox_south": -10.0,
        "bbox_east": 10.0,
        "bbox_north": 10.0,
    }


def test_campaign_create_mode_tasks_accepted():
    data = CampaignCreate(
        name="x", mode="tasks", settings=CampaignSettingsCreate(**_minimal_settings())
    )
    assert data.mode == "tasks"


def test_campaign_create_mode_open_accepted():
    data = CampaignCreate(
        name="x", mode="open", settings=CampaignSettingsCreate(**_minimal_settings())
    )
    assert data.mode == "open"


def test_campaign_create_mode_invalid_rejected():
    with pytest.raises(ValidationError):
        CampaignCreate(
            name="x", mode="open-world", settings=CampaignSettingsCreate(**_minimal_settings())
        )


def test_campaign_create_mode_arbitrary_string_rejected():
    with pytest.raises(ValidationError):
        CampaignCreate(
            name="x", mode="bogus", settings=CampaignSettingsCreate(**_minimal_settings())
        )


def test_assign_reviewers_pattern_percentage_accepted():
    req = AssignReviewersRequest(
        pattern="percentage", percentage=50.0, num_reviewers=1, reviewer_ids=[]
    )
    assert req.pattern == "percentage"


def test_assign_reviewers_pattern_fixed_accepted():
    req = AssignReviewersRequest(pattern="fixed", num_tasks=10, fixed_num_reviewers=1)
    assert req.pattern == "fixed"


def test_assign_reviewers_pattern_manual_accepted():
    req = AssignReviewersRequest(pattern="manual", manual_assignments={1: []})
    assert req.pattern == "manual"


def test_assign_reviewers_pattern_invalid_rejected():
    with pytest.raises(ValidationError):
        AssignReviewersRequest(pattern="random")

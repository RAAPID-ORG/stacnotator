"""Unit tests for Campaign Pydantic schema validation."""

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from src.campaigns.schemas import (
    AssignReviewersRequest,
    CampaignCreate,
    CampaignOut,
    CampaignOutFull,
    CampaignSettingsCreate,
    default_labelling_policy,
)


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


def test_campaign_create_mode_defaults_to_tasks():
    data = CampaignCreate(name="x", settings=CampaignSettingsCreate(**_minimal_settings()))
    assert data.mode == "tasks"


def test_campaign_create_labelling_policy_defaults_to_none():
    data = CampaignCreate(name="x", settings=CampaignSettingsCreate(**_minimal_settings()))
    assert data.labelling_policy is None


def test_campaign_create_project_id_defaults_to_none():
    data = CampaignCreate(name="x", settings=CampaignSettingsCreate(**_minimal_settings()))
    assert data.project_id is None


def test_campaign_create_project_id_round_trips():
    data = CampaignCreate(
        name="x", project_id=3, settings=CampaignSettingsCreate(**_minimal_settings())
    )
    assert data.project_id == 3


def _campaign_orm_stub(project_id: int = 7) -> SimpleNamespace:
    return SimpleNamespace(
        id=1,
        project_id=project_id,
        name="Campaign",
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        mode="open",
        is_public=False,
        annotations_version=0,
        settings=SimpleNamespace(
            **_minimal_settings(),
            labelling_policy=default_labelling_policy(),
            form_fields=[],
            embedding_year=None,
            guide_markdown=None,
            sample_extent_meters=None,
        ),
        time_series=[],
        imagery_sources=[],
        imagery_views=[],
        basemaps=[],
        custom_maps=[],
        vector_layers=[],
        canvas_layouts=[],
    )


def test_campaign_out_exposes_project_id():
    assert "project_id" in CampaignOut.model_fields


def test_campaign_out_full_from_orm_carries_project_id():
    out = CampaignOutFull.from_orm(_campaign_orm_stub(project_id=7))
    assert out.project_id == 7


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


def test_settings_accept_form_fields():
    settings = CampaignSettingsCreate(
        **_minimal_settings(),
        form_fields=[
            {"id": 1, "title": "Notes", "type": "text"},
        ],
    )
    orm = settings.to_orm()
    assert orm["form_fields"] == [
        {
            "id": 1,
            "title": "Notes",
            "description": None,
            "required": False,
            "type": "text",
            "multiline": False,
        }
    ]


def test_settings_reject_duplicate_form_field_slugs():
    with pytest.raises(ValidationError):
        CampaignSettingsCreate(
            **_minimal_settings(),
            form_fields=[
                {"id": 1, "title": "Notes", "type": "text"},
                {"id": 2, "title": "notes!", "type": "text"},
            ],
        )

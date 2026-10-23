"""Unit tests for Campaign Pydantic schema validation."""

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from pydantic import TypeAdapter, ValidationError

from src.campaigns.schemas import (
    CampaignCreate,
    CampaignOut,
    CampaignOutFull,
    CampaignSettingsCreate,
    default_labelling_policy,
)
from src.tasks.schemas import AssignReviewersRequest, ReviewNumberOfTasks, ReviewShareOfTasks


def _minimal_settings() -> dict:
    return {
        "labels": [],
        "bbox_west": -10.0,
        "bbox_south": -10.0,
        "bbox_east": 10.0,
        "bbox_north": 10.0,
    }


@pytest.mark.parametrize("mode", ["tasks", "explore"])
def test_campaign_create_accepts_both_work_modes(mode):
    data = CampaignCreate(
        name="x",
        default_work_mode=mode,
        project_id=1,
        settings=CampaignSettingsCreate(**_minimal_settings()),
    )
    assert data.default_work_mode == mode


@pytest.mark.parametrize("mode", ["open", "bogus"])
def test_campaign_create_rejects_unknown_work_modes(mode):
    with pytest.raises(ValidationError):
        CampaignCreate(
            name="x",
            default_work_mode=mode,
            project_id=1,
            settings=CampaignSettingsCreate(**_minimal_settings()),
        )


def test_campaign_create_work_mode_defaults_to_tasks():
    data = CampaignCreate(
        name="x", project_id=1, settings=CampaignSettingsCreate(**_minimal_settings())
    )
    assert data.default_work_mode == "tasks"


def test_campaign_create_labelling_policy_defaults_to_none():
    data = CampaignCreate(
        name="x", project_id=1, settings=CampaignSettingsCreate(**_minimal_settings())
    )
    assert data.labelling_policy is None


def test_campaign_create_requires_project_id():
    with pytest.raises(ValidationError):
        CampaignCreate(name="x", settings=CampaignSettingsCreate(**_minimal_settings()))


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
        default_work_mode="explore",
        is_public=False,
        annotations_version=0,
        settings=SimpleNamespace(
            **{
                **_minimal_settings(),
                "labels": [{"id": 1, "name": "Forest", "geometry_type": "polygon"}],
            },
            task_output="classify",
            labelling_policy=default_labelling_policy(),
            form_fields=[],
            research_sharing=False,
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
    out = CampaignOutFull.model_validate(_campaign_orm_stub(project_id=7))
    assert out.project_id == 7


def test_campaign_out_full_viewer_role_flags_default_to_false():
    out = CampaignOutFull.model_validate(_campaign_orm_stub())
    assert not out.viewer_is_admin
    assert not out.viewer_is_member
    assert not out.viewer_is_authoritative_reviewer


@pytest.mark.parametrize("registration_status", ["registering", "failed", "ready"])
def test_campaign_out_full_preserves_background_status(registration_status):
    campaign = _campaign_orm_stub()
    campaign.registration_status = registration_status
    campaign.embedding_status = "registering"
    campaign.registration_errors = [{"message": "Registration failed"}]

    out = CampaignOutFull.model_validate(campaign)

    assert out.registration_status == registration_status
    assert out.embedding_status == "registering"
    assert out.registration_errors == campaign.registration_errors
    assert (
        out.model_dump(include=set(CampaignOut.model_fields))
        == CampaignOut.model_validate(campaign).model_dump()
    )


def test_assign_reviewers_request_is_picked_by_pattern():
    adapter = TypeAdapter(AssignReviewersRequest)
    share = adapter.validate_python(
        {"pattern": "percentage", "percentage": 50.0, "reviewers_per_task": 1, "reviewer_ids": []}
    )
    number = adapter.validate_python(
        {"pattern": "fixed", "num_tasks": 10, "reviewers_per_task": 1, "reviewer_ids": []}
    )
    assert isinstance(share, ReviewShareOfTasks)
    assert isinstance(number, ReviewNumberOfTasks)


@pytest.mark.parametrize(
    "body",
    [
        {"pattern": "manual", "manual_assignments": {1: []}},
        {"pattern": "fixed", "reviewers_per_task": 1, "reviewer_ids": []},
    ],
)
def test_assign_reviewers_request_rejects_incomplete_or_unknown_patterns(body):
    with pytest.raises(ValidationError):
        TypeAdapter(AssignReviewersRequest).validate_python(body)


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

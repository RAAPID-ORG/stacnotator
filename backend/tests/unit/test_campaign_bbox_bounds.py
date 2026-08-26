"""The settings table CHECKs, enforced before the insert rather than by it."""

import pytest
from pydantic import ValidationError

from src.campaigns.schemas import CampaignSettingsCreate, UpdateCampaignBBoxRequest

VALID = {
    "labels": [],
    "bbox_west": -176.5,
    "bbox_south": 65.3,
    "bbox_east": -170.0,
    "bbox_north": 67.7,
}


def test_a_normal_area_is_accepted():
    settings = CampaignSettingsCreate(**VALID)
    assert settings.bbox_west == -176.5


def test_a_longitude_past_the_antimeridian_is_refused():
    """A map panned west of 180 hands back -196; the insert used to take it and
    die on settings_bbox_west_range, which reached the user as a 500."""
    with pytest.raises(ValidationError) as err:
        CampaignSettingsCreate(**{**VALID, "bbox_west": -196.17117428059476})
    assert "bbox_west" in str(err.value)


def test_latitudes_past_the_poles_are_refused():
    with pytest.raises(ValidationError):
        CampaignSettingsCreate(**{**VALID, "bbox_north": 95.0})


def test_an_area_crossing_the_antimeridian_says_so():
    # Both ends in range, but the box wraps: 163E round to -176E.
    with pytest.raises(ValidationError) as err:
        CampaignSettingsCreate(**{**VALID, "bbox_west": 163.8, "bbox_east": -176.5})
    assert "antimeridian" in str(err.value)


def test_an_inverted_latitude_range_is_refused():
    with pytest.raises(ValidationError):
        CampaignSettingsCreate(**{**VALID, "bbox_south": 70.0, "bbox_north": 65.0})


def test_the_bbox_update_endpoint_is_held_to_the_same_rules():
    with pytest.raises(ValidationError):
        UpdateCampaignBBoxRequest(
            bbox_west=-196.17, bbox_south=65.3, bbox_east=-176.5, bbox_north=67.7
        )

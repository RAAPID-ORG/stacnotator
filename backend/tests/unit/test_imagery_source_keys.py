"""A source may name one of its organization's shared keys when it is created."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src.imagery.schemas import ImageryEditorStateCreate, ImagerySourceCreate
from src.imagery.service import _validate_organization_keys


def editor_state(**source_overrides) -> ImageryEditorStateCreate:
    source = {
        "name": "Planet Global Monthly",
        "visualizations": [{"name": "Visual"}],
        "collections": [],
        **source_overrides,
    }
    return ImageryEditorStateCreate.model_validate({"sources": [source], "basemaps": []})


def org_with_keys(*ids: int):
    return SimpleNamespace(api_keys=[SimpleNamespace(id=i) for i in ids])


def test_a_key_of_the_owning_organization_is_accepted():
    _validate_organization_keys(org_with_keys(4, 5), editor_state(organization_api_key_id=5))


def test_a_source_naming_no_key_is_fine():
    _validate_organization_keys(org_with_keys(4), editor_state())


def test_a_key_from_another_organization_is_rejected_before_any_write():
    with pytest.raises(HTTPException) as exc:
        _validate_organization_keys(org_with_keys(4), editor_state(organization_api_key_id=99))

    assert exc.value.status_code == 404


def test_a_source_may_carry_its_own_key_instead_of_an_organizations():
    source = ImagerySourceCreate.model_validate(
        {"name": "s", "visualizations": [], "collections": [], "api_key": "PLANET-KEY"}
    )

    assert source.api_key == "PLANET-KEY"
    assert source.organization_api_key_id is None


def test_a_source_cannot_name_two_key_sources_at_once():
    with pytest.raises(ValidationError):
        ImagerySourceCreate.model_validate(
            {
                "name": "s",
                "visualizations": [],
                "collections": [],
                "api_key": "PLANET-KEY",
                "organization_api_key_id": 5,
            }
        )


def test_max_native_zoom_stays_inside_the_web_mercator_range():
    assert (
        ImagerySourceCreate.model_validate(
            {"name": "s", "visualizations": [], "collections": [], "max_native_zoom": 15}
        ).max_native_zoom
        == 15
    )

    with pytest.raises(ValidationError):
        ImagerySourceCreate.model_validate(
            {"name": "s", "visualizations": [], "collections": [], "max_native_zoom": 30}
        )

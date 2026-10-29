"""A layer's provider key travels in the same save as the layer itself."""

import base64
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src import crypto
from src.imagery.models import Basemap
from src.imagery.schemas import BasemapCreate, ImagerySourceCreate
from src.imagery.service import _check_layers, _save_basemaps
from src.layers import LayerOwner
from src.tilers.registry import MPC_STAC_URL

CAMPAIGN = LayerOwner(campaign_id=7)


@pytest.fixture(autouse=True)
def crypto_key(monkeypatch):
    key = base64.b64encode(b"k" * 32).decode()
    monkeypatch.setattr(
        crypto, "get_settings", lambda: SimpleNamespace(APIKEY_ENCRYPTION_SECRET=key)
    )


def sources(**source_overrides) -> list[ImagerySourceCreate]:
    source = {
        "name": "Planet Global Monthly",
        "visualizations": [{"name": "Visual"}],
        "collections": [],
        **source_overrides,
    }
    return [ImagerySourceCreate.model_validate(source)]


def org_with_keys(*ids: int):
    return SimpleNamespace(
        api_keys=[SimpleNamespace(id=i) for i in ids],
        allowed_tiler_names=[],
        allows_internal_storage=False,
    )


def test_a_key_of_the_owning_organization_is_accepted():
    _check_layers(org_with_keys(4, 5), sources(organization_api_key_id=5), [])


def test_a_source_naming_no_key_is_fine():
    _check_layers(org_with_keys(4), sources(), [])


def test_a_key_from_another_organization_is_rejected_before_any_write():
    with pytest.raises(HTTPException) as exc:
        _check_layers(org_with_keys(4), sources(organization_api_key_id=99), [])

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


def keyed_basemap(**key) -> Basemap:
    return Basemap(
        id=3, campaign_id=7, name="Planet", url="https://p/{z}/{x}/{y}?k={api_key}", **key
    )


def save(existing: list[Basemap], *entries: dict) -> list[Basemap]:
    return _save_basemaps(
        MagicMock(), CAMPAIGN, existing, [BasemapCreate.model_validate(e) for e in entries]
    )


def test_saving_basemaps_keeps_a_key_the_entry_does_not_repeat():
    """A saved key is never sent back, so every later save arrives without it."""
    basemap = keyed_basemap(encrypted_api_key=crypto.encrypt("planet-secret"))

    [saved] = save([basemap], {"id": 3, "name": "Renamed", "url": basemap.url})

    assert saved is basemap
    assert saved.name == "Renamed"
    assert crypto.decrypt(saved.encrypted_api_key) == "planet-secret"


def test_a_new_basemap_is_saved_with_the_key_typed_for_it():
    [saved] = save([], {"name": "Planet", "url": "https://p/{api_key}", "api_key": "typed"})

    assert saved.campaign_id == 7
    assert saved.encrypted_api_key != "typed"
    assert crypto.decrypt(saved.encrypted_api_key) == "typed"


def test_choosing_a_shared_key_drops_the_typed_one_and_back():
    basemap = keyed_basemap(encrypted_api_key=crypto.encrypt("typed"))

    [saved] = save(
        [basemap], {"id": 3, "name": "P", "url": "https://p/{z}", "organization_api_key_id": 11}
    )
    assert (saved.encrypted_api_key, saved.organization_api_key_id) == (None, 11)

    [saved] = save([basemap], {"id": 3, "name": "P", "url": "https://p/{z}", "api_key": "new"})
    assert saved.organization_api_key_id is None
    assert crypto.decrypt(saved.encrypted_api_key) == "new"


def test_a_basemap_left_out_of_the_save_is_deleted():
    db = MagicMock()
    basemap = keyed_basemap()

    assert _save_basemaps(db, CAMPAIGN, [basemap], []) == []
    db.delete.assert_called_once_with(basemap)


def test_a_basemap_naming_another_organizations_key_is_rejected():
    basemap = BasemapCreate(
        name="P", url="https://tiles.example/{z}/{x}/{y}.png", organization_api_key_id=99
    )

    with pytest.raises(HTTPException) as exc:
        _check_layers(org_with_keys(4), [], [basemap])

    assert exc.value.status_code == 404


def test_internal_storage_needs_an_organization_cleared_for_it():
    source = sources(
        collections=[
            {
                "name": "2024",
                "slices": [],
                "search": {
                    "catalog_url": MPC_STAC_URL,
                    "stac_collection_id": "c",
                    "internal_storage": True,
                },
                "visualizations": [{"visualization": "Visual", "params": {"assets": ["visual"]}}],
            }
        ]
    )

    mpc_only = org_with_keys()
    mpc_only.allowed_tiler_names = ["mpc"]
    with pytest.raises(HTTPException) as exc:
        _check_layers(mpc_only, source, [])
    assert exc.value.status_code == 403

    cleared = org_with_keys()
    cleared.allowed_tiler_names = ["mpc"]
    cleared.allows_internal_storage = True
    _check_layers(cleared, source, [])

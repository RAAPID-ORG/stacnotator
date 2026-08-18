import pytest
from pydantic import ValidationError

from src.custom_layers.schemas import VectorLayerCreate, VectorLayerUpdate


def test_create_valid_with_defaults():
    layer = VectorLayerCreate(name="predictions", pmtiles_url="https://example.com/pred.pmtiles")
    assert layer.color == "#3b82f6"
    assert layer.source_layer is None


def test_create_accepts_optional_source_layer_and_color():
    layer = VectorLayerCreate(
        name="fields",
        pmtiles_url="https://example.com/fields.pmtiles",
        source_layer="parcels",
        color="#00FF00",
    )
    assert layer.source_layer == "parcels"
    assert layer.color == "#00FF00"


def test_create_accepts_8_digit_rgba_hex():
    layer = VectorLayerCreate(
        name="fields",
        pmtiles_url="https://example.com/fields.pmtiles",
        color="#00ff0080",
    )
    assert layer.color == "#00ff0080"


def test_create_rejects_empty_name():
    with pytest.raises(ValidationError):
        VectorLayerCreate(name="", pmtiles_url="https://example.com/x.pmtiles")


def test_create_rejects_empty_url():
    with pytest.raises(ValidationError):
        VectorLayerCreate(name="x", pmtiles_url="")


def test_create_rejects_bad_color():
    with pytest.raises(ValidationError):
        VectorLayerCreate(
            name="x",
            pmtiles_url="https://example.com/x.pmtiles",
            color="red",
        )


def test_update_is_all_optional():
    upd = VectorLayerUpdate()
    assert upd.model_dump(exclude_unset=True) == {}


def test_update_rejects_bad_color():
    with pytest.raises(ValidationError):
        VectorLayerUpdate(color="nope")

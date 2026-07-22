import pytest
from pydantic import ValidationError

from src.custom_layers.schemas import CustomMapCreate, RenderConfig


def test_unrenderable_config_still_parses_so_legacy_rows_stay_readable():
    """Renderability is enforced by the service, not here. RenderConfig also types CustomMapOut,
    so a validator on it would make rows written before that check unreadable - 500ing the whole
    campaign GET, and leaving the offending map undeletable through the UI."""
    assert (
        RenderConfig.model_validate({"mode": "continuous", "rescale": [0, 1]}).colormap_name is None
    )


def test_continuous_create_valid():
    m = CustomMapCreate(
        name="cropland prob",
        cog_url="https://example.com/pred.tif",
        render_config={"mode": "continuous", "colormap_name": "viridis", "rescale": [0, 1]},
    )
    assert m.render_config.mode == "continuous"


def test_categorical_create_valid():
    m = CustomMapCreate(
        name="cropland mask",
        cog_url="https://example.com/mask.tif",
        render_config={
            "mode": "categorical",
            "entries": [{"value": 1, "color": "#ff0000", "label": "crop"}],
        },
    )
    assert m.render_config.entries[0].label == "crop"


def test_mlops_url_round_trips_and_defaults_to_none():
    bare = CustomMapCreate(
        name="preds",
        cog_url="https://example.com/pred.tif",
        render_config={"mode": "continuous", "rescale": [0, 1]},
    )
    assert bare.mlops_url is None

    linked = CustomMapCreate(
        name="preds",
        cog_url="https://example.com/pred.tif",
        render_config={"mode": "continuous", "rescale": [0, 1]},
        mlops_url="https://mlflow.example.com/#/experiments/7",
    )
    assert linked.mlops_url == "https://mlflow.example.com/#/experiments/7"


def test_categorical_entries_capped_at_256():
    entries = [{"value": i, "color": "#ff0000", "label": str(i)} for i in range(256)]
    ok = CustomMapCreate(
        name="mask",
        cog_url="https://example.com/mask.tif",
        render_config={"mode": "categorical", "entries": entries},
    )
    assert len(ok.render_config.entries) == 256

    with pytest.raises(ValidationError):
        CustomMapCreate(
            name="mask",
            cog_url="https://example.com/mask.tif",
            render_config={
                "mode": "categorical",
                "entries": entries + [{"value": 256, "color": "#ff0000", "label": "x"}],
            },
        )


def test_colormap_name_restricted_to_legend_supported_set():
    for name in ("viridis", "plasma", "magma", "inferno", "rdylgn", "turbo", "cividis", "rdbu"):
        m = CustomMapCreate(
            name="m",
            cog_url="https://example.com/p.tif",
            render_config={"mode": "continuous", "colormap_name": name, "rescale": [0, 1]},
        )
        assert m.render_config.colormap_name == name

    with pytest.raises(ValidationError):
        CustomMapCreate(
            name="m",
            cog_url="https://example.com/p.tif",
            render_config={"mode": "continuous", "colormap_name": "coolwarm", "rescale": [0, 1]},
        )

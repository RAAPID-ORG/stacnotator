import pytest
from pydantic import ValidationError

from src.custom_layers.schemas import CustomMapOut, VectorLayerOut

RENDER = {"mode": "categorical", "band": 1, "entries": [{"value": 1, "color": "#ff0000"}]}


def _map(**owner):
    return dict(
        id=1,
        name="Land cover",
        cog_url="https://example.test/a.tif",
        render_config=RENDER,
        max_native_zoom=14,
        status="ready",
        status_error=None,
        tile_url=None,
        mosaic_id=None,
        display_order=0,
        mlops_url=None,
        internal_storage=False,
        **owner,
    )


@pytest.mark.parametrize("owner", [{"campaign_id": 7}, {"visualizer_id": 3}])
def test_a_custom_map_serializes_for_either_owner(owner):
    """A layer belongs to a campaign or a visualizer, never both. Requiring campaign_id
    turned listing a visualizer's own maps into a 500 on a plain read."""
    out = CustomMapOut.model_validate(_map(**owner))
    assert (out.campaign_id, out.visualizer_id) != (None, None)


def test_a_custom_map_still_needs_the_rest():
    with pytest.raises(ValidationError):
        CustomMapOut.model_validate({"id": 1, "visualizer_id": 3})


@pytest.mark.parametrize("owner", [{"campaign_id": 7}, {"visualizer_id": 3}])
def test_a_vector_layer_serializes_for_either_owner(owner):
    out = VectorLayerOut.model_validate(
        dict(
            id=1,
            name="Fields",
            pmtiles_url="https://example.test/a.pmtiles",
            source_layer=None,
            color="#00ff00",
            display_order=0,
            **owner,
        )
    )
    assert (out.campaign_id, out.visualizer_id) != (None, None)

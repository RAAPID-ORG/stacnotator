"""An overlay set up on the visualizer itself has no campaign behind it."""

from src.custom_layers.models import CustomMap
from src.visualizers.models import VisualizerOverlay
from src.visualizers.service import _overlay_out

RENDER_CONFIG = {
    "mode": "categorical",
    "band": 1,
    "nodata": 0,
    "entries": [{"value": 10, "color": "#006400", "label": "Tree cover"}],
}


def _overlay(**custom_map_kwargs) -> VisualizerOverlay:
    custom_map = CustomMap(
        name="ESA WorldCover 2021",
        cog_url="https://example.org/worldcover.tif",
        render_config=RENDER_CONFIG,
        status="ready",
        tile_url="https://tiler.example.org/searches/abc/tiles/{z}/{x}/{y}.png",
        **custom_map_kwargs,
    )
    return VisualizerOverlay(id=1, custom_map=custom_map, visible=True, opacity=1.0)


def test_a_visualizer_owned_raster_overlay_renders():
    out = _overlay_out(_overlay(visualizer_id=2))

    assert out is not None
    assert out.kind == "raster"
    assert out.campaign_id is None
    assert out.name == "ESA WorldCover 2021"


def test_a_linked_campaign_overlay_keeps_its_campaign():
    assert _overlay_out(_overlay(campaign_id=113)).campaign_id == 113

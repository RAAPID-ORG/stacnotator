"""An overlay set up on the visualizer itself has no campaign behind it."""

from types import SimpleNamespace

from src.config import TilerCfg
from src.custom_layers import render
from src.custom_layers.models import CustomMap
from src.visualizers.models import Visualizer, VisualizerOverlay
from src.visualizers.service import _overlay_out

VISUALIZER = Visualizer(id=2)

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
        **custom_map_kwargs,
    )
    return VisualizerOverlay(id=1, custom_map=custom_map, visible=True, opacity=1.0)


def test_a_visualizer_owned_raster_overlay_renders():
    out = _overlay_out(_overlay(visualizer_id=2), VISUALIZER)

    assert out is not None
    assert out.kind == "raster"
    assert out.campaign_id is None
    assert out.name == "ESA WorldCover 2021"


def test_a_linked_campaign_overlay_keeps_its_campaign():
    assert _overlay_out(_overlay(campaign_id=113), VISUALIZER).campaign_id == 113


def test_a_linked_campaign_overlay_is_served_under_the_visualizer(monkeypatch):
    settings = SimpleNamespace(TILERS={"hosted": TilerCfg(url="https://tiler.test")})
    monkeypatch.setattr(render, "get_settings", lambda: settings)

    out = _overlay_out(_overlay(campaign_id=113, mosaic_id="s1", tiler="hosted"), VISUALIZER)

    assert out.tile_url.startswith("https://tiler.test/scopes/visualizer:2/searches/s1/")

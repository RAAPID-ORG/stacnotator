import json

import pytest

from src.custommaps.render import ASSET_KEY, build_viz_params


def test_continuous_params():
    cfg = {"mode": "continuous", "band": 1, "colormap_name": "viridis", "rescale": [0, 1]}
    p = build_viz_params(cfg)
    assert p["assets"] == [ASSET_KEY]
    assert p["rescale"] == "0,1"
    assert p["colormap_name"] == "viridis"
    assert "bidx" not in p  # band 1 is implicit


def test_continuous_nondefault_band_sets_bidx():
    cfg = {"mode": "continuous", "band": 3, "colormap_name": "viridis", "rescale": [0, 1]}
    assert build_viz_params(cfg)["bidx"] == [3]


def test_continuous_requires_rescale_and_colormap():
    with pytest.raises(ValueError):
        build_viz_params({"mode": "continuous", "colormap_name": "viridis"})
    with pytest.raises(ValueError):
        build_viz_params({"mode": "continuous", "rescale": [0, 1]})


def test_categorical_builds_discrete_colormap():
    cfg = {
        "mode": "categorical",
        "entries": [
            {"value": 1, "color": "#ff0000", "label": "crop"},
            {"value": 2, "color": "#00ff00ff", "label": "non-crop"},
        ],
    }
    p = build_viz_params(cfg)
    cmap = json.loads(p["extra_params"]["colormap"])
    assert cmap["1"] == [255, 0, 0, 255]
    assert cmap["2"] == [0, 255, 0, 255]


def test_categorical_requires_entries():
    with pytest.raises(ValueError):
        build_viz_params({"mode": "categorical", "entries": []})


def test_unknown_mode_raises():
    with pytest.raises(ValueError):
        build_viz_params({"mode": "bogus"})

"""An edit made on the map changes only the fields it names, on every STAC collection that
draws the visualization, and a new visualization starts from its base's parameters."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from src.imagery import service
from src.imagery.models import (
    CollectionVisualization,
    ImageryCollection,
    ImagerySource,
    Visualization,
)
from src.imagery.schemas import VisualizationEdit, VisualizationFromEdit
from src.imagery.visualization_edits import patched


def test_an_edit_replaces_what_it_names_and_clears_what_it_nulls():
    params = {"assets": ["B04"], "rescale": "0,3000", "colormap_name": "viridis", "nodata": 0}

    result = patched(params, {"rescale": "0,1500", "colormap_name": None})

    assert result["rescale"] == "0,1500"
    assert "colormap_name" not in result
    assert result["assets"] == ["B04"]
    assert result["nodata"] == 0


def test_an_edit_that_leaves_nothing_to_draw_is_refused():
    with pytest.raises(ValueError):
        patched({"assets": ["B04"]}, {"assets": []})


def _campaign():
    source = ImagerySource(id=1, name="S2")
    true_color = Visualization(id=10, name="True Color", display_order=0)
    source.visualizations = [true_color]
    stac = ImageryCollection(
        id=100, name="Jan", catalog_url="https://stac.test", stac_collection_id="s2"
    )
    stac.visualizations = [
        CollectionVisualization(
            visualization_id=10,
            params={"assets": ["B04", "B03", "B02"], "rescale": "0,3000", "compositing": "median"},
            cover_params={"assets": ["visual"], "rescale": "0,255"},
        )
    ]
    manual = ImageryCollection(id=101, name="Drone")
    manual.visualizations = []
    source.collections = [stac, manual]
    for viz in source.visualizations:
        viz.source = source
    return SimpleNamespace(id=7, imagery_sources=[source]), stac


def test_saving_an_edit_applies_it_over_each_collections_own_params_and_cover():
    campaign, stac = _campaign()

    service.edit_visualization(
        MagicMock(), campaign, 10, VisualizationEdit.model_validate({"patch": {"rescale": "0,1"}})
    )

    row = stac.visualizations[0]
    assert row.params["rescale"] == "0,1"
    assert row.params["compositing"] == "median"
    assert row.cover_params == {"assets": ["visual"], "asset_as_band": False, "rescale": "0,1"}


def test_a_new_visualization_is_its_base_with_the_edit_applied():
    campaign, stac = _campaign()
    payload = VisualizationFromEdit.model_validate(
        {
            "name": "Bright",
            "base_visualization_id": 10,
            "patch": {"color_formula": "gamma RGB 1.5"},
        }
    )

    viz = service.create_visualization_from_edit(MagicMock(), campaign, 1, payload)

    assert viz.name == "Bright" and viz.display_order == 1
    added = stac.visualizations[1]
    assert added.params["color_formula"] == "gamma RGB 1.5"
    assert added.params["assets"] == ["B04", "B03", "B02"]
    assert added.cover_params["assets"] == ["visual"]


def test_a_new_visualization_cannot_take_a_name_the_source_already_uses():
    campaign, _ = _campaign()
    payload = VisualizationFromEdit.model_validate(
        {"name": "True Color", "base_visualization_id": 10, "patch": {}}
    )

    with pytest.raises(HTTPException) as err:
        service.create_visualization_from_edit(MagicMock(), campaign, 1, payload)
    assert err.value.status_code == 409

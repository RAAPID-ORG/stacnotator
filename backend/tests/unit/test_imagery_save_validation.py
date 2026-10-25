"""What the imagery editor may not save: bandless visualizations, bad slices, bad URLs."""

import pytest
from pydantic import ValidationError

from src.custom_layers.schemas import VectorLayerCreate
from src.imagery.schemas import BasemapCreate, ImagerySliceCreate, ImagerySourceCreate


def stac_source(params: dict) -> dict:
    return {
        "name": "S2",
        "visualizations": [{"name": "Viz 3"}],
        "collections": [
            {
                "name": "2024",
                "slices": [],
                "search": {"catalog_url": "https://stac.example", "stac_collection_id": "c"},
                "visualizations": [{"visualization": "Viz 3", "params": params}],
            }
        ],
    }


def test_a_visualization_without_bands_is_rejected_and_named():
    with pytest.raises(ValidationError, match="Viz 3.*2024.*S2"):
        ImagerySourceCreate.model_validate(stac_source({}))


def test_assets_or_an_expression_count_as_bands():
    ImagerySourceCreate.model_validate(stac_source({"assets": ["B04"]}))
    ImagerySourceCreate.model_validate(stac_source({"expression": "B08/B04"}))


@pytest.mark.parametrize(
    "slice_",
    [
        {"name": "", "start_date": "2024-01-01", "end_date": "2024-01-31"},
        {"name": " ", "start_date": "2024-01-01", "end_date": "2024-01-31"},
        {"name": "w", "start_date": "2024-02-01", "end_date": "2024-01-31"},
        {"name": "w", "start_date": "2024-02-30", "end_date": "2024-03-01"},
        {"name": "w", "start_date": "24-1-1", "end_date": "2024-03-01"},
    ],
)
def test_a_slice_needs_a_name_and_real_ordered_dates(slice_):
    with pytest.raises(ValidationError):
        ImagerySliceCreate.model_validate(slice_)


def test_a_one_day_slice_is_fine():
    ImagerySliceCreate(name="d", start_date="2024-01-01", end_date="2024-01-01")


@pytest.mark.parametrize("url", ["not a url at all", "ftp://nope", "", "https://"])
def test_layer_urls_must_be_http(url):
    with pytest.raises(ValidationError):
        BasemapCreate(name="b", url=url)
    with pytest.raises(ValidationError):
        VectorLayerCreate(name="v", pmtiles_url=url)


def test_a_tile_template_with_placeholders_passes():
    BasemapCreate(name="b", url="https://{a-c}.tile.example.org/{z}/{x}/{y}.png")
    BasemapCreate(name="b", url="http://ecn.t3.tiles.virtualearth.net/tiles/a{q}.jpeg?g=1")

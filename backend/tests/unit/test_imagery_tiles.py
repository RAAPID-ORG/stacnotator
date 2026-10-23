"""A slice's tiles are derived from its mosaics and the visualizations' parameters, so a
parameter edit shows on the next read without registering anything again."""

import pytest

from src.config import TilerCfg
from src.imagery import tiles
from src.imagery.models import (
    CollectionVisualization,
    ImageryCollection,
    ImagerySlice,
    SliceMosaic,
    SliceTemplate,
)
from src.tilers import providers
from src.tilers.registry import MPC_STAC_URL


@pytest.fixture(autouse=True)
def hosted_tiler(monkeypatch):
    tiler = TilerCfg(url="https://tiler.test", allows_ingest=True)
    monkeypatch.setattr(
        providers,
        "resolve_tiler",
        lambda name: tiler if name == "hosted-a" else (_ for _ in ()).throw(ValueError(name)),
    )


def _collection(**overrides) -> ImageryCollection:
    cover = ImagerySlice(id=1, start_date="2024-01-01", end_date="2024-01-31")
    week = ImagerySlice(id=2, start_date="2024-01-01", end_date="2024-01-07")
    for sl in (cover, week):
        sl.mosaics = [
            SliceMosaic(provider="mpc", mosaic_id=f"mpc-{sl.id}"),
            SliceMosaic(provider="hosted-a", mosaic_id=f"pg-{sl.id}"),
        ]
    fields = {
        "catalog_url": MPC_STAC_URL,
        "stac_collection_id": "sentinel-2-l2a",
        "tiler": "hosted-a",
        "has_dedicated_cover": True,
        "cover_slice_index": 0,
        "visualizations": [
            CollectionVisualization(
                visualization_id=5, params={"assets": ["B04"]}, cover_params={"assets": ["visual"]}
            ),
            CollectionVisualization(
                visualization_id=6, params={"assets": ["B08"], "compositing": "median"}
            ),
        ],
        "slices": [cover, week],
    }
    return ImageryCollection(**(fields | overrides))


def test_each_rendering_is_drawn_from_the_mosaic_of_the_provider_it_routes_to():
    collection = _collection()
    cover, week = collection.slices

    by_rendering = {t.visualization_id: t for t in tiles.slice_tiles(collection, week)}
    assert by_rendering[5].tiler == "mpc"
    assert "/mosaic/mpc-2/" in by_rendering[5].url
    assert "collection=sentinel-2-l2a" in by_rendering[5].url
    assert by_rendering[6].tiler == "hosted-a"
    assert by_rendering[6].url.startswith("https://tiler.test/searches/pg-2/")
    assert "compositing=median" in by_rendering[6].url

    cover_rgb = next(t for t in tiles.slice_tiles(collection, cover) if t.visualization_id == 5)
    assert "assets=visual" in cover_rgb.url


def test_a_parameter_edit_changes_the_url_and_needs_no_new_mosaic():
    collection = _collection()
    week = collection.slices[1]
    collection.visualizations[0].params = {"assets": ["B03"]}

    assert "assets=B03" in tiles.slice_tiles(collection, week)[0].url
    assert tiles.missing_providers(collection, week) == set()


def test_a_rendering_without_its_mosaic_or_tiler_is_left_out_until_registered():
    collection = _collection(tiler="gone")
    week = collection.slices[1]
    assert [t.visualization_id for t in tiles.slice_tiles(collection, week)] == [5]
    assert tiles.missing_providers(collection, week) == {"gone"}

    week.mosaics = []
    assert tiles.slice_tiles(collection, week) == []
    assert tiles.missing_providers(collection, week) == {"mpc", "gone"}


def test_a_manual_slice_is_drawn_from_its_templates_and_needs_no_mosaic():
    sl = ImagerySlice(templates=[SliceTemplate(visualization_id=5, url="https://x/{z}/{x}/{y}")])
    collection = ImageryCollection(slices=[sl])

    assert [(t.visualization_id, t.url, t.tiler) for t in tiles.slice_tiles(collection, sl)] == [
        (5, "https://x/{z}/{x}/{y}", None)
    ]
    assert tiles.missing_providers(collection, sl) == set()

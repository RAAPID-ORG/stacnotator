"""Tests for the registration work orders and spawn_background_registration's
wiring into the background-run protocol (src/background.py, covered in
test_background_runs.py).
"""

from unittest.mock import MagicMock

import pytest

from src.imagery import registration
from src.imagery.models import (
    CollectionStacConfig,
    CollectionVizConfig,
    ImageryCollection,
    ImagerySlice,
    ImagerySource,
    SliceTileUrl,
    VisualizationTemplate,
)
from src.imagery.registration import StacRegistrationSpec
from src.imagery.schemas import CollectionStacConfigCreate
from src.layers import LayerOwner
from src.tilers.registry import MPC_STAC_URL


@pytest.fixture()
def spawn(monkeypatch):
    spawn = MagicMock()
    monkeypatch.setattr(registration.background, "spawn_status_run", spawn)
    return spawn


def _make_spec(collection_id: int = 7) -> StacRegistrationSpec:
    return StacRegistrationSpec(
        collection_id=collection_id,
        collection_name="Sentinel-2",
        stac_config=CollectionStacConfigCreate(),
        has_dedicated_cover=True,
        cover_slice_index=0,
        source_viz_names=["true_color"],
    )


class TestStacRegistrationSpec:
    def test_is_frozen(self):
        spec = _make_spec()
        with pytest.raises(AttributeError):
            spec.collection_id = 99


class TestSpawnBackgroundRegistration:
    def test_spawns_the_registration_status_run(self, spawn):
        registration.spawn_background_registration(
            LayerOwner(campaign_id=1),
            [_make_spec()],
            bbox=[0, 0, 1, 1],
        )

        spawn.assert_called_once()
        args, kwargs = spawn.call_args
        assert args == (1, registration.REGISTRATION_RUN)
        assert kwargs["name"] == "imagery registration"

    def test_work_passes_specs_straight_through_without_db_lookup(self, spawn, monkeypatch):
        register = MagicMock(return_value=[])
        monkeypatch.setattr(registration, "_register_all_stac_browser_collections", register)

        specs = [_make_spec()]
        registration.spawn_background_registration(
            LayerOwner(campaign_id=1), specs, bbox=[0, 0, 1, 1]
        )
        db = MagicMock()
        assert spawn.call_args.kwargs["work"](db) == []

        register.assert_called_once_with(db, specs, [0, 0, 1, 1], "1")
        db.get.assert_not_called()

    def test_sanitizer_prefixes_the_domain(self, spawn):
        registration.spawn_background_registration(
            LayerOwner(campaign_id=1),
            [_make_spec()],
            bbox=[0, 0, 1, 1],
        )

        sanitized = spawn.call_args.kwargs["sanitize_error"](ValueError("Unknown tiler 'bogus'"))
        assert sanitized == "Imagery registration: Unknown tiler 'bogus'"


@pytest.mark.parametrize("hosted_fails", [False, True])
def test_roi_reregistration_rebuilds_saved_slices_without_holding_a_transaction(
    monkeypatch, hosted_fails
):
    from src.config import TilerCfg

    collection = ImageryCollection(
        id=7,
        name="January",
        has_dedicated_cover=True,
        cover_slice_index=0,
        stac_config=CollectionStacConfig(
            catalog_url=MPC_STAC_URL,
            stac_collection_id="sentinel-2-l2a",
            tile_provider="test-tiler",
            search_query={"collections": ["sentinel-2-l2a"], "limit": 10},
            cover_search_query={"collections": ["sentinel-2-l2a"], "limit": 20},
            internal_storage=True,
        ),
        viz_configs=[
            CollectionVizConfig(
                name="RGB",
                render_params={"assets": ["B04", "B03", "B02"]},
                cover_render_params={"assets": ["visual"]},
            ),
            CollectionVizConfig(
                name="Median",
                render_params={"assets": ["B04"], "compositing": "median"},
            ),
        ],
        slices=[
            ImagerySlice(
                id=11,
                name="Cover",
                start_date="2024-01-01",
                end_date="2024-01-31",
                display_order=0,
                tile_urls=[
                    SliceTileUrl(visualization_name="RGB", tile_url="https://old.test/tiles")
                ],
            ),
            # No existing URLs: a failed slice must be retried for the new ROI too.
            ImagerySlice(
                id=12,
                name="Week",
                start_date="2024-01-01",
                end_date="2024-01-07",
                display_order=1,
            ),
        ],
    )
    manual_url = SliceTileUrl(visualization_name="RGB", tile_url="https://manual.test/tiles")
    source = ImagerySource(
        campaign_id=1,
        visualizations=[VisualizationTemplate(name="RGB"), VisualizationTemplate(name="Median")],
        collections=[
            collection,
            ImageryCollection(slices=[ImagerySlice(tile_urls=[manual_url])]),
        ],
    )
    specs = registration.prepare_reregistration([source])
    assert collection.slices[0].tile_urls == []
    assert source.collections[1].slices[0].tile_urls == [manual_url]
    assert len(specs) == 1
    db = MagicMock()

    # Emulate the request commit before the worker uses a separate session.
    db.reset_mock()
    db.execute.return_value.scalars.return_value.all.return_value = collection.slices
    bbox = [10, 20, 11, 21]
    tiler = TilerCfg(url="https://tiler.test", allows_ingest=True)
    monkeypatch.setattr(registration.providers, "resolve_tiler", lambda name: tiler)
    monkeypatch.setattr(registration.time, "sleep", lambda seconds: None)

    def post(url, *, json, timeout):
        db.commit.assert_called_once()
        assert json["bbox"] == bbox
        assert json["datetime"].startswith("2024-01-01T00:00:00Z/")
        response = MagicMock()
        response.json.return_value = {"searchid": f"mpc-{json['limit']}"}
        return response

    monkeypatch.setattr(registration.httpx, "post", post)

    def ingest(tiler, catalog, collection_id, new_bbox, *args, **kwargs):
        db.commit.assert_called_once()
        assert new_bbox == bbox
        if hosted_fails:
            raise ValueError("Catalog unavailable")

    monkeypatch.setattr(registration.providers, "ingest_on_tiler", ingest)

    def register(tiler, body, scope, **kwargs):
        assert scope == "1"
        assert body["bbox"] == bbox
        assert kwargs["internal_storage"] is True
        return f"hosted-{body['limit']}"

    monkeypatch.setattr(registration.providers, "register_on_tiler", register)
    errors = registration._register_all_stac_browser_collections(db, specs, bbox, "1")
    urls = {
        (c.args[0].slice_id, c.args[0].visualization_name): c.args[0] for c in db.add.call_args_list
    }
    assert urls[11, "RGB"].mosaic_id == "mpc-20"
    assert "assets=visual" in urls[11, "RGB"].tile_url
    assert urls[12, "RGB"].mosaic_id == "mpc-10"
    assert "assets=B04" in urls[12, "RGB"].tile_url
    if hosted_fails:
        assert len(errors) == 2
        assert all(e["error"] == "Catalog unavailable" for e in errors)
        assert all(name == "RGB" for _, name in urls)
    else:
        assert errors == []
        assert urls[11, "Median"].mosaic_id == "hosted-20"
        assert urls[12, "Median"].mosaic_id == "hosted-10"
        assert "compositing=median" in urls[12, "Median"].tile_url

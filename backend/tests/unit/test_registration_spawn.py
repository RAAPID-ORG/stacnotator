"""Registration registers what is missing: the mosaics a source's STAC slices need on
the providers their visualizations route to, and nothing a slice already has. The run's
wiring into the background-run protocol is covered in test_background_runs.py."""

from unittest.mock import MagicMock

import pytest

from src.config import TilerCfg
from src.imagery import registration
from src.imagery.models import (
    CollectionVisualization,
    ImageryCollection,
    ImagerySlice,
    ImagerySource,
    SliceMosaic,
    SliceTemplate,
    Visualization,
)
from src.layers import LayerOwner
from src.tilers.registry import MPC_STAC_URL


@pytest.fixture()
def spawn(monkeypatch):
    spawn = MagicMock()
    monkeypatch.setattr(registration.background, "spawn_status_run", spawn)
    return spawn


def test_spawns_the_owners_status_run_and_prefixes_its_errors(spawn):
    registration.spawn_background_registration(LayerOwner(campaign_id=1), [0, 0, 1, 1])

    args, kwargs = spawn.call_args
    assert args == (1, registration.REGISTRATION_RUN)
    sanitized = kwargs["sanitize_error"](ValueError("Unknown tiler 'bogus'"))
    assert sanitized == "Imagery registration: Unknown tiler 'bogus'"


def _source() -> ImagerySource:
    rgb, median = Visualization(id=1, name="RGB"), Visualization(id=2, name="Median")
    stac = ImageryCollection(
        name="January",
        has_dedicated_cover=True,
        cover_slice_index=0,
        catalog_url=MPC_STAC_URL,
        stac_collection_id="sentinel-2-l2a",
        tiler="test-tiler",
        search_query={"collections": ["sentinel-2-l2a"], "limit": 10},
        cover_search_query={"collections": ["sentinel-2-l2a"], "limit": 20},
        internal_storage=True,
        visualizations=[
            CollectionVisualization(
                visualization_id=1,
                params={"assets": ["B04", "B03", "B02"]},
                cover_params={"assets": ["visual"]},
            ),
            CollectionVisualization(
                visualization_id=2, params={"assets": ["B04"], "compositing": "median"}
            ),
        ],
        slices=[
            ImagerySlice(id=11, name="Cover", start_date="2024-01-01", end_date="2024-01-31"),
            ImagerySlice(id=12, name="Week", start_date="2024-01-01", end_date="2024-01-07"),
        ],
    )
    manual = ImageryCollection(
        name="Manual",
        slices=[
            ImagerySlice(
                id=13,
                start_date="2024-01-01",
                end_date="2024-01-31",
                templates=[
                    SliceTemplate(visualization_id=1, url="https://manual.test/{z}/{x}/{y}")
                ],
            )
        ],
    )
    return ImagerySource(
        id=4, campaign_id=1, visualizations=[rgb, median], collections=[stac, manual]
    )


def test_every_stac_slice_needs_a_mosaic_per_provider_its_renderings_route_to():
    orders = registration.missing_mosaics([_source()])

    assert {(o.slice_id, o.provider) for o in orders} == {
        (11, "mpc"),
        (11, "test-tiler"),
        (12, "mpc"),
        (12, "test-tiler"),
    }
    queries = {o.slice_id: o.search_query["limit"] for o in orders}
    assert queries == {11: 20, 12: 10}


def test_a_slice_with_its_mosaics_needs_nothing_and_a_moved_area_drops_them():
    source = _source()
    for sl in source.collections[0].slices:
        sl.mosaics = [
            SliceMosaic(provider="mpc", mosaic_id="m"),
            SliceMosaic(provider="test-tiler", mosaic_id="h"),
        ]
    assert registration.missing_mosaics([source]) == []

    registration.drop_mosaics([source])
    assert len(registration.missing_mosaics([source])) == 4
    assert source.collections[1].slices[0].templates


@pytest.mark.parametrize("hosted_fails", [False, True])
def test_registers_the_missing_mosaics_without_holding_a_transaction(monkeypatch, hosted_fails):
    source = _source()
    db = MagicMock()
    db.scalars.return_value = [11, 12]
    monkeypatch.setattr(registration, "_owner_sources", lambda db, owner: [source])
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

    def ingest(tiler, catalog, collection_id, new_bbox, *args, **kwargs):
        db.commit.assert_called_once()
        assert new_bbox == bbox
        if hosted_fails:
            raise ValueError("Catalog unavailable")

    def register(tiler, body, owner, layer, **kwargs):
        assert (owner, layer) == ("1", "source:4")
        assert kwargs["internal_storage"] is True
        return f"hosted-{body['limit']}"

    monkeypatch.setattr(registration.httpx, "post", post)
    monkeypatch.setattr(registration.providers, "ingest_on_tiler", ingest)
    monkeypatch.setattr(registration.providers, "register_on_tiler", register)

    errors = registration.register_missing(db, LayerOwner(campaign_id=1), bbox)

    stored = {(m.slice_id, m.provider): m.mosaic_id for (m,), _ in db.merge.call_args_list}
    expected = {(11, "mpc"): "mpc-20", (12, "mpc"): "mpc-10"}
    if hosted_fails:
        assert [e["error"] for e in errors] == ["Catalog unavailable"] * 2
    else:
        assert errors == []
        expected |= {(11, "test-tiler"): "hosted-20", (12, "test-tiler"): "hosted-10"}
    assert stored == expected

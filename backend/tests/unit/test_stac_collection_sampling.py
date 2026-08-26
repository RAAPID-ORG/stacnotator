"""Listing a catalog must not wait out the collections that declare no assets."""

import time
from unittest.mock import patch

from src.stac_browser import client as stac_client


def _pending(count: int) -> list[tuple[dict, object]]:
    return [({"id": f"c{i}", "item_assets": {}}, object()) for i in range(count)]


def test_a_declared_free_collection_gets_its_sampled_assets():
    pending = _pending(1)
    with patch.object(stac_client, "_sample_item_assets", return_value={"data": {"title": "data"}}):
        stac_client._fill_sampled_assets(pending)
    assert pending[0][0]["item_assets"] == {"data": {"title": "data"}}


def test_samples_run_together_rather_than_one_after_another():
    """Sequentially these would take 4x as long; that is what made listing MPC,
    where a dozen datacube collections each cost seconds, look like a hang."""
    pending = _pending(4)

    def slow(_col):
        time.sleep(0.3)
        return {"data": {}}

    with patch.object(stac_client, "_sample_item_assets", slow):
        started = time.monotonic()
        stac_client._fill_sampled_assets(pending)
        elapsed = time.monotonic() - started

    assert elapsed < 0.9
    assert all(out["item_assets"] for out, _ in pending)


def test_a_slow_collection_is_listed_without_assets_instead_of_holding_the_catalog():
    pending = _pending(2)

    def never(_col):
        time.sleep(30)
        return {"data": {}}

    with (
        patch.object(stac_client, "_sample_item_assets", never),
        patch.object(stac_client, "SAMPLE_PHASE_BUDGET", 0.2),
    ):
        started = time.monotonic()
        stac_client._fill_sampled_assets(pending)
        elapsed = time.monotonic() - started

    # The budget is the whole wait: leaving the pool must not join the stragglers.
    assert elapsed < 2.0
    assert all(out["item_assets"] == {} for out, _ in pending)


def test_nothing_to_sample_costs_nothing():
    stac_client._fill_sampled_assets([])

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from src.config import TilerCfg
from src.custom_layers import render, service
from src.custom_layers.models import CustomMap
from src.custom_layers.schemas import CustomMapCreate, CustomMapUpdate

CONT = {"mode": "continuous", "colormap_name": "viridis", "rescale": [0, 1]}


def _cm(**kw):
    defaults = dict(
        id=1,
        campaign_id=5,
        name="m",
        cog_url="https://x/y.tif",
        render_config=CONT,
        status="registering",
    )
    return CustomMap(**{**defaults, **kw})


@pytest.fixture
def tilers(monkeypatch):
    settings = SimpleNamespace(
        DEFAULT_TILER="hosted", TILERS={"hosted": TilerCfg(url="https://tiler.test")}
    )
    monkeypatch.setattr(service, "get_settings", lambda: settings)
    monkeypatch.setattr(render, "get_settings", lambda: settings)
    monkeypatch.setattr(service, "resolve_tiler", lambda name: settings.TILERS[name])


def test_run_registration_records_the_search_and_its_tiler(monkeypatch, tilers):
    cm = _cm()
    monkeypatch.setattr(service, "register_cog_on_tiler", lambda *a, **k: "search-9")

    service.run_registration(MagicMock(), cm)

    assert (cm.status, cm.mosaic_id, cm.tiler) == ("ready", "search-9", "hosted")
    assert cm.tile_url.startswith("https://tiler.test/searches/search-9/tiles/")
    assert cm.status_errors is None


def test_run_registration_marks_failed_on_error(monkeypatch):
    cm = _cm()
    monkeypatch.setattr(service, "resolve_tiler", lambda *a, **k: object())

    def boom(*a, **k):
        raise RuntimeError("tiler down")

    monkeypatch.setattr(service, "register_cog_on_tiler", boom)
    service.run_registration(MagicMock(), cm)

    assert cm.status == "failed"
    assert "tiler down" in str(cm.status_errors)


def test_update_reregisters_when_cog_url_changes(monkeypatch):
    cm = _cm(status="ready", cog_url="https://old/a.tif")
    monkeypatch.setattr(service, "_get_custom_map", lambda *a, **k: cm)
    spawned = []
    monkeypatch.setattr(service, "spawn_registration", lambda map_id: spawned.append(map_id))

    service.update_custom_map(MagicMock(), 5, 1, CustomMapUpdate(cog_url="https://new/b.tif"))

    assert cm.cog_url == "https://new/b.tif"
    assert cm.status == "registering"
    assert spawned == [cm.id]


def test_update_name_only_does_not_reregister(monkeypatch):
    cm = _cm(status="ready")
    monkeypatch.setattr(service, "_get_custom_map", lambda *a, **k: cm)
    monkeypatch.setattr(service, "_name_taken", lambda *a, **k: False)
    spawned = []
    monkeypatch.setattr(service, "spawn_registration", lambda map_id: spawned.append(map_id))

    service.update_custom_map(MagicMock(), 5, 1, CustomMapUpdate(name="renamed"))

    assert cm.name == "renamed"
    assert cm.status == "ready"
    assert spawned == []


def test_a_colour_edit_shows_in_the_tile_url_without_registering(monkeypatch, tilers):
    cm = _cm(status="ready", mosaic_id="search-9", tiler="hosted")
    monkeypatch.setattr(service, "_get_custom_map", lambda *a, **k: cm)
    spawned = []
    monkeypatch.setattr(service, "spawn_registration", lambda map_id: spawned.append(map_id))

    service.update_custom_map(
        MagicMock(),
        5,
        1,
        CustomMapUpdate(
            render_config={"mode": "continuous", "colormap_name": "magma", "rescale": [0, 2]}
        ),
    )

    assert spawned == []
    assert cm.status == "ready"
    assert "search-9" in cm.tile_url and "colormap_name=magma" in cm.tile_url


def test_a_map_on_a_tiler_no_longer_configured_has_no_tile_url(tilers):
    assert _cm(status="ready", mosaic_id="search-9", tiler="gone").tile_url is None


def test_update_of_failed_map_retries_registration(monkeypatch):
    cm = _cm(status="failed", status_errors=[{"error": "tiler down"}])
    monkeypatch.setattr(service, "_get_custom_map", lambda *a, **k: cm)
    monkeypatch.setattr(service, "_name_taken", lambda *a, **k: False)
    spawned = []
    monkeypatch.setattr(service, "spawn_registration", lambda map_id: spawned.append(map_id))

    service.update_custom_map(MagicMock(), 5, 1, CustomMapUpdate(name="renamed"))

    assert cm.status == "registering"
    assert cm.status_errors is None
    assert spawned == [cm.id]


def test_create_with_taken_name_raises(monkeypatch):
    monkeypatch.setattr(service, "_name_taken", lambda *a, **k: True)

    with pytest.raises(service.DuplicateCustomMapName):
        service.create_custom_map(
            MagicMock(),
            5,
            CustomMapCreate(name="m", cog_url="https://x/y.tif", render_config=CONT),
        )


def test_rename_to_taken_name_raises(monkeypatch):
    cm = _cm(status="ready")
    monkeypatch.setattr(service, "_get_custom_map", lambda *a, **k: cm)
    monkeypatch.setattr(service, "_name_taken", lambda *a, **k: True)

    with pytest.raises(service.DuplicateCustomMapName):
        service.update_custom_map(MagicMock(), 5, 1, CustomMapUpdate(name="other"))

    assert cm.name == "m"

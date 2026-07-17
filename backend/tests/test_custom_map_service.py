from unittest.mock import MagicMock

import pytest

from src.custom_maps import service
from src.custom_maps.models import CustomMap
from src.custom_maps.schemas import CustomMapCreate, CustomMapUpdate

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


def test_run_registration_bakes_tile_url(monkeypatch):
    cm = _cm()
    monkeypatch.setattr(service, "register_cog_on_tiler", lambda *a, **k: "search-9")
    monkeypatch.setattr(service, "resolve_tiler", lambda *a, **k: object())
    monkeypatch.setattr(
        service,
        "build_tile_url",
        lambda *a, **k: (
            "https://tiler.test/searches/search-9/tiles/WebMercatorQuad/{z}/{x}/{y}.png?assets=data"
        ),
    )

    service.run_registration(MagicMock(), cm)

    assert cm.status == "ready"
    assert cm.mosaic_id == "search-9"
    assert "search-9" in cm.tile_url
    assert cm.status_error is None


def test_run_registration_marks_failed_on_error(monkeypatch):
    cm = _cm()
    monkeypatch.setattr(service, "resolve_tiler", lambda *a, **k: object())

    def boom(*a, **k):
        raise RuntimeError("tiler down")

    monkeypatch.setattr(service, "register_cog_on_tiler", boom)
    service.run_registration(MagicMock(), cm)

    assert cm.status == "failed"
    assert "tiler down" in str(cm.status_error)


def test_update_reregisters_when_cog_url_changes(monkeypatch):
    cm = _cm(status="ready", cog_url="https://old/a.tif")
    monkeypatch.setattr(service, "_get", lambda *a, **k: cm)
    spawned = []
    monkeypatch.setattr(service, "_spawn_registration", lambda map_id: spawned.append(map_id))

    service.update_custom_map(MagicMock(), 5, 1, CustomMapUpdate(cog_url="https://new/b.tif"))

    assert cm.cog_url == "https://new/b.tif"
    assert cm.status == "registering"
    assert spawned == [cm.id]


def test_update_name_only_does_not_reregister(monkeypatch):
    cm = _cm(status="ready")
    monkeypatch.setattr(service, "_get", lambda *a, **k: cm)
    monkeypatch.setattr(service, "_name_taken", lambda *a, **k: False)
    spawned = []
    monkeypatch.setattr(service, "_spawn_registration", lambda map_id: spawned.append(map_id))

    service.update_custom_map(MagicMock(), 5, 1, CustomMapUpdate(name="renamed"))

    assert cm.name == "renamed"
    assert cm.status == "ready"
    assert spawned == []


def test_update_render_config_restamps_tile_url_without_reregister(monkeypatch):
    """A colour edit is URL-side only: no tiler round trip, and the map stays usable."""
    cm = _cm(status="ready", mosaic_id="search-9", tile_url="https://tiler.test/old?x=1")
    monkeypatch.setattr(service, "_get", lambda *a, **k: cm)
    monkeypatch.setattr(service, "resolve_tiler", lambda *a, **k: object())
    spawned = []
    monkeypatch.setattr(service, "_spawn_registration", lambda map_id: spawned.append(map_id))
    seen = {}

    def fake_build(provider, ref, viz_params, **kw):
        seen["ref"] = ref
        return (
            f"https://tiler.test/searches/{ref}/x.png?colormap_name={viz_params['colormap_name']}"
        )

    monkeypatch.setattr(service, "build_tile_url", fake_build)

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
    assert seen["ref"] == "search-9"
    assert "colormap_name=magma" in cm.tile_url


def test_update_does_not_restamp_a_map_whose_search_is_stale(monkeypatch):
    """mosaic_id still points at the previous search while a re-registration is in flight,
    so a colour edit must leave the URL to that registration rather than stamp the old one."""
    cm = _cm(status="registering", mosaic_id="search-old", tile_url="https://tiler.test/old")
    monkeypatch.setattr(service, "_get", lambda *a, **k: cm)
    monkeypatch.setattr(service, "_spawn_registration", lambda map_id: None)
    monkeypatch.setattr(
        service, "build_tile_url", lambda *a, **k: pytest.fail("must not restamp a stale search")
    )

    service.update_custom_map(
        MagicMock(),
        5,
        1,
        CustomMapUpdate(
            render_config={"mode": "continuous", "colormap_name": "magma", "rescale": [0, 2]}
        ),
    )

    assert cm.render_config["colormap_name"] == "magma"
    assert cm.tile_url == "https://tiler.test/old"


def test_update_of_failed_map_retries_registration(monkeypatch):
    cm = _cm(status="failed", status_error={"error": "tiler down"})
    monkeypatch.setattr(service, "_get", lambda *a, **k: cm)
    monkeypatch.setattr(service, "_name_taken", lambda *a, **k: False)
    spawned = []
    monkeypatch.setattr(service, "_spawn_registration", lambda map_id: spawned.append(map_id))

    service.update_custom_map(MagicMock(), 5, 1, CustomMapUpdate(name="renamed"))

    assert cm.status == "registering"
    assert cm.status_error is None
    assert spawned == [cm.id]


def test_unrenderable_render_config_is_rejected_on_create_and_update(monkeypatch):
    """Which configs are unrenderable is build_viz_params' business (tested there); this is
    only that both write paths run it and surface the failure instead of storing the config."""
    monkeypatch.setattr(service, "_name_taken", lambda *a, **k: False)
    monkeypatch.setattr(service, "_get", lambda *a, **k: _cm(status="ready"))
    unrenderable = {"mode": "continuous", "rescale": [0, 1]}  # no colormap_name

    with pytest.raises(service.InvalidRenderConfig):
        service.create_custom_map(
            MagicMock(),
            5,
            CustomMapCreate(name="m", cog_url="https://x/y.tif", render_config=unrenderable),
        )

    with pytest.raises(service.InvalidRenderConfig):
        service.update_custom_map(MagicMock(), 5, 1, CustomMapUpdate(render_config=unrenderable))


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
    monkeypatch.setattr(service, "_get", lambda *a, **k: cm)
    monkeypatch.setattr(service, "_name_taken", lambda *a, **k: True)

    with pytest.raises(service.DuplicateCustomMapName):
        service.update_custom_map(MagicMock(), 5, 1, CustomMapUpdate(name="other"))

    assert cm.name == "m"

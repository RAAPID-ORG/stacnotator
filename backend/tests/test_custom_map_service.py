from unittest.mock import MagicMock

from src.custommaps import service
from src.custommaps.models import CustomMap
from src.custommaps.schemas import CustomMapUpdate

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
        lambda *a,
        **k: "https://tiler.test/searches/search-9/tiles/WebMercatorQuad/{z}/{x}/{y}.png?assets=data",
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
    spawned = []
    monkeypatch.setattr(service, "_spawn_registration", lambda map_id: spawned.append(map_id))

    service.update_custom_map(MagicMock(), 5, 1, CustomMapUpdate(name="renamed"))

    assert cm.name == "renamed"
    assert cm.status == "ready"
    assert spawned == []

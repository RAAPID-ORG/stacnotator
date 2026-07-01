from unittest.mock import MagicMock

from src.vector_layers import service
from src.vector_layers.models import VectorLayer
from src.vector_layers.schemas import VectorLayerUpdate


def _layer(**kw):
    defaults = dict(
        id=1,
        campaign_id=5,
        name="preds",
        pmtiles_url="https://x/y.pmtiles",
        source_layer=None,
        color="#3b82f6",
        display_order=0,
    )
    return VectorLayer(**{**defaults, **kw})


def test_update_applies_only_provided_fields(monkeypatch):
    layer = _layer()
    monkeypatch.setattr(service, "_get", lambda *a, **k: layer)

    service.update_vector_layer(
        MagicMock(), 5, 1, VectorLayerUpdate(name="renamed", color="#ff0000")
    )

    assert layer.name == "renamed"
    assert layer.color == "#ff0000"
    # untouched fields stay put
    assert layer.pmtiles_url == "https://x/y.pmtiles"
    assert layer.source_layer is None


def test_update_can_set_source_layer(monkeypatch):
    layer = _layer()
    monkeypatch.setattr(service, "_get", lambda *a, **k: layer)

    service.update_vector_layer(MagicMock(), 5, 1, VectorLayerUpdate(source_layer="parcels"))

    assert layer.source_layer == "parcels"


def test_update_returns_none_when_missing(monkeypatch):
    monkeypatch.setattr(service, "_get", lambda *a, **k: None)

    result = service.update_vector_layer(MagicMock(), 5, 99, VectorLayerUpdate(name="x"))

    assert result is None

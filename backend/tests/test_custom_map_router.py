from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from src.auth.dependencies import require_approved_user
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.custom_maps import router as cm_router
from src.custom_maps import service
from src.database import get_db
from src.main import app

CAMPAIGN_ID = 7
CONT = {"mode": "continuous", "colormap_name": "viridis", "rescale": [0, 1]}


def _map_obj(**kw):
    base = dict(
        id=1,
        campaign_id=CAMPAIGN_ID,
        name="m",
        cog_url="https://x/y.tif",
        render_config=CONT,
        max_native_zoom=None,
        status="registering",
        status_error=None,
        tile_url=None,
        mosaic_id=None,
        display_order=0,
        mlops_url=None,
    )
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.fixture()
def client():
    return TestClient(app)


def _override_auth():
    app.dependency_overrides[get_db] = lambda: MagicMock()
    app.dependency_overrides[require_approved_user] = lambda: SimpleNamespace(id="u1")
    app.dependency_overrides[require_campaign_access] = lambda: SimpleNamespace(id=CAMPAIGN_ID)
    app.dependency_overrides[require_campaign_admin] = lambda: SimpleNamespace(id=CAMPAIGN_ID)
    app.dependency_overrides[cm_router.bearer] = lambda: None


def teardown_function():
    app.dependency_overrides.clear()


def test_create_returns_201_and_serialized_body(client, monkeypatch):
    _override_auth()
    monkeypatch.setattr(service, "create_custom_map", lambda db, cid, payload: _map_obj())
    body = {
        "name": "cropland",
        "cog_url": "https://x/y.tif",
        "render_config": {"mode": "continuous", "colormap_name": "viridis", "rescale": [0, 1]},
    }
    r = client.post(f"/api/campaigns/{CAMPAIGN_ID}/custom-maps", json=body)
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "registering"
    assert r.json()["render_config"]["mode"] == "continuous"


def test_list_returns_maps(client, monkeypatch):
    _override_auth()
    monkeypatch.setattr(service, "list_custom_maps", lambda db, cid: [_map_obj(id=3)])
    r = client.get(f"/api/campaigns/{CAMPAIGN_ID}/custom-maps")
    assert r.status_code == 200
    assert [m["id"] for m in r.json()] == [3]


def test_delete_returns_204(client, monkeypatch):
    _override_auth()
    monkeypatch.setattr(service, "delete_custom_map", lambda db, cid, mid: True)
    r = client.delete(f"/api/campaigns/{CAMPAIGN_ID}/custom-maps/9")
    assert r.status_code == 204


def test_delete_missing_returns_404(client, monkeypatch):
    _override_auth()
    monkeypatch.setattr(service, "delete_custom_map", lambda db, cid, mid: False)
    r = client.delete(f"/api/campaigns/{CAMPAIGN_ID}/custom-maps/9")
    assert r.status_code == 404


def test_update_missing_returns_404(client, monkeypatch):
    _override_auth()
    monkeypatch.setattr(service, "update_custom_map", lambda db, cid, mid, payload: None)
    r = client.patch(f"/api/campaigns/{CAMPAIGN_ID}/custom-maps/9", json={"name": "x"})
    assert r.status_code == 404


def test_campaign_out_exposes_custom_maps_field():
    from src.campaigns.schemas import CampaignOut

    assert "custom_maps" in CampaignOut.model_fields

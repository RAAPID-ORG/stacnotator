from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from src.auth.dependencies import require_authenticated_user
from src.campaigns.dependencies import require_campaign_access, require_campaign_admin
from src.custom_layers import router as cm_router
from src.custom_layers import service
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
        internal_storage=False,
    )
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.fixture()
def client():
    return TestClient(app)


def _override_auth(allows_internal_storage: bool = False, allowed_tiler_names=("mpc", "azure")):
    campaign = SimpleNamespace(
        id=CAMPAIGN_ID,
        project=SimpleNamespace(
            organization=SimpleNamespace(
                allows_internal_storage=allows_internal_storage,
                allowed_tiler_names=list(allowed_tiler_names),
            )
        ),
    )
    app.dependency_overrides[get_db] = lambda: MagicMock()
    app.dependency_overrides[require_authenticated_user] = lambda: SimpleNamespace(id="u1")
    app.dependency_overrides[require_campaign_access] = lambda: campaign
    app.dependency_overrides[require_campaign_admin] = lambda: campaign
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


_INTERNAL_BODY = {
    "name": "preds",
    "cog_url": "https://acct.blob.core.windows.net/custom-maps/x.tif",
    "render_config": {"mode": "continuous", "colormap_name": "viridis", "rescale": [0, 1]},
    "internal_storage": True,
}


def test_internal_storage_rejected_for_org_without_permission(client, monkeypatch):
    _override_auth(allows_internal_storage=False)
    monkeypatch.setattr(service, "create_custom_map", lambda db, cid, payload: _map_obj())
    r = client.post(f"/api/campaigns/{CAMPAIGN_ID}/custom-maps", json=_INTERNAL_BODY)
    assert r.status_code == 403, r.text
    assert "internal" in r.json()["detail"]


def test_internal_storage_allowed_for_permitted_org(client, monkeypatch):
    _override_auth(allows_internal_storage=True)
    monkeypatch.setattr(
        service, "create_custom_map", lambda db, cid, payload: _map_obj(internal_storage=True)
    )
    r = client.post(f"/api/campaigns/{CAMPAIGN_ID}/custom-maps", json=_INTERNAL_BODY)
    assert r.status_code == 201, r.text
    assert r.json()["internal_storage"] is True


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


def test_create_duplicate_name_returns_409(client, monkeypatch):
    _override_auth()

    def duplicate(db, cid, payload):
        raise service.DuplicateCustomMapName()

    monkeypatch.setattr(service, "create_custom_map", duplicate)
    body = {
        "name": "cropland",
        "cog_url": "https://x/y.tif",
        "render_config": {"mode": "continuous", "colormap_name": "viridis", "rescale": [0, 1]},
    }
    r = client.post(f"/api/campaigns/{CAMPAIGN_ID}/custom-maps", json=body)
    assert r.status_code == 409


@pytest.fixture()
def hosted_tiler(monkeypatch):
    """A deployment whose default tiler is 'azure' - custom maps register there."""
    monkeypatch.setattr(cm_router, "get_settings", lambda: SimpleNamespace(DEFAULT_TILER="azure"))


_CREATE_BODY = {
    "name": "cropland",
    "cog_url": "https://x/y.tif",
    "render_config": CONT,
}


def test_create_allowed_when_org_may_use_the_default_tiler(client, monkeypatch, hosted_tiler):
    _override_auth(allowed_tiler_names=("mpc", "azure"))
    monkeypatch.setattr(service, "create_custom_map", lambda db, cid, payload: _map_obj())
    r = client.post(f"/api/campaigns/{CAMPAIGN_ID}/custom-maps", json=_CREATE_BODY)
    assert r.status_code == 201, r.text


def test_create_rejected_when_org_lacks_the_default_tiler(client, monkeypatch, hosted_tiler):
    _override_auth(allowed_tiler_names=("mpc",))
    called = []
    monkeypatch.setattr(
        service, "create_custom_map", lambda db, cid, payload: called.append(payload)
    )
    r = client.post(f"/api/campaigns/{CAMPAIGN_ID}/custom-maps", json=_CREATE_BODY)
    assert r.status_code == 403, r.text
    assert "azure" in r.json()["detail"]
    assert called == []  # rejected before anything is written or registered


def test_update_allowed_when_org_may_use_the_default_tiler(client, monkeypatch, hosted_tiler):
    _override_auth(allowed_tiler_names=("mpc", "azure"))
    monkeypatch.setattr(service, "update_custom_map", lambda db, cid, mid, payload: _map_obj())
    r = client.patch(f"/api/campaigns/{CAMPAIGN_ID}/custom-maps/1", json={"name": "renamed"})
    assert r.status_code == 200, r.text


def test_update_rejected_when_org_lacks_the_default_tiler(client, monkeypatch, hosted_tiler):
    _override_auth(allowed_tiler_names=("mpc",))
    called = []
    monkeypatch.setattr(
        service, "update_custom_map", lambda db, cid, mid, payload: called.append(payload)
    )
    r = client.patch(
        f"/api/campaigns/{CAMPAIGN_ID}/custom-maps/1", json={"cog_url": "https://x/new.tif"}
    )
    assert r.status_code == 403, r.text
    assert "azure" in r.json()["detail"]
    assert called == []


def test_rename_to_duplicate_returns_409(client, monkeypatch):
    _override_auth()

    def duplicate(db, cid, map_id, payload):
        raise service.DuplicateCustomMapName()

    monkeypatch.setattr(service, "update_custom_map", duplicate)
    r = client.patch(f"/api/campaigns/{CAMPAIGN_ID}/custom-maps/1", json={"name": "cropland"})
    assert r.status_code == 409

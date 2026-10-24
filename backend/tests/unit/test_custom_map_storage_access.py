import base64
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src import crypto, storage_access
from src.campaigns.duplication import unmet_org_requirements
from src.custom_layers import service
from src.custom_layers.models import CustomMap
from src.custom_layers.schemas import CustomMapCreate, CustomMapOut, CustomMapUpdate
from src.layers import LayerOwner
from src.visualizers import service as visualizers
from src.visualizers.schemas import VisualizerOverlayCreate

URL = "https://acct.blob.core.windows.net/maps/pred.tif"
SAS = "sv=2024-11-04&sr=c&sp=r&se=2099-01-01T00:00:00Z&spr=https&sig=SECRET"
ACCESS = {"kind": "azure_sas", "secret": SAS}
RENDER = {"mode": "continuous", "colormap_name": "viridis", "rescale": [0, 1]}
OWNER = LayerOwner(campaign_id=5)


@pytest.fixture(autouse=True)
def keys(monkeypatch):
    settings = SimpleNamespace(
        APIKEY_ENCRYPTION_SECRET=base64.b64encode(b"k" * 32).decode(),
        TILER_TOKEN_SECRET="t" * 40,
    )
    monkeypatch.setattr(crypto, "get_settings", lambda: settings)
    monkeypatch.setattr(storage_access, "get_settings", lambda: settings)


def _map(private=True):
    cm = CustomMap(
        id=1,
        campaign_id=5,
        name="m",
        cog_url=URL,
        render_config=RENDER,
        internal_storage=False,
        status="ready",
        display_order=0,
    )
    if private:
        storage_access.store(cm, storage_access.AzureSasAccess(**ACCESS))
    return cm


def _update(monkeypatch, cm, **payload):
    monkeypatch.setattr(service, "_get_custom_map", lambda *a: cm)
    monkeypatch.setattr(service, "_name_taken", lambda *a, **kw: False)
    spawned = []
    monkeypatch.setattr(service, "_spawn_registration", spawned.append)
    db = MagicMock()
    db.scalar.return_value = None
    service.update_custom_map(db, OWNER, cm.id, CustomMapUpdate(**payload))
    return spawned


def test_create_stores_encrypted_and_returns_only_kind_and_expiry(monkeypatch):
    monkeypatch.setattr(service, "_name_taken", lambda *a: False)
    monkeypatch.setattr(service, "_spawn_registration", lambda *a: None)
    cm = service.create_custom_map(
        MagicMock(),
        OWNER,
        CustomMapCreate(name="m", cog_url=URL, render_config=RENDER, storage_access=ACCESS),
    )
    assert storage_access.stored(cm).secret == SAS
    assert "SECRET" not in cm.encrypted_storage_secret
    cm.id, cm.display_order = 1, 0
    out = CustomMapOut.model_validate(cm).model_dump_json()
    assert "SECRET" not in out and "encrypted_storage_secret" not in out
    assert '"kind":"azure_sas"' in out
    assert cm.cog_url == URL


@pytest.mark.parametrize(
    "url", ["http://acct.blob.core.windows.net/m.tif", "https://example.com/m.tif"]
)
def test_access_requires_https_azure_storage(url):
    with pytest.raises(ValidationError):
        CustomMapCreate(name="m", cog_url=url, render_config=RENDER, storage_access=ACCESS)


def test_inline_token_and_conflicting_access_are_rejected():
    with pytest.raises(ValidationError, match="not in the COG URL"):
        CustomMapCreate(name="m", cog_url=f"{URL}?{SAS}", render_config=RENDER)
    with pytest.raises(ValidationError, match="not both"):
        CustomMapCreate(
            name="m",
            cog_url=URL,
            render_config=RENDER,
            storage_access=ACCESS,
            internal_storage=True,
        )


def test_unrelated_edits_keep_the_token_and_replacement_reregisters(monkeypatch):
    cm = _map()
    encrypted = cm.encrypted_storage_secret
    assert _update(monkeypatch, cm, name="renamed") == []
    assert cm.encrypted_storage_secret == encrypted
    assert _update(
        monkeypatch, cm, storage_access={**ACCESS, "secret": SAS.replace("SECRET", "NEW")}
    ) == [1]
    assert storage_access.stored(cm).secret.endswith("sig=NEW")
    assert cm.status == "registering"


def test_explicit_null_removes_access_and_reregisters(monkeypatch):
    cm = _map()
    assert _update(monkeypatch, cm, storage_access=None) == [1]
    assert storage_access.stored(cm) is None
    assert cm.storage_secret_expires_at is None


def test_changing_host_requires_new_access_or_explicit_removal(monkeypatch):
    cm = _map()
    with pytest.raises(HTTPException) as exc:
        _update(monkeypatch, cm, cog_url=URL.replace("acct.", "other."))
    assert "new SAS token" in exc.value.detail
    assert cm.cog_url == URL
    assert _update(
        monkeypatch, cm, cog_url=URL.replace("acct.", "other."), storage_access=ACCESS
    ) == [1]


def test_retained_access_cannot_be_combined_with_managed_identity(monkeypatch):
    with pytest.raises(HTTPException) as exc:
        _update(monkeypatch, _map(), internal_storage=True)
    assert exc.value.status_code == 400


def test_private_maps_cannot_be_created_for_or_added_to_visualizers(monkeypatch):
    with pytest.raises(HTTPException) as exc:
        service.create_custom_map(
            MagicMock(),
            LayerOwner(visualizer_id=3),
            CustomMapCreate(name="m", cog_url=URL, render_config=RENDER, storage_access=ACCESS),
        )
    assert exc.value.status_code == 400
    monkeypatch.setattr(visualizers, "_assert_in_project", lambda *a: None)
    db = MagicMock()
    db.scalars.side_effect = [[], [_map()]]
    with pytest.raises(HTTPException) as exc:
        visualizers._replace_layers(
            db, SimpleNamespace(project_id=1), [], [VisualizerOverlayCreate(custom_map_id=1)]
        )
    assert exc.value.status_code == 400


def test_a_map_already_linked_to_a_visualizer_cannot_gain_private_access(monkeypatch):
    cm = _map(private=False)
    monkeypatch.setattr(service, "_get_custom_map", lambda *a: cm)
    db = MagicMock()
    db.scalar.return_value = 9
    with pytest.raises(HTTPException):
        service.update_custom_map(db, OWNER, cm.id, CustomMapUpdate(storage_access=ACCESS))
    assert cm.storage_auth is None


def test_registration_hands_off_sealed_access_not_a_signed_url(monkeypatch):
    cm = _map()
    seen = {}
    monkeypatch.setattr(service, "resolve_tiler", lambda *a: object())
    monkeypatch.setattr(service, "build_tile_url", lambda *a, **kw: "https://tiler/tiles")

    def register(tiler, url, owner, layer, **kw):
        seen.update(url=url, owner=owner, layer=layer, **kw)
        return "search-1"

    monkeypatch.setattr(service, "register_cog_on_tiler", register)
    service.run_registration(MagicMock(), cm)
    assert (seen["url"], seen["owner"], seen["layer"]) == (URL, "5", "custom_map:1")
    assert seen["sealed_storage_access"]["host"] == "acct.blob.core.windows.net"
    assert "SECRET" not in str(seen)
    assert cm.status == "ready"


def test_stale_registration_cannot_overwrite_a_token_replacement(monkeypatch):
    cm = _map()
    monkeypatch.setattr(service, "resolve_tiler", lambda *a: object())

    def register(*a, **kw):
        cm.encrypted_storage_secret = "new-encrypted-secret"
        cm.status = "registering"
        return "old-search"

    monkeypatch.setattr(service, "register_cog_on_tiler", register)
    revoked = []
    monkeypatch.setattr(service, "revoke_on_tiler", lambda tiler, sid: revoked.append(sid))
    service.run_registration(MagicMock(), cm)
    assert cm.status == "registering"
    assert cm.mosaic_id is None
    assert revoked == ["old-search"]


def _registered(cm, search_id="sas-search"):
    cm.mosaic_id, cm.tile_url = search_id, f"https://tiler/searches/{search_id}/tiles"
    return cm


@pytest.fixture
def revoked(monkeypatch):
    calls = []
    monkeypatch.setattr(service, "resolve_tiler", lambda *a: object())
    monkeypatch.setattr(service, "revoke_on_tiler", lambda tiler, sid: calls.append(sid))
    return calls


@pytest.mark.parametrize(
    "payload",
    [
        {"storage_access": None},
        {"storage_access": {**ACCESS, "secret": SAS.replace("SECRET", "NEW")}},
        {"cog_url": URL.replace("pred", "other")},
    ],
)
def test_retiring_a_sas_revokes_its_tiler_search_first(monkeypatch, revoked, payload):
    cm = _registered(_map())
    assert _update(monkeypatch, cm, **payload) == [1]
    assert revoked == ["sas-search"]
    assert cm.mosaic_id is None and cm.tile_url is None


def test_render_edits_and_public_maps_revoke_nothing(monkeypatch, revoked):
    monkeypatch.setattr(service, "build_tile_url", lambda *a, **kw: "https://tiler/tiles")
    _update(monkeypatch, _registered(_map()), render_config={**RENDER, "colormap_name": "magma"})
    _update(monkeypatch, _registered(_map(private=False)), cog_url=URL.replace("pred", "other"))
    assert revoked == []


def test_a_failed_revocation_fails_the_edit(monkeypatch):
    monkeypatch.setattr(service, "resolve_tiler", lambda *a: object())

    def unreachable(*a):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(service, "revoke_on_tiler", unreachable)
    cm = _registered(_map())
    with pytest.raises(HTTPException) as exc:
        _update(monkeypatch, cm, storage_access=None)
    assert exc.value.status_code == 502


def test_deleting_a_private_map_revokes_its_search_unless_a_copy_still_uses_it(
    monkeypatch, revoked
):
    for shared, expected in ((None, ["sas-search"]), (True, [])):
        revoked.clear()
        cm = _registered(_map())
        monkeypatch.setattr(service, "_get_custom_map", lambda *a, cm=cm: cm)
        db = MagicMock()
        db.scalar.return_value = shared
        assert service.delete_custom_map(db, OWNER, cm.id)
        assert revoked == expected
        db.delete.assert_called_once_with(cm)


def test_registration_errors_do_not_persist_signed_urls(monkeypatch):
    cm = _map()
    monkeypatch.setattr(service, "resolve_tiler", lambda *a: object())

    def fail(*a, **kw):
        raise RuntimeError(f"Cannot read {URL}?{SAS}")

    monkeypatch.setattr(service, "register_cog_on_tiler", fail)
    service.run_registration(MagicMock(), cm)
    assert cm.status == "failed"
    assert "SECRET" not in str(cm.status_errors)


def test_private_map_access_blocks_copying_to_another_organization():
    db = MagicMock()
    db.scalars.side_effect = [[], []]
    db.scalar.side_effect = [False, True]
    campaign = SimpleNamespace(id=5, project=SimpleNamespace(organization_id=1))
    organization = SimpleNamespace(id=2, allows_internal_storage=True, allowed_tiler_names=[])
    assert unmet_org_requirements(db, campaign, organization) == ["a private storage SAS token"]

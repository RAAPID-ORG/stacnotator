"""Planet browsing endpoints via TestClient, with the Planet API and DB mocked out."""

import base64
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from src import crypto
from src.auth.dependencies import require_authenticated_user
from src.database import get_db
from src.main import app
from src.planet import client as planet_client
from src.planet import router as planet_router

PROJECT_ID = 3
KEY_ID = 11
_VALID_KEY = base64.b64encode(b"k" * 32).decode()

TILE_LINK = (
    "https://tiles.planet.com/basemaps/v1/planet-tiles/"
    "global_monthly_2024_01_mosaic/gmap/{z}/{x}/{y}.png?api_key=PLANET-SECRET"
)


@pytest.fixture()
def crypto_key(monkeypatch):
    monkeypatch.setattr(
        crypto, "get_settings", lambda: SimpleNamespace(APIKEY_ENCRYPTION_SECRET=_VALID_KEY)
    )


@pytest.fixture()
def client(crypto_key, monkeypatch):
    key = SimpleNamespace(id=KEY_ID, name="Planet", encrypted_key=crypto.encrypt("PLANET-SECRET"))
    project = SimpleNamespace(organization=SimpleNamespace(api_keys=[key]))
    monkeypatch.setattr(planet_router, "require_project_access", lambda **_: project)
    app.dependency_overrides[get_db] = lambda: MagicMock()
    app.dependency_overrides[require_authenticated_user] = lambda: SimpleNamespace(id="u1")
    app.dependency_overrides[planet_router.bearer] = lambda: None
    yield TestClient(app)
    app.dependency_overrides.clear()


def _org_key(key_id: int = KEY_ID) -> dict:
    return {"project_id": PROJECT_ID, "organization_api_key_id": key_id}


def _own_key(value: str = "MY-OWN-KEY") -> dict:
    return {"project_id": PROJECT_ID, "api_key": value}


def _capture_series(monkeypatch) -> list[str]:
    seen: list[str] = []

    def list_series(api_key):
        seen.append(api_key)
        return [{"id": "s1", "name": "Global Monthly", "description": "monthly"}]

    monkeypatch.setattr(planet_client, "list_series", list_series)
    return seen


def test_series_are_listed_with_the_organizations_key(client, monkeypatch):
    seen = _capture_series(monkeypatch)

    response = client.post("/api/planet/series", json=_org_key())

    assert response.status_code == 200
    assert response.json() == [{"id": "s1", "name": "Global Monthly", "description": "monthly"}]
    assert seen == ["PLANET-SECRET"]


def test_series_can_also_be_listed_with_a_key_the_person_provides(client, monkeypatch):
    seen = _capture_series(monkeypatch)

    response = client.post("/api/planet/series", json=_own_key())

    assert response.status_code == 200
    assert seen == ["MY-OWN-KEY"]


def test_a_credential_must_name_exactly_one_key_source(client, monkeypatch):
    _capture_series(monkeypatch)

    assert client.post("/api/planet/series", json={"project_id": PROJECT_ID}).status_code == 422
    both = {**_org_key(), **_own_key()}
    assert client.post("/api/planet/series", json=both).status_code == 422


def test_a_key_from_another_organization_is_not_usable(client, monkeypatch):
    monkeypatch.setattr(planet_client, "list_series", lambda api_key: [])

    response = client.post("/api/planet/series", json=_org_key(key_id=999))

    assert response.status_code == 404


def test_planet_failures_surface_as_bad_gateway(client, monkeypatch):
    def boom(api_key):
        raise planet_client.PlanetError("Planet rejected the API key")

    monkeypatch.setattr(planet_client, "list_series", boom)

    response = client.post("/api/planet/series", json=_org_key())

    assert response.status_code == 502
    assert "rejected" in response.json()["detail"]


def test_mosaics_come_back_as_templates_never_carrying_the_live_key(client, monkeypatch):
    monkeypatch.setattr(
        planet_client,
        "list_mosaics",
        lambda series_id, api_key: [
            {
                "id": "m1",
                "name": "global_monthly_2024_01_mosaic",
                "first_acquired": "2024-01-01T00:00:00.000Z",
                "last_acquired": "2024-01-31T00:00:00.000Z",
                "datatype": "uint16",
                "grid": {"resolution": 4.77},
                "_links": {"tiles": TILE_LINK},
            }
        ],
    )

    response = client.post("/api/planet/series/s1/mosaics", json=_org_key())

    assert response.status_code == 200
    assert "PLANET-SECRET" not in response.text
    body = response.json()
    assert body["renderings"] == ["Visual", "False Color", "NDVI"]
    assert body["max_native_zoom"] == 15
    assert body["mosaics"][0]["tile_urls"]["NDVI"].endswith("api_key={api_key}&proc=ndvi")


def test_the_connection_is_handed_back_before_planet_is_called(client, monkeypatch):
    """A connection held across the upstream call sits idle in a transaction
    until Postgres ends it at DB_IDLE_IN_TRANSACTION_TIMEOUT_MS - which is what
    made the imagery wizard kill a connection every time it listed a catalog."""
    released_before_call = []
    session = MagicMock()
    app.dependency_overrides[get_db] = lambda: session

    def _series(_key):
        released_before_call.append(session.close.called)
        return []

    monkeypatch.setattr(planet_client, "list_series", _series)

    assert client.post("/api/planet/series", json=_org_key()).status_code == 200
    assert released_before_call == [True]

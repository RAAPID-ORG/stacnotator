import pytest
import responses

import stacnotator
from stacnotator._auth import SECURETOKEN_URL
from stacnotator._credentials import Credentials, load, save
from stacnotator.campaign import Campaign
from stacnotator.client import Client
from stacnotator.errors import NotLoggedInError

BASE = "https://app.example.org"

CAMPAIGN_PAYLOAD = {
    "id": 42,
    "name": "Crop mapping",
    "mode": "open",
    "annotations_version": 3,
    "settings": {
        "labels": [
            {"id": 1, "name": "Maize", "geometry_type": "point"},
            {"id": 2, "name": "Other", "geometry_type": "point"},
        ],
        "bbox_west": -10.0,
        "bbox_south": 35.0,
        "bbox_east": 10.0,
        "bbox_north": 55.0,
    },
}


def save_local_creds():
    save(Credentials(url=BASE, auth={"mode": "none"}))


def test_client_without_credentials_raises():
    with pytest.raises(NotLoggedInError):
        Client()


@responses.activate
def test_campaigns_returns_dataframe():
    save_local_creds()
    responses.get(
        f"{BASE}/api/campaigns/",
        json={
            "items": [
                {
                    "id": 42,
                    "name": "Crop mapping",
                    "created_at": "2026-06-01T10:00:00Z",
                    "is_admin": True,
                    "is_member": True,
                    "is_public": False,
                }
            ]
        },
    )

    df = Client().campaigns()

    assert list(df.columns) == ["id", "name", "created_at", "is_admin", "is_member", "is_public"]
    assert df.loc[0, "id"] == 42
    assert df.loc[0, "name"] == "Crop mapping"


@responses.activate
def test_campaigns_empty_keeps_columns():
    save_local_creds()
    responses.get(f"{BASE}/api/campaigns/", json={"items": []})

    df = Client().campaigns()

    assert df.empty
    assert list(df.columns) == ["id", "name", "created_at", "is_admin", "is_member", "is_public"]


@responses.activate
def test_campaign_builds_campaign_object():
    save_local_creds()
    responses.get(f"{BASE}/api/campaigns/42", json=CAMPAIGN_PAYLOAD)

    campaign = Client().campaign(42)

    assert isinstance(campaign, Campaign)
    assert campaign.id == 42
    assert campaign.name == "Crop mapping"
    assert campaign.mode == "open"
    assert campaign.labels == {1: "Maize", 2: "Other"}
    assert campaign.extent == (-10.0, 35.0, 10.0, 55.0)


@responses.activate
def test_explicit_url_overrides_missing_credentials():
    responses.get(f"{BASE}/api/auth/me", json={"email": "local@localhost"})

    assert Client(BASE).whoami()["email"] == "local@localhost"


@responses.activate
def test_firebase_client_persists_rotated_refresh_token():
    save(
        Credentials(
            url=BASE,
            auth={"mode": "firebase", "api_key": "AIzaKey", "refresh_token": "r-old"},
        )
    )
    responses.post(
        SECURETOKEN_URL,
        json={"id_token": "id-1", "refresh_token": "r-new", "expires_in": "3600"},
    )
    responses.get(f"{BASE}/api/auth/me", json={"email": "a@b.c"})

    Client().whoami()

    assert load().auth["refresh_token"] == "r-new"


@responses.activate
def test_module_level_login_and_campaign(monkeypatch):
    responses.get(f"{BASE}/api/auth/me", json={"email": "local@localhost"})
    responses.get(f"{BASE}/api/auth/me", json={"email": "local@localhost"})
    responses.get(f"{BASE}/api/campaigns/42", json=CAMPAIGN_PAYLOAD)

    user = stacnotator.login(BASE)

    assert user["email"] == "local@localhost"
    assert load() == Credentials(url=BASE, auth={"mode": "none"}, api_url=BASE)
    assert stacnotator.campaign(42).name == "Crop mapping"

    stacnotator.logout()
    assert load() is None
    with pytest.raises(NotLoggedInError):
        stacnotator.whoami()


def test_campaign_rejects_non_integer_id():
    save_local_creds()

    with pytest.raises(ValueError, match="snt.campaigns"):
        Client().campaign(None)


@responses.activate
def test_client_uses_api_url_for_requests():
    save(Credentials(url=BASE, auth={"mode": "none"}, api_url="https://api.example.org"))
    responses.get("https://api.example.org/api/auth/me", json={"email": "a@b.c"})

    assert Client().whoami()["email"] == "a@b.c"

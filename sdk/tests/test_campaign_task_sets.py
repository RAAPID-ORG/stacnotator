import json

import pandas as pd
import pytest
import responses

from stacnotator._credentials import Credentials, save
from stacnotator.client import Client

BASE = "https://app.example.org"

CAMPAIGN_PAYLOAD = {"id": 42, "name": "Crop mapping", "mode": "tasks", "settings": {"labels": []}}

SETS = [
    {
        "id": 1,
        "name": "Default",
        "created_at": "2026-07-10T00:00:00",
        "num_tasks": 5,
        "num_labeled": 2,
    },
    {
        "id": 2,
        "name": "round-2",
        "created_at": "2026-07-10T00:00:00",
        "num_tasks": 0,
        "num_labeled": 0,
    },
]


def make_campaign():
    save(Credentials(url=BASE, auth={"mode": "none"}))
    responses.get(f"{BASE}/api/campaigns/42", json=CAMPAIGN_PAYLOAD)
    return Client().campaign(42)


def ingest_call():
    return next(
        c for c in responses.calls if c.request.url.endswith("ingest-annotation-task-geojson")
    )


@responses.activate
def test_task_sets_returns_frame():
    campaign = make_campaign()
    responses.get(f"{BASE}/api/campaigns/42/task-sets", json=SETS)
    frame = campaign.task_sets()
    assert list(frame.columns) == ["id", "name", "num_tasks", "num_labeled"]
    assert frame["name"].tolist() == ["Default", "round-2"]


@responses.activate
def test_upload_tasks_dataframe_to_existing_set():
    campaign = make_campaign()
    responses.get(f"{BASE}/api/campaigns/42/task-sets", json=SETS)
    responses.post(
        f"{BASE}/api/campaigns/42/ingest-annotation-task-geojson",
        json={"num_tasks_created": 2},
    )

    df = pd.DataFrame({"lat": [10.0, 11.0], "lon": [20.0, 21.0], "plot": ["a", "b"]})
    created = campaign.upload_tasks(df, task_set="round-2")

    assert created == 2
    body = ingest_call().request.body
    payload = body if isinstance(body, bytes) else body.encode()
    assert b'name="task_set_id"' in payload
    assert b"2" in payload
    fc_start = payload.index(b'{"type": "FeatureCollection"')
    fc = json.loads(payload[fc_start : payload.index(b"}]}", fc_start) + 3])
    assert fc["features"][0]["geometry"] == {"type": "Point", "coordinates": [20.0, 10.0]}
    assert fc["features"][0]["properties"] == {"plot": "a"}


@responses.activate
def test_upload_tasks_missing_set_without_create_missing_raises():
    campaign = make_campaign()
    responses.get(f"{BASE}/api/campaigns/42/task-sets", json=SETS)
    df = pd.DataFrame({"lat": [10.0], "lon": [20.0]})
    with pytest.raises(ValueError, match="round-3.*Default.*create_missing"):
        campaign.upload_tasks(df, task_set="round-3")


@responses.activate
def test_upload_tasks_creates_missing_set_when_opted_in():
    campaign = make_campaign()
    responses.get(f"{BASE}/api/campaigns/42/task-sets", json=SETS)
    responses.post(
        f"{BASE}/api/campaigns/42/task-sets",
        json={
            "id": 3,
            "name": "round-3",
            "created_at": "2026-07-10T00:00:00",
            "num_tasks": 0,
            "num_labeled": 0,
        },
        status=201,
    )
    responses.post(
        f"{BASE}/api/campaigns/42/ingest-annotation-task-geojson",
        json={"num_tasks_created": 1},
    )

    df = pd.DataFrame({"lat": [10.0], "lon": [20.0]})
    assert campaign.upload_tasks(df, task_set="round-3", create_missing=True) == 1
    create_call = next(
        c
        for c in responses.calls
        if c.request.url.endswith("/task-sets") and c.request.method == "POST"
    )
    assert json.loads(create_call.request.body) == {"name": "round-3"}


def test_upload_tasks_rejects_frame_without_coordinates():
    save(Credentials(url=BASE, auth={"mode": "none"}))
    with responses.RequestsMock() as rsps:
        rsps.get(f"{BASE}/api/campaigns/42", json=CAMPAIGN_PAYLOAD)
        campaign = Client().campaign(42)
    with pytest.raises(ValueError, match="lat.*lon"):
        campaign.upload_tasks(pd.DataFrame({"x": [1]}), task_set="Default")


def test_upload_tasks_rejects_nan_coordinates():
    save(Credentials(url=BASE, auth={"mode": "none"}))
    with responses.RequestsMock() as rsps:
        rsps.get(f"{BASE}/api/campaigns/42", json=CAMPAIGN_PAYLOAD)
        campaign = Client().campaign(42)
    df = pd.DataFrame({"lat": [10.0, float("nan")], "lon": [20.0, 21.0]})
    with pytest.raises(ValueError, match="missing lat/lon"):
        campaign.upload_tasks(df, task_set="Default")


@responses.activate
def test_upload_tasks_accepts_feature_collection_dict():
    campaign = make_campaign()
    responses.get(f"{BASE}/api/campaigns/42/task-sets", json=SETS)
    responses.post(
        f"{BASE}/api/campaigns/42/ingest-annotation-task-geojson",
        json={"num_tasks_created": 1},
    )
    fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [0, 0]]]},
                "properties": {},
            }
        ],
    }
    assert campaign.upload_tasks(fc, task_set="Default") == 1

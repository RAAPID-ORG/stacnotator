"""The timeseries route must not hold a pooled connection across the Earth Engine call."""

from types import SimpleNamespace

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from src.auth.dependencies import require_authenticated_user
from src.campaigns.dependencies import require_campaign_access
from src.database import get_db
from src.main import app
from src.timeseries import router as ts_router
from src.timeseries import service

CAMPAIGN_ID = 4
TS_ID = 55


@pytest.fixture()
def events(monkeypatch):
    log: list[str] = []

    class FakeSession:
        def close(self):
            log.append("close")

    fake_db = FakeSession()

    def fake_get_ts(ts_id, db):
        return SimpleNamespace(
            id=ts_id,
            campaign_id=CAMPAIGN_ID,
            start_ym="202401",
            end_ym="202403",
            ts_type="NDVI",
            data_source="MODIS",
        )

    def fake_ee(**kwargs):
        log.append("earth_engine")
        return pd.DataFrame([{"date": "2024-01-01", "value": 0.5}])

    monkeypatch.setattr(ts_router.service, "get_timeseries_by_id", fake_get_ts)
    monkeypatch.setattr(service, "get_timeseries_data", fake_ee)
    monkeypatch.setattr(ts_router, "ensure_earth_engine", lambda: True)

    app.dependency_overrides[get_db] = lambda: fake_db
    app.dependency_overrides[require_authenticated_user] = lambda: SimpleNamespace(id=1)
    app.dependency_overrides[require_campaign_access] = lambda: SimpleNamespace(id=CAMPAIGN_ID)
    yield log
    app.dependency_overrides.clear()


def test_connection_is_released_before_the_earth_engine_call(events):
    """Holding it across the call pins a connection for seconds while doing no DB
    work; a few concurrent fetches then starve the app of connections entirely."""
    client = TestClient(app, headers={"Authorization": "Bearer t"})

    resp = client.get(
        f"/api/campaigns/{CAMPAIGN_ID}/timeseries/{TS_ID}/data",
        params={"latitude": -0.9, "longitude": 36.9},
    )

    assert resp.status_code == 200
    assert events == ["close", "earth_engine"]


ZONE = {
    "type": "Polygon",
    "coordinates": [[[36.9, -0.9], [36.91, -0.9], [36.91, -0.89], [36.9, -0.9]]],
}


def _zonal(events, monkeypatch, fetched=None, **request):
    calls: list[dict] = []

    def fake_zonal(**kwargs):
        events.append("earth_engine")
        calls.append(kwargs)
        if isinstance(fetched, Exception):
            raise fetched
        return pd.DataFrame([{"time": pd.Timestamp("2024-01-05"), "values": 0.4, "cloud": 0}])

    monkeypatch.setattr(service, "get_zonal_timeseries_data", fake_zonal)
    client = TestClient(app, headers={"Authorization": "Bearer t"})
    resp = client.post(
        f"/api/campaigns/{request.get('campaign_id', CAMPAIGN_ID)}/timeseries/{TS_ID}/data",
        json={"geometry": request.get("geometry", ZONE)},
    )
    return resp, calls


def test_zonal_series_releases_the_connection_and_passes_the_polygon(events, monkeypatch):
    resp, calls = _zonal(events, monkeypatch)

    assert resp.status_code == 200
    assert events == ["close", "earth_engine"]
    assert calls == [
        {
            "ts_type": "NDVI",
            "data_source": "MODIS",
            "geometry": ZONE,
            "start_date": "2024-01-01",
            "end_date": "2024-04-01",
        }
    ]
    assert resp.json() == {
        "timeseries_id": TS_ID,
        "data": [{"time": "2024-01-05T00:00:00", "values": 0.4, "cloud": 0}],
    }


def test_zonal_series_rejects_an_invalid_polygon_before_any_work(events, monkeypatch):
    bowtie = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [0.01, 0.01], [0.01, 0], [0, 0.01], [0, 0]]],
    }
    resp, _ = _zonal(events, monkeypatch, geometry=bowtie)

    assert resp.status_code == 422
    assert events == []


def test_zonal_series_of_another_campaign_is_not_found(events, monkeypatch):
    resp, _ = _zonal(events, monkeypatch, campaign_id=CAMPAIGN_ID + 1)

    assert resp.status_code == 404
    assert "earth_engine" not in events


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (ts_router.RateLimited("quota"), 503),
        (ts_router.UpstreamFailed("Too many pixels"), 502),
        (ValueError("MODIS cannot supply the bands NDRE needs"), 400),
    ],
)
def test_zonal_series_maps_earth_engine_errors(events, monkeypatch, error, status):
    resp, _ = _zonal(events, monkeypatch, fetched=error)

    assert resp.status_code == status

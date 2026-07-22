"""The timeseries route must not hold a pooled connection across the Earth Engine call."""

from types import SimpleNamespace

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from src.auth.dependencies import require_approved_user
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
    monkeypatch.setattr(ts_router, "require_campaign_access", lambda **kw: None)

    app.dependency_overrides[get_db] = lambda: fake_db
    app.dependency_overrides[require_approved_user] = lambda: SimpleNamespace(id=1)
    yield log
    app.dependency_overrides.clear()


def test_connection_is_released_before_the_earth_engine_call(events):
    """Holding it across the call pins a connection for seconds while doing no DB
    work; a few concurrent fetches then starve the app of connections entirely."""
    client = TestClient(app, headers={"Authorization": "Bearer t"})

    resp = client.get(f"/api/timeseries/{TS_ID}/-0.9/36.9/data")

    assert resp.status_code == 200
    assert events == ["close", "earth_engine"]

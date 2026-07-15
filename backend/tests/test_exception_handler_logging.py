import logging
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from src.annotation import service
from src.auth.dependencies import require_approved_user
from src.campaigns.dependencies import require_campaign_access
from src.database import get_db
from src.main import app

CAMPAIGN_ID = 66


@pytest.fixture()
def client(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("underlying cause we need to see")

    monkeypatch.setattr(service, "render_annotation_tile", boom)
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[require_approved_user] = lambda: SimpleNamespace(id=1)
    app.dependency_overrides[require_campaign_access] = lambda: SimpleNamespace(id=CAMPAIGN_ID)
    yield TestClient(
        app,
        raise_server_exceptions=False,
        headers={"Authorization": "Bearer test-token"},
    )
    app.dependency_overrides.clear()


def test_unhandled_exception_logs_traceback(client, caplog):
    """The catch-all handler must log the cause; it is the only record of it.

    The handler is sync, so Starlette dispatches it via run_in_threadpool and
    `sys.exc_info()` (thread-local) is empty there - the traceback is lost
    unless the exception is passed explicitly.
    """
    with caplog.at_level(logging.ERROR, logger="src.main"):
        response = client.get(f"/api/campaigns/{CAMPAIGN_ID}/annotations/tiles/15/9474/12553.pbf")

    assert response.status_code == 500

    records = [r for r in caplog.records if "Unhandled exception" in r.getMessage()]
    assert records, "handler did not log at all"
    record = records[0]

    assert record.exc_info is not None, "traceback dropped - cause is unrecoverable from logs"
    assert "underlying cause we need to see" in record.exc_text

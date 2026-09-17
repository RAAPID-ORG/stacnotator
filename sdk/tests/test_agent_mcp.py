import base64
import json

import pytest
import responses
from mcp.server.mcpserver import Image
from mcp.server.mcpserver.exceptions import ToolError

from stacnotator import _render_browsers, agent_mcp
from stacnotator._credentials import Credentials, save

BASE = "https://app.example.org"
AGENT = "8f7c1f0e-0000-4000-8000-000000000001"
IMAGE_BYTES = b"\xff\xd8\xfffake-jpeg"
DETAIL_VIEW = {"cells": [{"slice_id": 7, "zoom": 17}], "columns": 1, "cell_px": 768}


@pytest.fixture(autouse=True)
def logged_in(monkeypatch):
    save(Credentials(url=BASE, auth={"mode": "none"}, api_url=BASE))
    monkeypatch.setattr(agent_mcp, "_render_browsers_manager", lambda: None)
    agent_mcp._http.cache_clear()
    yield
    agent_mcp._http.cache_clear()


@responses.activate
def test_next_task_returns_task_text_then_the_drawn_images():
    task = {"task_id": 5, "annotation_number": 1, "lat": 1.5, "lon": 30.0, "geometry_wkt": "POINT"}
    responses.post(
        f"{BASE}/api/agents/{AGENT}/next",
        json={
            "task": task,
            "remaining": 3,
            "views": [
                {"view": DETAIL_VIEW, "status": "failed", "error": "No render host is open."},
                {
                    "view": DETAIL_VIEW,
                    "status": "done",
                    "mime_type": "image/jpeg",
                    "image_base64": base64.b64encode(IMAGE_BYTES).decode(),
                    "meta": {"cells": [{"index": 0, "zoom": 17}]},
                },
            ],
        },
    )

    text, image = agent_mcp.next_task(AGENT)

    summary = json.loads(text)
    assert summary["task"] == task
    assert summary["remaining"] == 3
    assert summary["views"][0] == {
        "status": "failed",
        "view": DETAIL_VIEW,
        "error": "No render host is open.",
    }
    assert summary["views"][1]["image"] == 1
    assert summary["views"][1]["meta"] == {"cells": [{"index": 0, "zoom": 17}]}
    assert isinstance(image, Image)
    assert image.data == IMAGE_BYTES
    assert image.to_image_content().mime_type == "image/jpeg"


@responses.activate
def test_api_errors_reach_the_model_as_tool_errors():
    responses.post(
        f"{BASE}/api/agents/{AGENT}/tasks/9/annotate",
        json={"detail": "required form fields missing: Crop stage"},
        status=400,
    )

    with pytest.raises(ToolError, match="Crop stage"):
        agent_mcp.submit_label(AGENT, 9, label_id=1)


class BrowsersWithoutChromium:
    def ensure(self, campaign_id, agent_id):
        raise _render_browsers.ChromiumMissingError()


@responses.activate
def test_register_agent_asks_to_install_render_browsers_when_chromium_is_missing(monkeypatch):
    monkeypatch.setattr(agent_mcp, "_render_browsers_manager", BrowsersWithoutChromium)
    responses.post(
        f"{BASE}/api/campaigns/12/agents",
        json={"agent": {"agent_id": AGENT, "render_host_path": "/projects/3/campaigns/12/agents"}},
    )

    result = json.loads(agent_mcp.register_agent(12, "scout-a"))

    assert result["render_host_url"] == f"{BASE}/projects/3/campaigns/12/agents"
    assert "install_render_browsers" in result["render_browsers"]
    assert "Render in this tab" in result["render_browsers"]

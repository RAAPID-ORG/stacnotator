import asyncio
import base64
import json

import pytest
import responses
from mcp.server.mcpserver import Image
from mcp.server.mcpserver.exceptions import ToolError

from stacnotator import _areas, agent_mcp
from stacnotator._credentials import Credentials, save
from stacnotator._render_browsers import ChromiumMissingError

BASE = "https://app.example.org"
AGENT = "8f7c1f0e-0000-4000-8000-000000000001"
AGENT_OUT = {"agent_id": AGENT, "name": "scout-a-1a2b3c", "campaign_id": 12, "project_id": 3}
IMAGE_BYTES = b"\xff\xd8\xfffake-jpeg"
DEFAULT_VIEW = {"cells": [{"slice_id": 7}]}
TASK = {"task_id": 5, "annotation_number": 1, "lat": 1.5, "lon": 30.0, "geometry_wkt": "POINT"}
NEXT_TASK = {**TASK, "task_id": 6, "annotation_number": 2}


class FakeBrowsers:
    def __init__(self):
        self.calls = []
        self.shown = []
        self.watching = []

    async def call(self, agent_id, campaign_id, method, *args):
        self.calls.append((method, *args))
        if method == "defaultViews":
            return [DEFAULT_VIEW]
        if method == "render":
            _, views, _limits = args
            return [
                {"view": views[0], "error": "unknown slice 7"},
                *(
                    {
                        "view": view,
                        "image_base64": base64.b64encode(IMAGE_BYTES).decode(),
                        "meta": {"cells": [{"index": 0}]},
                    }
                    for view in views
                ),
            ]
        return None

    async def setup(self, project_id, method, *args):
        self.calls.append((method, *args))
        return {"sources": [{"name": "Sentinel-2 L2A"}], "basemaps": []}

    async def show(self, agent, task_id, images):
        self.shown.append((agent, task_id, len(images)))

    async def open_watch_window(self, agents_url=None):
        self.watching.append(agents_url)


@pytest.fixture
def browsers(monkeypatch):
    save(Credentials(url=BASE, auth={"mode": "none"}, api_url=BASE))
    fake = FakeBrowsers()
    monkeypatch.setattr(agent_mcp, "_browsers", lambda: fake)
    monkeypatch.setattr(agent_mcp, "_session_url", BASE)
    agent_mcp._signed_in_http.cache_clear()
    agent_mcp._agents.clear()
    agent_mcp._default_views.clear()
    agent_mcp._current_tasks.clear()
    agent_mcp._image_limits.clear()
    yield fake
    agent_mcp._signed_in_http.cache_clear()


@responses.activate
def test_next_task_draws_the_task_and_preloads_the_ones_after_it(browsers):
    responses.get(f"{BASE}/api/agents/{AGENT}", json=AGENT_OUT)
    responses.post(
        f"{BASE}/api/agents/{AGENT}/next",
        json={"campaign_id": 12, "remaining": 3, "tasks": [TASK, NEXT_TASK]},
    )

    limits = {"max_edge_px": 1000, "max_megapixels": 1.0}
    asyncio.run(agent_mcp.set_image_limits(AGENT, 1000, 1.0))

    text, image = asyncio.run(agent_mcp.next_task(AGENT))

    summary = json.loads(text)
    assert summary["task"] == TASK
    assert summary["remaining"] == 3
    assert summary["views"][0] == {"view": DEFAULT_VIEW, "error": "unknown slice 7"}
    assert summary["views"][1]["image"] == 1
    assert isinstance(image, Image)
    assert image.data == IMAGE_BYTES
    assert ("render", TASK, [DEFAULT_VIEW], limits) in browsers.calls
    assert ("preload", [NEXT_TASK], [DEFAULT_VIEW], limits) in browsers.calls
    assert browsers.shown == [("scout-a-1a2b3c", 5, 1)]


def test_get_views_only_draws_the_current_task(browsers):
    with pytest.raises(ToolError, match="call next_task"):
        asyncio.run(agent_mcp.get_views(AGENT, 5, [DEFAULT_VIEW]))


@responses.activate
def test_api_errors_reach_the_model_as_tool_errors(browsers):
    responses.post(
        f"{BASE}/api/agents/{AGENT}/tasks/9/annotate",
        json={"detail": "required form fields missing: Crop stage"},
        status=400,
    )

    with pytest.raises(ToolError, match="Crop stage"):
        asyncio.run(agent_mcp.submit_label(AGENT, 9, label_id=1, confidence=4, comment="bare soil"))


@responses.activate
def test_register_agent_keeps_the_agent_when_chromium_is_missing(browsers, monkeypatch):
    async def missing(*args):
        raise ChromiumMissingError()

    monkeypatch.setattr(browsers, "call", missing)
    responses.post(f"{BASE}/api/campaigns/12/agents", json=AGENT_OUT)

    result = json.loads(asyncio.run(agent_mcp.register_agent(12, "scout-a", 1000, 1.0)))

    assert result["agent"] == AGENT_OUT
    assert "install_render_browsers" in result["render_browser"]


@responses.activate
def test_registering_opens_the_watch_window_and_names_the_agents_page(browsers):
    responses.post(f"{BASE}/api/campaigns/12/agents", json=AGENT_OUT)

    result = json.loads(asyncio.run(agent_mcp.register_agent(12, "scout-a", 1000, 1.0)))
    assert result["agents_page"] == f"{BASE}/projects/3/campaigns/12/agents"
    assert browsers.watching == [result["agents_page"]]

    asyncio.run(agent_mcp.register_agent(12, "scout-b", 1000, 1.0, watch_window=False))
    assert len(browsers.watching) == 1


@responses.activate
def test_registered_image_limits_reach_every_render(browsers):
    responses.post(f"{BASE}/api/campaigns/12/agents", json=AGENT_OUT)
    responses.post(
        f"{BASE}/api/agents/{AGENT}/next",
        json={"campaign_id": 12, "remaining": 1, "tasks": [TASK]},
    )

    asyncio.run(
        agent_mcp.register_agent(12, "scout-a", max_image_edge_px=2000, max_image_megapixels=3.0)
    )
    asyncio.run(agent_mcp.next_task(AGENT))

    renders = [call for call in browsers.calls if call[0] == "render"]
    assert renders[0][3] == {"max_edge_px": 2000, "max_megapixels": 3.0}


def test_tools_refuse_until_the_user_named_a_deployment(browsers, monkeypatch):
    monkeypatch.setattr(agent_mcp, "_session_url", None)

    with pytest.raises(ToolError, match="full URL"):
        asyncio.run(agent_mcp.list_campaigns())


@pytest.mark.parametrize("url", ["stacnotator.example.org", "app", "ftp://app.example.org"])
def test_login_requires_a_full_url(browsers, url):
    with pytest.raises(ToolError, match="full URL"):
        asyncio.run(agent_mcp.login(url))


@responses.activate
def test_login_reuses_a_saved_login_for_the_same_deployment(browsers, monkeypatch):
    monkeypatch.setattr(agent_mcp, "_session_url", None)
    responses.get(f"{BASE}/api/auth/me", json={"display_name": "rohan"})

    result = json.loads(asyncio.run(agent_mcp.login(BASE + "/")))

    assert result == {"deployment": BASE, "signed_in_as": "rohan"}
    assert agent_mcp._session_url == BASE


@responses.activate
def test_create_campaign_builds_imagery_on_the_page_and_sets_the_guide(browsers):
    created = responses.post(
        f"{BASE}/api/campaigns/",
        json={"id": 40, "registration_status": "registering"},
    )
    patched = responses.patch(f"{BASE}/api/campaigns/40", json={})
    responses.get(f"{BASE}/api/campaigns/40/task-sets", json=[])
    recipe = {
        "collection": "sentinel-2-l2a",
        "windows": [
            {"name": "2024", "slices": [{"start": "2024-07-01", "end": "2024-07-31"}], "cover": 0}
        ],
    }

    result = json.loads(
        asyncio.run(
            agent_mcp.create_campaign(
                3,
                "Crops",
                ["Maize", "Other"],
                [recipe],
                [30, 1, 31, 2],
                guide_markdown="# G",
                timeseries=[
                    {
                        "name": "NDVI",
                        "data_source": "SENTINEL2",
                        "ts_type": "NDVI",
                        "start_ym": "2024-01",
                        "end_ym": "2024-06",
                    }
                ],
            )
        )
    )

    assert ("imagery", [recipe], None) in browsers.calls
    body = json.loads(created.calls[0].request.body)
    assert body["imagery_editor_state"]["sources"][0]["name"] == "Sentinel-2 L2A"
    assert [(label["id"], label["name"]) for label in body["settings"]["labels"]] == [
        (1, "Maize"),
        (2, "Other"),
    ]
    assert body["timeseries_configs"][0]["start_ym"] == "202401"
    assert json.loads(patched.calls[0].request.body) == {"guide_markdown": "# G"}
    assert result["url"] == f"{BASE}/projects/3/campaigns/40"


@responses.activate
def test_add_tasks_samples_into_a_new_task_set(browsers):
    responses.get(f"{BASE}/api/campaigns/40/task-sets", json=[])
    responses.post(f"{BASE}/api/campaigns/40/task-sets", json={"id": 9})
    sampled = responses.post(
        f"{BASE}/api/campaigns/40/sampling/generate-tasks", json={"num_tasks_created": 50}
    )

    result = json.loads(
        asyncio.run(
            agent_mcp.add_tasks(
                40, "Pilot", sampling={"strategy_type": "random", "num_samples": 50}
            )
        )
    )

    form = sampled.calls[0].request.body
    assert "task_set_id=9" in form and "use_campaign_bbox=true" in form
    assert result["tasks_created"] == 50
    with pytest.raises(ToolError, match="exactly one"):
        asyncio.run(agent_mcp.add_tasks(40, "Pilot"))


@responses.activate
def test_preview_waits_for_registration_then_draws_task_centres(browsers):
    summary = responses.get(
        f"{BASE}/api/campaigns/40/summary", json={"registration_status": "registering"}
    )
    with pytest.raises(ToolError, match="registering"):
        asyncio.run(agent_mcp.preview_campaign(40, 1000, 1.0))

    summary.body = json.dumps({"registration_status": "ready"})
    wkt = "POLYGON ((30 1, 32 1, 32 3, 30 3, 30 1))"
    responses.get(
        f"{BASE}/api/campaigns/40/tasks", json={"tasks": [{"id": 5, "geometry_wkt": wkt}]}
    )

    text, *_ = asyncio.run(agent_mcp.preview_campaign(40, 1000, 1.0))

    task = json.loads(text)["task"]
    assert task["task_id"] == 5
    assert task["lon"] == pytest.approx(31.0)
    assert task["lat"] == pytest.approx(2.0)


GB = "https://www.geoboundaries.org/api/current/gbOpen"
SQUARE = {"type": "Polygon", "coordinates": [[[36, 49], [37, 49], [37, 50], [36, 49]]]}


def _boundaries(mocked, level, *names):
    mocked.get(f"{GB}/UKR/{level}/", json={"simplifiedGeometryGeoJSON": f"https://gb/{level}"})
    features = [
        {"properties": {"shapeName": name, "shapeID": f"{level}-{i}"}, "geometry": SQUARE}
        for i, name in enumerate(names)
    ]
    mocked.get(f"https://gb/{level}", json={"features": features})


@pytest.fixture
def boundaries():
    _areas._units.cache_clear()
    with responses.RequestsMock(assert_all_requests_are_fired=False) as mocked:
        _boundaries(mocked, "ADM1", "Kharkiv")
        _boundaries(mocked, "ADM2", "Iziaslav", "Iziumskyi", "Izium")
        yield mocked
    _areas._units.cache_clear()


def test_find_area_puts_the_exact_name_first_and_ignores_generic_words(boundaries):
    found = json.loads(asyncio.run(agent_mcp.find_area("ukr", "Izium raion")))

    assert [a["name"] for a in found] == ["Izium", "Iziumskyi"]
    assert found[0]["area_id"] == "UKR/ADM2/ADM2-2"
    assert found[0]["bbox"] == [36, 49, 37, 50]


def test_add_tasks_samples_inside_an_areas_outline(browsers, boundaries):
    boundaries.get(f"{BASE}/api/campaigns/40/task-sets", json=[{"id": 9, "name": "Pilot"}])
    sampled = boundaries.post(
        f"{BASE}/api/campaigns/40/sampling/generate-tasks", json={"num_tasks_created": 5}
    )
    boundaries.get(f"{BASE}/api/campaigns/40/task-sets", json=[])

    asyncio.run(
        agent_mcp.add_tasks(
            40,
            "Pilot",
            sampling={"strategy_type": "random", "num_samples": 5, "area_id": "UKR/ADM2/ADM2-2"},
        )
    )

    body = sampled.calls[0].request.body.decode()
    assert 'name="use_campaign_bbox"\r\n\r\nfalse' in body and '"area_id"' not in body
    assert json.dumps(SQUARE) in body


async def _tool_names():
    from mcp import Client

    async with Client(agent_mcp.server) as client:
        return {tool.name for tool in (await client.list_tools()).tools}


def test_tools_that_change_campaigns_are_offered_only_when_granted(monkeypatch):
    changing = {"create_campaign", "add_tasks", "edit_campaign", "edit_imagery"}
    assert not changing & asyncio.run(_tool_names())

    monkeypatch.setattr(agent_mcp, "_ALLOWED", {"edit_imagery"})
    for name in changing:
        agent_mcp._grantable_tool(getattr(agent_mcp, name))
    try:
        assert changing & asyncio.run(_tool_names()) == {"edit_imagery"}
    finally:
        agent_mcp.server.remove_tool("edit_imagery")


@responses.activate
def test_edit_imagery_saves_the_merged_imagery_built_on_the_page(browsers):
    responses.get(f"{BASE}/api/campaigns/40/summary", json={"project_id": 3})
    saved = responses.put(f"{BASE}/api/campaigns/40/imagery", status=204)
    recipe = {"collection": "landsat-c2-l2", "windows": []}

    result = json.loads(asyncio.run(agent_mcp.edit_imagery(40, [recipe], remove=["Old"])))

    assert ("editImagery", 40, [recipe], None, ["Old"]) in browsers.calls
    assert json.loads(saved.calls[0].request.body)["sources"] == [{"name": "Sentinel-2 L2A"}]
    assert result["sources"] == ["Sentinel-2 L2A"]

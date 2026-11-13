import asyncio
import base64
import json

import pytest
import responses
from mcp.server.mcpserver import Image
from mcp.server.mcpserver.exceptions import ToolError
from requests import Timeout

from stacnotator import agent_mcp
from stacnotator._credentials import Credentials, save
from stacnotator._render_browsers import ChromiumMissingError

BASE = "https://app.example.org"
AGENT = "8f7c1f0e-0000-4000-8000-000000000001"
AGENT_OUT = {"agent_id": AGENT, "name": "scout-a-1a2b3c", "campaign_id": 12, "project_id": 3}
IMAGE_BYTES = b"\xff\xd8\xfffake-jpeg"
DEFAULT_VIEW = {"cells": [{"slice_id": 7}]}
TASK = {"task_id": 5, "annotation_number": 1, "lat": 1.5, "lon": 30.0, "geometry_wkt": "POINT"}
NEXT_TASK = {**TASK, "task_id": 6, "annotation_number": 2}
CUSTOM_SERIES = {
    "name": "Vegetation",
    "window_name": "Growing season",
    "data_source": "sentinel2",
    "ts_type": "MyIndex",
    "start_ym": "202601",
    "end_ym": "202612",
    "expression": "(nir - red) / (nir + red)",
    "domain_min": -1.0,
    "domain_max": 1.0,
}


class FakeBrowsers:
    def __init__(self):
        self.calls = []
        self.watching = []
        self.closed = []

    @property
    def recorded(self):
        return agent_mcp._recording().read()

    async def call(self, agent_id, campaign_id, method, *args):
        self.calls.append((method, *args))
        if method == "defaultViews":
            return [DEFAULT_VIEW]
        if method == "context":
            return {"labels": [{"id": 1, "name": "Forest"}]}
        if method == "locate":
            return [{"lat": 1.6, "lon": 30.1} for _ in args[1]]
        if method == "render":
            _, views, _limits = args
            return [
                {"view": views[0], "error": "unknown slice 7"},
                *(
                    {
                        "view": view,
                        "image_base64": base64.b64encode(IMAGE_BYTES).decode(),
                        "meta": {"cells": [{"index": 0}], "grid": {"columns": 4, "cell_px": 300}},
                    }
                    for view in views
                ),
            ]
        if method == "probe":
            return {
                "view": {"cells": [{"slice_id": 7, "zoom": 15}, {"timeseries_ids": [3]}]},
                "image_base64": base64.b64encode(IMAGE_BYTES).decode(),
                "meta": {"probes": [{"probe": "P1"}], "grid": {"columns": 2, "cell_px": 300}},
            }
        return None

    async def setup(self, project_id, method, *args):
        self.calls.append((method, *args))
        return {"sources": [{"name": "Sentinel-2 L2A"}], "basemaps": []}

    async def show(self, agent, task_id, images):
        pass

    async def open_watch_window(self, agents_url=None):
        self.watching.append(agents_url)

    async def close(self, key):
        self.closed.append(key)


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
    agent_mcp._replies.clear()
    agent_mcp._label_names.clear()
    agent_mcp._recordings.cache_clear()
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
    event = browsers.recorded[0]
    assert event["action"] == "next_task"
    assert event["task"] == TASK
    assert event["images"] == [base64.b64encode(IMAGE_BYTES).decode()]
    assert event["result"] == summary


def test_get_views_only_draws_the_current_task(browsers):
    with pytest.raises(ToolError, match="call next_task"):
        asyncio.run(agent_mcp.get_views(AGENT, 5, [DEFAULT_VIEW]))


@responses.activate
def test_exploration_resolves_pixels_and_keeps_the_task_and_requested_views(browsers):
    reply = _start_task([TASK])
    pick = {"reply": reply, "image": 1, "x": 230, "y": 120}
    views = [{"center": pick, "zoom": 18, "cells": [{"slice_id": 7}, {"basemap_id": 2}]}]
    text, _ = asyncio.run(agent_mcp.get_views(AGENT, 5, views))
    locate, render = browsers.calls[-2:]
    assert locate == (
        "locate",
        TASK,
        [{"view": {**DEFAULT_VIEW, "columns": 4, "cell_px": 300}, **pick}],
    )
    assert render[1] == TASK
    assert render[2][0]["center"] == {"lat": 1.6, "lon": 30.1}
    assert views[0]["center"] == pick
    assert browsers.recorded[-1]["request"] == {"views": views}
    resolved_reply = json.loads(text)["reply"]
    asyncio.run(
        agent_mcp.get_views(
            AGENT,
            5,
            [
                {
                    "cells": [
                        {
                            "slice_id": 8,
                            "center": {"reply": resolved_reply, "image": 1, "x": 150, "y": 150},
                        }
                    ]
                }
            ],
        )
    )
    assert browsers.calls[-2][2][0]["view"]["center"] == {"lat": 1.6, "lon": 30.1}

    with pytest.raises(ToolError, match="Default views"):
        asyncio.run(agent_mcp.set_default_views(AGENT, views))


@responses.activate
def test_exploration_rejects_an_old_task_and_records_the_failure(browsers):
    reply = _start_task([TASK, NEXT_TASK])
    asyncio.run(agent_mcp.next_task(AGENT))
    with pytest.raises(ToolError, match="drawn for task 5, not 6"):
        asyncio.run(
            agent_mcp.get_views(
                AGENT,
                6,
                [{"center": {"reply": reply, "image": 1, "x": 100, "y": 100}, **DEFAULT_VIEW}],
            )
        )
    assert browsers.recorded[-1]["error"]
    assert browsers.recorded[-1]["task"] == NEXT_TASK


@responses.activate
def test_successful_answer_is_recorded_after_submission(browsers):
    _start_task([TASK])
    agent_mcp._label_names[AGENT] = {1: "Forest"}
    responses.post(f"{BASE}/api/agents/{AGENT}/tasks/5/annotate", json={"status": "saved"})
    asyncio.run(agent_mcp.submit_label(AGENT, 5, 1, 4, "Dense canopy"))
    event = browsers.recorded[-1]
    assert event["action"] == "submit_label"
    assert event["label_name"] == "Forest"
    assert event["request"]["comment"] == "Dense canopy"
    assert event["task"] == TASK
    assert event["result"] == {"status": "saved"}
    assert AGENT not in agent_mcp._current_tasks


@responses.activate
def test_recording_failure_does_not_repeat_or_undo_a_saved_answer(browsers, monkeypatch, caplog):
    _start_task([TASK])
    responses.post(f"{BASE}/api/agents/{AGENT}/tasks/5/annotate", json={"status": "saved"})

    def full(_event):
        raise OSError("disk full")

    monkeypatch.setattr(agent_mcp._recording(), "append", full)
    result = json.loads(asyncio.run(agent_mcp.submit_label(AGENT, 5, 1, 4, "Dense canopy")))
    assert result == {"status": "saved", "recording_error": "disk full"}
    assert AGENT not in agent_mcp._current_tasks
    assert sum(call.request.url.endswith("/annotate") for call in responses.calls) == 1
    assert "Could not save agent recording" in caplog.text


def _start_task(tasks):
    responses.get(f"{BASE}/api/agents/{AGENT}", json=AGENT_OUT)
    for task in tasks:
        responses.post(
            f"{BASE}/api/agents/{AGENT}/next",
            json={"campaign_id": 12, "remaining": 1, "tasks": [task]},
        )
    asyncio.run(agent_mcp.set_image_limits(AGENT, 1000, 1.0))
    text, _image = asyncio.run(agent_mcp.next_task(AGENT))
    return json.loads(text)["reply"]


@responses.activate
def test_probes_pick_pixels_on_the_images_of_the_reply_they_name(browsers):
    first = _start_task([TASK])

    points = [{"reply": first, "image": 1, "x": 120, "y": 40}, {"lat": 1.6, "lon": 30.1}]
    text, image = asyncio.run(agent_mcp.probe_timeseries(AGENT, 5, points, [3]))

    method, task, probes, options, _limits = browsers.calls[-1]
    assert (method, task) == ("probe", TASK)
    # The drawn size, not the asked one, is what turns the pixel back into a place.
    shown = {**DEFAULT_VIEW, "columns": 4, "cell_px": 300}
    assert probes == [{"view": shown, **points[0]}, points[1]]
    assert options == {"timeseries_ids": [3], "remove_cloudy": True, "smoothed": False}
    summary = json.loads(text)
    assert summary["views"][0]["meta"]["probes"] == [{"probe": "P1"}]
    assert isinstance(image, Image)

    # A pick on the probe image and one on the earlier reply each resolve against their own.
    second = summary["reply"]
    asyncio.run(
        agent_mcp.probe_timeseries(
            AGENT,
            5,
            [
                {"reply": second, "image": 1, "x": 10, "y": 10},
                {"reply": first, "image": 1, "x": 10, "y": 10},
            ],
        )
    )
    probe_view = {
        "cells": [{"slice_id": 7, "zoom": 15}, {"timeseries_ids": [3]}],
        "columns": 2,
        "cell_px": 300,
    }
    assert [p["view"] for p in browsers.calls[-1][2]] == [probe_view, shown]


@responses.activate
def test_probes_refuse_images_the_agent_was_not_shown_for_this_task(browsers):
    first = _start_task([TASK, NEXT_TASK])

    with pytest.raises(ToolError, match="has no image 2: it had 1 image\\."):
        asyncio.run(
            agent_mcp.probe_timeseries(AGENT, 5, [{"reply": first, "image": 2, "x": 1, "y": 1}])
        )
    with pytest.raises(ToolError, match="not one of your last"):
        asyncio.run(
            agent_mcp.probe_timeseries(AGENT, 5, [{"reply": first + 1, "image": 1, "x": 1, "y": 1}])
        )
    with pytest.raises(ToolError, match="or"):
        asyncio.run(agent_mcp.probe_timeseries(AGENT, 5, [{"image": 1, "x": 1, "y": 1}]))
    with pytest.raises(ToolError, match="call next_task"):
        asyncio.run(agent_mcp.probe_timeseries(AGENT, 6, [{"lat": 1.0, "lon": 2.0}]))

    # The views of an earlier task are centred on that task, not on this one.
    asyncio.run(agent_mcp.next_task(AGENT))
    with pytest.raises(ToolError, match="drawn for task 5, not 6"):
        asyncio.run(
            agent_mcp.probe_timeseries(AGENT, 6, [{"reply": first, "image": 1, "x": 1, "y": 1}])
        )


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
def test_remove_agent_deletes_it_and_closes_its_page(browsers):
    responses.delete(f"{BASE}/api/agents/{AGENT}", status=204)
    agent_mcp._agents[AGENT] = AGENT_OUT

    result = json.loads(asyncio.run(agent_mcp.remove_agent(AGENT)))

    assert result == {"removed": AGENT}
    assert AGENT not in agent_mcp._agents
    assert browsers.closed == [AGENT]


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
@pytest.mark.parametrize("guide", ["# G", "", None])
def test_create_campaign_builds_imagery_on_the_page_and_sets_the_guide(browsers, guide):
    created = responses.post(
        f"{BASE}/api/campaigns/", json={"id": 40, "registration_status": "registering"}
    )
    patched = responses.patch(f"{BASE}/api/campaigns/40", json={})
    responses.get(f"{BASE}/api/campaigns/40/task-sets", json=[])
    recipe = {"collection": "sentinel-2-l2a", "windows": []}
    settings = {"name": "Crops", "labels": [{"id": 1, "name": "Maize"}]}
    if guide is not None:
        settings["guide_markdown"] = guide

    result = json.loads(
        asyncio.run(agent_mcp.create_campaign(3, settings, [recipe], timeseries=[CUSTOM_SERIES]))
    )

    assert ("imagery", None, [recipe], None) in browsers.calls
    body = json.loads(created.calls[0].request.body)
    assert body["name"] == "Crops"
    assert body["settings"] == {"labels": [{"id": 1, "name": "Maize"}]}
    assert body["timeseries_configs"] == [CUSTOM_SERIES]
    assert body["imagery_editor_state"]["sources"][0]["name"] == "Sentinel-2 L2A"
    if guide is None:
        assert not patched.calls
    else:
        assert json.loads(patched.calls[0].request.body) == {"guide_markdown": guide}
    assert result["url"] == f"{BASE}/projects/3/campaigns/40"


@responses.activate
@pytest.mark.parametrize("failure", ["guide", "task_sets", "timeout"])
def test_create_campaign_preserves_identity_when_follow_up_fails(browsers, failure):
    created = responses.post(
        f"{BASE}/api/campaigns/", json={"id": 40, "registration_status": "registering"}
    )
    if failure == "timeout":
        responses.patch(f"{BASE}/api/campaigns/40", body=Timeout("guide timed out"))
    else:
        responses.patch(
            f"{BASE}/api/campaigns/40",
            json={"detail": "guide failed"} if failure == "guide" else {},
            status=500 if failure == "guide" else 200,
        )
    responses.get(
        f"{BASE}/api/campaigns/40/task-sets", json={"detail": "task sets failed"}, status=500
    )

    with pytest.raises(ToolError, match="Campaign 40 was created") as error:
        asyncio.run(
            agent_mcp.create_campaign(
                3,
                {"name": "Crops", "guide_markdown": "# G"},
                [{"collection": "sentinel-2-l2a", "windows": []}],
            )
        )

    assert f"{BASE}/projects/3/campaigns/40" in str(error.value)
    assert "Do not call create_campaign again" in str(error.value)
    assert "get_campaign" in str(error.value)
    assert ("task sets failed" if failure == "task_sets" else "guide") in str(error.value)
    assert len(created.calls) == 1


@responses.activate
def test_custom_index_preview_returns_compatible_sources_and_reports_invalid_formulas(browsers):
    preview = responses.post(
        f"{BASE}/api/timeseries/custom-indices/preview",
        json={"key": "MyIndex", "source_keys": ["sentinel2"]},
    )
    arguments = {
        "name": CUSTOM_SERIES["ts_type"],
        **{key: CUSTOM_SERIES[key] for key in ("expression", "domain_min", "domain_max")},
    }

    result = asyncio.run(_call("preview_custom_index", arguments))

    assert not result.is_error
    assert json.loads(result.content[0].text)["source_keys"] == ["sentinel2"]
    assert json.loads(preview.calls[0].request.body) == arguments
    preview.status = 422
    preview.body = json.dumps({"detail": "Unknown band 'invalid'"})
    result = asyncio.run(_call("preview_custom_index", arguments))
    assert result.is_error and "Unknown band" in result.content[0].text


@responses.activate
def test_edit_timeseries_preserves_custom_fields_through_mcp_and_adds_before_removing(
    browsers, monkeypatch
):
    responses.get(
        f"{BASE}/api/campaigns/40",
        json={"time_series": [{"id": 7, "window_id": 2}, {"id": 8, "window_id": 3}]},
    )
    created = responses.post(
        f"{BASE}/api/campaigns/40/timeseries",
        json={"new_items": [{"id": 9, **CUSTOM_SERIES}]},
    )
    renamed = responses.patch(f"{BASE}/api/campaigns/40/timeseries/windows/2", status=204)
    responses.delete(f"{BASE}/api/campaigns/40/timeseries/7", status=204)
    monkeypatch.setattr(agent_mcp, "_ALLOWED", {"edit_timeseries"})
    agent_mcp._grantable_tool(agent_mcp.edit_timeseries)
    try:
        result = asyncio.run(
            _call(
                "edit_timeseries",
                {
                    "campaign_id": 40,
                    "timeseries": [CUSTOM_SERIES],
                    "remove": [7],
                    "rename_windows": [{"window_id": 2, "name": "Renamed"}],
                },
            )
        )
    finally:
        agent_mcp.server.remove_tool("edit_timeseries")

    assert not result.is_error
    assert json.loads(created.calls[0].request.body) == {"timeseries": [CUSTOM_SERIES]}
    assert json.loads(renamed.calls[0].request.body) == {"name": "Renamed"}
    assert [call.request.method for call in responses.calls] == ["GET", "POST", "PATCH", "DELETE"]
    assert json.loads(result.content[0].text)["added"][0]["id"] == 9


@responses.activate
@pytest.mark.parametrize(
    "changes",
    [{"remove": [99]}, {"rename_windows": [{"window_id": 99, "name": "Wrong campaign"}]}],
)
def test_edit_timeseries_rejects_foreign_ids_before_writing(browsers, changes):
    responses.get(f"{BASE}/api/campaigns/40", json={"time_series": []})
    with pytest.raises(ToolError, match="must belong"):
        asyncio.run(agent_mcp.edit_timeseries(40, timeseries=[CUSTOM_SERIES], **changes))
    assert len(responses.calls) == 1


@responses.activate
@pytest.mark.parametrize("failure", ["create", "delete"])
def test_edit_timeseries_failure_requires_inspection_and_never_deletes_after_failed_creation(
    browsers, failure
):
    responses.get(f"{BASE}/api/campaigns/40", json={"time_series": [{"id": 7, "window_id": 2}]})
    responses.post(
        f"{BASE}/api/campaigns/40/timeseries",
        status=422 if failure == "create" else 200,
        json=(
            {"detail": "Invalid expression"} if failure == "create" else {"new_items": [{"id": 9}]}
        ),
    )
    deleted = responses.delete(
        f"{BASE}/api/campaigns/40/timeseries/7", body=Timeout("delete timed out")
    )
    with pytest.raises(ToolError, match="Inspect get_campaign"):
        asyncio.run(agent_mcp.edit_timeseries(40, timeseries=[CUSTOM_SERIES], remove=[7]))
    assert len(deleted.calls) == (0 if failure == "create" else 1)


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

    assert "task_set_id=9" in sampled.calls[0].request.body
    assert result["tasks_created"] == 50
    with pytest.raises(ToolError, match="exactly one"):
        asyncio.run(agent_mcp.add_tasks(40, "Pilot"))


@responses.activate
@pytest.mark.parametrize(
    ("wkt", "center"),
    [
        ("POINT (30 1)", (30.0, 1.0)),
        ("POLYGON ((30 1, 36 1, 30 7, 30 1))", (32.0, 3.0)),
        (
            "POLYGON ((0 0, 6 0, 6 6, 0 6, 0 0), (0.5 0.5, 0.5 2.5, 2.5 2.5, 2.5 0.5, 0.5 0.5))",
            (3.1875, 3.1875),
        ),
    ],
)
def test_preview_waits_for_registration_then_draws_task_centres(browsers, wkt, center):
    summary = responses.get(
        f"{BASE}/api/campaigns/40/summary", json={"registration_status": "registering"}
    )
    with pytest.raises(ToolError, match="registering"):
        asyncio.run(agent_mcp.preview_campaign(40, 1000, 1.0))

    summary.body = json.dumps({"registration_status": "ready"})
    responses.get(
        f"{BASE}/api/campaigns/40/tasks/details?first=2",
        json={"tasks": [{"id": 5, "geometry_wkt": wkt}]},
    )

    text, *_ = asyncio.run(agent_mcp.preview_campaign(40, 1000, 1.0))

    task = json.loads(text)["task"]
    assert task["task_id"] == 5
    assert (task["lon"], task["lat"]) == pytest.approx(center)
    assert len(browsers.closed) == 1


@responses.activate
def test_concurrent_previews_keep_their_pages_until_they_finish(browsers, monkeypatch):
    responses.get(f"{BASE}/api/campaigns/40/summary", json={"registration_status": "ready"})
    responses.get(
        f"{BASE}/api/campaigns/40/tasks/details?first=2",
        json={"tasks": [{"id": 5, "geometry_wkt": "POINT (30 1)"}]},
    )
    call = browsers.call
    keys = set()

    async def run():
        rendering = asyncio.Event()
        other_finished = asyncio.Event()

        async def overlapping_call(key, campaign_id, method, *args):
            keys.add(key)
            if method == "render" and not rendering.is_set():
                rendering.set()
                await other_finished.wait()
                if key in browsers.closed:
                    raise RuntimeError("The preview page was closed during rendering")
            return await call(key, campaign_id, method, *args)

        monkeypatch.setattr(browsers, "call", overlapping_call)
        first = asyncio.create_task(agent_mcp.preview_campaign(40, 1000, 1.0))
        await rendering.wait()
        try:
            second = await agent_mcp.preview_campaign(40, 1000, 1.0)
        finally:
            other_finished.set()
        return await first, second

    async def with_timeout():
        return await asyncio.wait_for(run(), timeout=5)

    results = asyncio.run(with_timeout())

    assert all(any(isinstance(item, Image) for item in result) for result in results)
    assert len(keys) == 2
    assert set(browsers.closed) == keys


@responses.activate
@pytest.mark.parametrize("dedicated", [False, True])
def test_get_campaign_identifies_dedicated_covers(browsers, dedicated):
    responses.get(
        f"{BASE}/api/campaigns/40",
        json={
            "id": 40,
            "project_id": 3,
            "imagery_sources": [
                {
                    "name": "Sentinel-2",
                    "visualizations": [{"name": "True Color"}],
                    "collections": [
                        {
                            "name": "2026",
                            "search": {"stac_collection_id": "sentinel-2-l2a"},
                            "slices": [{"start_date": "2026-01-01", "end_date": "2026-12-31"}],
                            "cover_slice_index": 0,
                            "has_dedicated_cover": dedicated,
                        }
                    ],
                }
            ],
            "basemaps": [],
            "time_series": [
                {
                    "id": 9,
                    "window_id": 2,
                    **CUSTOM_SERIES,
                    "index": {"domain_min": -1, "domain_max": 1},
                }
            ],
        },
    )
    responses.get(f"{BASE}/api/campaigns/40/task-sets", json=[])

    result = json.loads(asyncio.run(agent_mcp.get_campaign(40)))

    assert result["time_series"][0] == {
        "id": 9,
        "window_id": 2,
        **{k: v for k, v in CUSTOM_SERIES.items() if k not in ("domain_min", "domain_max")},
        "index": {"domain_min": -1, "domain_max": 1},
    }
    assert result["imagery"][0]["windows"][0] == {
        "name": "2026",
        "collection": "sentinel-2-l2a",
        "slices": ["2026-01-01 to 2026-12-31"],
        "cover_slice_index": 0,
        "has_dedicated_cover": dedicated,
    }


async def _tool_names():
    from mcp import Client

    async with Client(agent_mcp.server) as client:
        return {tool.name for tool in (await client.list_tools()).tools}


async def _call(name, arguments):
    from mcp import Client

    async with Client(agent_mcp.server) as client:
        return await client.call_tool(name, arguments)


@responses.activate
def test_only_granted_tools_are_offered_and_they_refuse_unknown_settings(monkeypatch):
    changing = {"create_campaign", "add_tasks", "edit_campaign", "edit_imagery", "edit_timeseries"}
    assert not changing & asyncio.run(_tool_names())

    monkeypatch.setattr(agent_mcp, "_ALLOWED", {"edit_campaign"})
    for name in changing:
        agent_mcp._grantable_tool(getattr(agent_mcp, name))
    patched = responses.patch(f"{BASE}/api/campaigns/40", json={"settings": {}})
    try:
        assert changing & asyncio.run(_tool_names()) == {"edit_campaign"}
        result = asyncio.run(_call("edit_campaign", {"campaign_id": 40, "settings": {"nmae": 1}}))
    finally:
        agent_mcp.server.remove_tool("edit_campaign")

    assert result.is_error and "nmae" in result.content[0].text
    assert not patched.calls

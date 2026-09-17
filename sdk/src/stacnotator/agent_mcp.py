"""MCP server that lets a model work through a STACNotator campaign as a labelling agent.

Log in once with `stacnotator.login(url)`, then run `python -m stacnotator.agent_mcp`
(stdio). One server process can drive many agents, so every tool after registration
takes the agent_id it acts for. Views are drawn by a headless browser page per agent that
this process runs; nothing is rendered on the server.
"""

import asyncio
import base64
import contextlib
import functools
import json
import subprocess
from collections.abc import Callable
from typing import Any

from mcp.server.mcpserver import Image, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from typing_extensions import Required, TypedDict

from stacnotator import _credentials
from stacnotator._http import Http
from stacnotator._render_browsers import ChromiumMissingError, RenderBrowsers, install_chromium
from stacnotator.client import Client
from stacnotator.errors import StacnotatorError


class ViewCell(TypedDict, total=False):
    """Exactly one of slice_id (optionally with visualization), basemap_id or
    timeseries_ids; zoom overrides the view's zoom for this cell only. Time series cells
    take remove_cloudy (drop cloud-flagged observations) and smoothed (Savitzky-Golay line).
    """

    slice_id: int
    visualization: str
    basemap_id: int
    timeseries_ids: list[int]
    remove_cloudy: bool
    smoothed: bool
    zoom: float


class ViewSpec(TypedDict, total=False):
    """One packed image: cells in a grid, each centred on the task point.
    columns 1-8 (default 4), cell_px 96-1024 (default 320), zoom 1-22 (default 15),
    columns * cell_px <= 2048, at most 36 cells."""

    cells: Required[list[ViewCell]]
    columns: int
    cell_px: int
    zoom: float


server = MCPServer(
    "stacnotator",
    instructions=(
        "Label STACNotator campaign tasks from rendered imagery. Register one agent per "
        "worker, read the campaign guide in its context, then loop next_task -> "
        "(get_views) -> submit_label or skip_task, always passing your own agent_id."
    ),
)

# Kept for the life of this process only: a restarted server falls back to the built-in
# default views and asks next_task for the current task again.
_agents: dict[str, dict[str, Any]] = {}
_default_views: dict[str, list[ViewSpec]] = {}
_current_tasks: dict[str, dict[str, Any]] = {}
# Task assignment locks the campaign's whole open pool, so a registration running alongside
# another would find every task taken and get none.
_registering = asyncio.Lock()


@functools.cache
def _http() -> Http:
    return Client()._http


@functools.cache
def _browsers() -> RenderBrowsers:
    creds = _credentials.load()
    if creds is None:
        raise ToolError("Not logged in: run stacnotator.login(url) first.")
    return RenderBrowsers(creds.url, lambda: asyncio.to_thread(_http().token))


async def _api(call: Callable[..., Any], *args: Any) -> Any:
    try:
        return await asyncio.to_thread(call, *args)
    except StacnotatorError as exc:
        raise ToolError(str(exc)) from exc


async def _agent(agent_id: str) -> dict[str, Any]:
    if agent_id not in _agents:
        _agents[agent_id] = await _api(_http().get, f"/agents/{agent_id}")
    return _agents[agent_id]


async def _on_page(agent_id: str, method: str, *args: Any) -> Any:
    agent = await _agent(agent_id)
    try:
        return await _browsers().call(agent_id, agent["campaign_id"], method, *args)
    except ChromiumMissingError as exc:
        raise ToolError(str(exc)) from exc
    except Exception as exc:
        raise ToolError(f"The render browser failed: {exc}") from exc


async def _views_of(agent_id: str) -> list[ViewSpec]:
    if agent_id not in _default_views:
        _default_views[agent_id] = await _on_page(agent_id, "defaultViews")
    return _default_views[agent_id]


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"))


def _without_none(body: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in body.items() if value is not None}


async def _bundle(
    agent_id: str, summary: dict[str, Any], rendered: list[dict[str, Any]]
) -> list[str | Image]:
    """The task and one entry per view as text, then the drawn images in order. Each view
    entry names the image it corresponds to, since failed views have none."""
    images: list[str | Image] = []
    views = []
    for view in rendered:
        entry: dict[str, Any] = {"view": view["view"]}
        if "image_base64" in view:
            images.append(Image(data=base64.b64decode(view["image_base64"]), format="jpeg"))
            entry["image"] = len(images)
            entry["meta"] = view["meta"]
        else:
            entry["error"] = view["error"]
        views.append(entry)

    drawn = [view["image_base64"] for view in rendered if "image_base64" in view]
    agent = await _agent(agent_id)
    # Watching is a side show: a closed window never fails the agent's call.
    with contextlib.suppress(Exception):
        await _browsers().show(agent["name"], summary["task"]["task_id"], drawn)
    return [_json({**summary, "views": views}), *images]


@server.tool(structured_output=False)
async def list_campaigns() -> str:
    """Campaigns you can access (id, name, your role). Use it to ask the user which one to
    label when they did not say."""
    return _json((await _api(_http().get, "/campaigns/"))["items"])


@server.tool(structured_output=False)
async def list_agents(campaign_id: int) -> str:
    """A campaign's total_tasks, open_tasks (neither assigned nor labelled: what new agents
    can be given) and your agents on it with their assigned and remaining counts."""
    return _json(await _api(_http().get, f"/campaigns/{campaign_id}/agents"))


@server.tool(structured_output=False)
async def register_agent(
    campaign_id: int,
    name: str,
    description: str | None = None,
    task_count: int = 10,
    task_set_id: int | None = None,
    takes_over_work: bool = False,
    default_views: list[ViewSpec] | None = None,
) -> str:
    """Create a labelling agent on a campaign and assign it task_count tasks.

    name: 1-20 chars of letters, digits, ".", "_" or "-". Register one agent per worker;
    never share an agent_id between workers.
    takes_over_work: when this agent runs out of tasks, next_task moves a task over from
    your other agents on the campaign that still have work queued.
    default_views: up to 4 views next_task returns for every task, drawn ahead for the
    tasks after it. Omit for a built-in overview; change later with set_default_views.

    Returns the agent (keep agent_id), the campaign context (guide, labels, form fields,
    imagery slices, basemaps, time series) and the default views. When the render browser
    cannot start, render_browser says why instead: follow it, and never register again.
    """
    async with _registering:
        agent = await _api(
            _http().post,
            f"/campaigns/{campaign_id}/agents",
            _without_none(
                {
                    "name": name,
                    "description": description,
                    "task_count": task_count,
                    "task_set_id": task_set_id,
                    "takes_over_work": takes_over_work,
                }
            ),
        )
    agent_id = agent["agent_id"]
    _agents[agent_id] = agent
    if default_views:
        _default_views[agent_id] = default_views
    try:
        context = await _on_page(agent_id, "context")
        views = await _views_of(agent_id)
    except ToolError as exc:
        # The agent exists either way: registering again would make a second one.
        note = f"{exc} Once that is solved, call campaign_context with this agent_id."
        return _json({"agent": agent, "render_browser": note})
    return _json({"agent": agent, "context": context, "default_views": views})


@server.tool(structured_output=False)
async def campaign_context(agent_id: str) -> str:
    """The agent's campaign: guide_markdown, labels (use their ids), form_fields, imagery
    sources with collections and slices (slice ids, dates, visualizations, max_native_zoom),
    basemaps and time series. Read it before labelling."""
    return _json(await _on_page(agent_id, "context"))


@server.tool(structured_output=False)
async def set_default_views(agent_id: str, views: list[ViewSpec]) -> str:
    """Replace the agent's default views (1-4): what next_task returns for every task and
    what is drawn ahead for the tasks after it. Set them once the first tasks show what is
    worth looking at in this campaign; one-off detail belongs in get_views."""
    if not 1 <= len(views) <= 4:
        raise ToolError("Pass 1-4 views.")
    _default_views[agent_id] = views
    return _json(views)


@server.tool(structured_output=False)
async def next_task(agent_id: str) -> list[str | Image]:
    """The agent's next open task with its default views drawn. The same views are drawn
    ahead for the tasks after it, so this is usually quick.

    Returns JSON {task, remaining, views}, then the images. Each view entry has its spec and
    either image (1-based position among the returned images) with meta (per-cell captions,
    zoom, meters_per_pixel, time series values) or an error. task null means every assigned
    task is done. The same task is returned until it is labelled or skipped.
    """
    result = await _api(_http().post, f"/agents/{agent_id}/next", {})
    if not result["tasks"]:
        _current_tasks.pop(agent_id, None)
        return [_json({"task": None, "remaining": 0, "note": "All assigned tasks are done."})]
    task, *upcoming = result["tasks"]
    _current_tasks[agent_id] = task
    views = await _views_of(agent_id)
    rendered = await _on_page(agent_id, "render", task, views)
    await _on_page(agent_id, "preload", upcoming, views)
    return await _bundle(agent_id, {"task": task, "remaining": result["remaining"]}, rendered)


@server.tool(structured_output=False)
async def get_views(agent_id: str, task_id: int, views: list[ViewSpec]) -> list[str | Image]:
    """Draw more views of the agent's current task: finer slices, higher zoom, other
    visualizations or basemaps. Up to 8 views; same return shape as next_task."""
    task = _current_tasks.get(agent_id)
    if task is None or task["task_id"] != task_id:
        raise ToolError(f"Task {task_id} is not this agent's current task: call next_task.")
    if not 1 <= len(views) <= 8:
        raise ToolError("Pass 1-8 views.")
    rendered = await _on_page(agent_id, "render", task, views)
    return await _bundle(agent_id, {"task": task}, rendered)


@server.tool(structured_output=False)
async def submit_label(
    agent_id: str,
    task_id: int,
    label_id: int,
    confidence: int | None = None,
    comment: str | None = None,
    form_values: dict[str, Any] | None = None,
    flagged_for_review: bool = False,
    flag_comment: str | None = None,
) -> str:
    """Label a task.

    label_id: an id from the context's labels. confidence: 0-10, honest.
    comment: short note on the evidence used (which views, dates, cues).
    form_values: keyed by form field id as a string; category -> option id,
    multicategory -> list of option ids, number, text, date "YYYY-MM-DD",
    daterange {"start", "end"}. Required fields must be filled.
    flagged_for_review: set when a human should check this label, with flag_comment.
    """
    return await _annotate(
        agent_id,
        task_id,
        _without_none(
            {
                "label_id": label_id,
                "confidence": confidence,
                "comment": comment,
                "form_values": form_values,
                "flagged_for_review": flagged_for_review,
                "flag_comment": flag_comment,
            }
        ),
    )


@server.tool(structured_output=False)
async def skip_task(agent_id: str, task_id: int, comment: str) -> str:
    """Skip a task that cannot be labelled with confidence (no usable imagery, clouds,
    outside the guide's classes). comment says why."""
    return await _annotate(agent_id, task_id, {"label_id": None, "comment": comment})


async def _annotate(agent_id: str, task_id: int, body: dict[str, Any]) -> str:
    # A skip is label_id None, sent as null.
    result = await _api(_http().post, f"/agents/{agent_id}/tasks/{task_id}/annotate", body)
    _current_tasks.pop(agent_id, None)
    return _json(result)


@server.tool(structured_output=False)
async def release_tasks(campaign_id: int, agent_id: str | None = None) -> str:
    """Give unfinished tasks back to the campaign's open pool: those of one agent
    (agent_id), or of all your agents on the campaign. Labelled and skipped tasks are kept.
    Use it when a run is stopped before its agents finish."""
    query = f"?agent_id={agent_id}" if agent_id else ""
    return _json(
        await _api(_http().post, f"/campaigns/{campaign_id}/agents/release-tasks{query}", {})
    )


@server.tool(structured_output=False)
async def watch_agents() -> str:
    """Open a browser window on the user's screen showing the latest views of every agent
    as they are drawn. Only when the user asks to watch."""
    try:
        await _browsers().open_watch_window()
    except ChromiumMissingError as exc:
        raise ToolError(str(exc)) from exc
    except Exception as exc:
        raise ToolError(f"Could not open the watch window: {exc}") from exc
    return "The watch window is open."


@server.tool(structured_output=False)
async def install_render_browsers() -> str:
    """Download Chromium for the headless render pages (about 150 MB, once).

    Only call this after the user has approved the download. It can take a few minutes."""
    try:
        return await asyncio.to_thread(install_chromium)
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
        raise ToolError(str(exc)) from exc


if __name__ == "__main__":
    server.run()

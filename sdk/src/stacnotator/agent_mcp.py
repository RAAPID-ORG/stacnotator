"""MCP server that lets a model work through a STACNotator campaign as a labelling agent.

Log in once with `stacnotator.login(url)`, then run `python -m stacnotator.agent_mcp`
(stdio). One server process can drive many agents, so every tool after registration
takes the agent_id it acts for.
"""

import base64
import functools
import json
import subprocess
from typing import Any

from mcp.server.mcpserver import Image, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from typing_extensions import Required, TypedDict

from stacnotator import _credentials, _render_browsers
from stacnotator._http import DEFAULT_TIMEOUT_SECONDS, Http
from stacnotator._render_browsers import RenderBrowsers
from stacnotator.client import Client
from stacnotator.errors import StacnotatorError

# The API holds next/views open for up to ~120s while the render host draws.
RENDER_TIMEOUT_SECONDS = 200.0


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
    columns * cell_px <= 2048."""

    cells: Required[list[ViewCell]]
    columns: int
    cell_px: int
    zoom: float


server = MCPServer(
    "stacnotator",
    instructions=(
        "Label STACNotator campaign tasks from rendered imagery. Register one agent per "
        "worker, read the campaign guide in its context, then loop next_task -> "
        "(get_views) -> submit_label or skip_task, always passing your own agent_id. "
        "Asked for several parallel workers, register one agent per worker with the tasks "
        "split evenly and takes_over_work on, then run one subagent per agent. Call "
        "render_capacity before recommending how many agents to run."
    ),
)


@functools.cache
def _http() -> Http:
    return Client()._http


@functools.cache
def _render_browsers_manager() -> RenderBrowsers | None:
    creds = _credentials.load()
    if not _render_browsers.PLAYWRIGHT_INSTALLED or creds is None:
        return None
    return RenderBrowsers(creds.url, _http().token)


@functools.cache
def _campaign_of(agent_id: str) -> int:
    campaign_id: int = _http().get(f"/agents/{agent_id}")["campaign_id"]
    return campaign_id


def _ensure_render_browser(agent_id: str, campaign_id: int | None = None) -> str | None:
    """Start a headless render page for the agent. Browser trouble becomes a note for the
    model, never a failed tool call: the Agents page can still draw the views."""
    try:
        browsers = _render_browsers_manager()
        if browsers is None:
            missing = not _render_browsers.PLAYWRIGHT_INSTALLED and campaign_id is not None
            return _render_browsers.PIP_NOTE if missing else None
        return browsers.ensure(
            campaign_id if campaign_id is not None else _campaign_of(agent_id), agent_id
        )
    except _render_browsers.ChromiumMissingError as exc:
        return str(exc) if campaign_id is not None else None
    except Exception as exc:
        return (
            f"Could not start a headless render browser ({exc}). Views are drawn only while "
            'the campaign\'s Agents page is open with "Render in this tab" switched on.'
        )


def _get(path: str) -> Any:
    try:
        return _http().get(path)
    except StacnotatorError as exc:
        raise ToolError(str(exc)) from exc


def _post(path: str, body: dict[str, Any], timeout: float = DEFAULT_TIMEOUT_SECONDS) -> Any:
    try:
        return _http().post(path, json=body, timeout=timeout)
    except StacnotatorError as exc:
        raise ToolError(str(exc)) from exc


def _patch(path: str, body: dict[str, Any]) -> Any:
    try:
        return _http().patch(path, json=body)
    except StacnotatorError as exc:
        raise ToolError(str(exc)) from exc


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"))


def _without_none(body: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in body.items() if value is not None}


def _bundle(result: dict[str, Any], render_note: str | None) -> list[str | Image]:
    """The task and one entry per requested view as text, then the drawn images in order.
    Each view entry names the image it corresponds to, since failed views have none."""
    images: list[str | Image] = []
    views = []
    for view in result["views"]:
        entry = {"status": view["status"], "view": view["view"]}
        if view["status"] == "done" and view.get("image_base64"):
            images.append(
                Image(
                    data=base64.b64decode(view["image_base64"]),
                    format=(view.get("mime_type") or "image/png").removeprefix("image/"),
                )
            )
            entry["image"] = len(images)
            entry["meta"] = view.get("meta")
        else:
            entry["error"] = view.get("error")
        views.append(entry)

    summary: dict[str, Any] = {
        "task": result["task"],
        "remaining": result["remaining"],
        "views": views,
    }
    if result["task"] is None:
        summary["note"] = "All assigned tasks are done. Call request_tasks to get more."
    if render_note:
        summary["render_browsers"] = render_note
    return [_json(summary), *images]


@server.tool(structured_output=False)
def register_agent(
    campaign_id: int,
    name: str,
    description: str | None = None,
    task_count: int = 10,
    task_set_id: int | None = None,
    default_views: list[ViewSpec] | None = None,
    takes_over_work: bool = False,
) -> str:
    """Create a labelling agent on a campaign and assign it task_count tasks.

    name: 1-20 chars of letters, digits, ".", "_" or "-". Register one agent per worker;
    never share an agent_id between workers.
    default_views: up to 4 views next_task returns for every task, drawn ahead for upcoming
    tasks; change them later with set_default_views. Omit for a sensible overview (recent
    period covers plus the time series, and a basemap context/detail pair).
    takes_over_work: when this agent runs out of tasks, next_task moves a task over from
    your other agents on the campaign that still have work queued (the owner can also
    toggle this per agent on the Agents page).

    Returns the agent (keep agent_id), the campaign context (guide, labels, form fields,
    imagery slices, basemaps, time series), the default views, render_host_url (the
    campaign's Agents page, where the user watches what agents see) and render_browsers,
    a note on the headless browsers that draw the views. Follow that note when it asks you
    to check with the user.
    """
    result = _post(
        f"/campaigns/{campaign_id}/agents",
        _without_none(
            {
                "name": name,
                "description": description,
                "task_count": task_count,
                "task_set_id": task_set_id,
                "default_views": default_views,
                "takes_over_work": takes_over_work,
            }
        ),
    )
    creds = _credentials.load()
    if creds is not None:
        result["render_host_url"] = creds.url + result["agent"]["render_host_path"]
    result["render_browsers"] = (
        _ensure_render_browser(result["agent"]["agent_id"], campaign_id)
        or "A headless render browser already draws this campaign's views."
    )
    return _json(result)


@server.tool(structured_output=False)
def list_agents(campaign_id: int) -> str:
    """Your agents on a campaign with their assigned and remaining task counts."""
    return _json(_get(f"/campaigns/{campaign_id}/agents"))


@server.tool(structured_output=False)
def campaign_context(agent_id: str) -> str:
    """The agent's campaign: guide_markdown, labels (use their ids), form_fields, imagery
    sources with collections and slices (slice ids, dates, visualizations, max_native_zoom),
    basemaps and time series. Read it before labelling."""
    return _json(_get(f"/agents/{agent_id}/context"))


@server.tool(structured_output=False)
def request_tasks(agent_id: str, count: int, task_set_id: int | None = None) -> str:
    """Assign count more tasks to the agent (optionally from one task set).
    Returns the agent with its updated assigned and remaining counts."""
    return _json(
        _post(
            f"/agents/{agent_id}/tasks", _without_none({"count": count, "task_set_id": task_set_id})
        )
    )


@server.tool(structured_output=False)
def list_campaigns() -> str:
    """Campaigns you can access (id, name, your role). Use it to ask the user which one to
    label when they did not say."""
    return _json(_get("/campaigns/")["items"])


@server.tool(structured_output=False)
def campaign_work(campaign_id: int) -> str:
    """How much work a campaign has for agents: total_tasks, open_tasks (neither assigned
    nor labelled, which is what new agents can be given) and your existing agents. Read it
    before registering agents to size the run."""
    return _json(_get(f"/campaigns/{campaign_id}/agents/work"))


@server.tool(structured_output=False)
def set_default_views(agent_id: str, views: list[ViewSpec]) -> str:
    """Replace the agent's default views (1-4): what next_task returns for every task and
    what is drawn ahead for the tasks after it. Set them once the first tasks show what is
    worth looking at in this campaign; one-off detail belongs in get_views."""
    return _json(_patch(f"/agents/{agent_id}", {"default_views": views}))


@server.tool(structured_output=False)
def release_tasks(agent_id: str | None = None, campaign_id: int | None = None) -> str:
    """Give unfinished tasks back to the campaign's open pool: those of one agent
    (agent_id), or of all your agents on a campaign (campaign_id). Labelled and skipped
    tasks are kept. Use it when a run is stopped before its agents finish."""
    if (agent_id is None) == (campaign_id is None):
        raise ToolError("Pass exactly one of agent_id or campaign_id.")
    path = (
        f"/agents/{agent_id}/release-tasks"
        if agent_id is not None
        else f"/campaigns/{campaign_id}/agents/release-tasks"
    )
    return _json(_post(path, {}))


@server.tool(structured_output=False)
def next_task(agent_id: str) -> list[str | Image]:
    """The agent's next open task with its default views rendered, waiting up to ~2 minutes.
    The defaults are drawn ahead for upcoming tasks, so this is usually instant.

    Returns JSON {task, remaining, views}, then the images. Each view entry has a status,
    its spec, and either image (1-based position among the returned images) with meta
    (per-cell captions, zoom, meters_per_pixel, time series values) or an error.
    task null means every assigned task is done. The same task is returned until it is
    labelled or skipped.
    """
    render_note = _ensure_render_browser(agent_id)
    return _bundle(
        _post(
            f"/agents/{agent_id}/next",
            {},
            timeout=RENDER_TIMEOUT_SECONDS,
        ),
        render_note,
    )


@server.tool(structured_output=False)
def get_views(agent_id: str, task_id: int, views: list[ViewSpec]) -> list[str | Image]:
    """Render more views of the agent's open task: finer slices, higher zoom, other
    visualizations or basemaps. Up to 8 views; same return shape as next_task."""
    render_note = _ensure_render_browser(agent_id)
    return _bundle(
        _post(
            f"/agents/{agent_id}/tasks/{task_id}/views",
            {"views": views},
            timeout=RENDER_TIMEOUT_SECONDS,
        ),
        render_note,
    )


@server.tool(structured_output=False)
def submit_label(
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
    return _json(
        _post(
            f"/agents/{agent_id}/tasks/{task_id}/annotate",
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
    )


@server.tool(structured_output=False)
def skip_task(agent_id: str, task_id: int, comment: str) -> str:
    """Skip a task that cannot be labelled with confidence (no usable imagery, clouds,
    outside the guide's classes). comment says why."""
    return _json(
        _post(
            f"/agents/{agent_id}/tasks/{task_id}/annotate",
            {"label_id": None, "comment": comment},
        )
    )


@server.tool(structured_output=False)
def install_render_browsers() -> str:
    """Download Chromium for the headless render browsers (about 150 MB, once).

    Only call this after the user has approved the download. It can take a few minutes."""
    if not _render_browsers.PLAYWRIGHT_INSTALLED:
        raise ToolError(_render_browsers.PIP_NOTE)
    try:
        return _render_browsers.install_chromium()
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
        raise ToolError(str(exc)) from exc


@server.tool(structured_output=False)
def render_capacity() -> str:
    """How many agents this machine can draw views for: cpu cores, available memory, the
    estimated number of parallel render pages, the cap in effect (STACNOTATOR_MAX_RENDER_BROWSERS
    overrides it) and the pages running. recommended_max_agents is the cap, since each agent
    gets its own page; more agents still work but share pages and wait for each other."""
    cpu_count, memory_mb = _render_browsers.machine_resources()
    browsers = _render_browsers_manager()
    cap = browsers.max_pages if browsers else _render_browsers.render_page_cap()
    result: dict[str, Any] = {
        "cpu_cores": cpu_count,
        "available_memory_mb": memory_mb,
        "estimated_max_render_pages": _render_browsers.estimate_render_capacity(
            cpu_count, memory_mb
        ),
        "render_page_cap": cap,
        "render_pages_running": 0,
        "recommended_max_agents": cap,
    }
    if not _render_browsers.PLAYWRIGHT_INSTALLED:
        result["note"] = _render_browsers.PIP_NOTE
    elif browsers is not None:
        status = browsers.status()
        result["render_pages_running"] = status["pages_running"]
        result["pages"] = status["pages"]
        if status["closed_after_error"]:
            result["closed_after_error"] = status["closed_after_error"]
    return _json(result)


if __name__ == "__main__":
    server.run()

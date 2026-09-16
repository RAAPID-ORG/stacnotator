"""MCP server that lets a model work through a STACNotator campaign as a labelling agent.

Log in once with `stacnotator.login(url)`, then run `python -m stacnotator.agent_mcp`
(stdio). One server process can drive many agents, so every tool after registration
takes the agent_id it acts for.
"""

import base64
import functools
import json
from typing import Any

from mcp.server.mcpserver import Image, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from typing_extensions import Required, TypedDict

from stacnotator import _credentials
from stacnotator._http import DEFAULT_TIMEOUT_SECONDS, Http
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
        "(get_views) -> submit_label or skip_task, always passing your own agent_id."
    ),
)


@functools.cache
def _http() -> Http:
    return Client()._http


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


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"))


def _without_none(body: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in body.items() if value is not None}


def _bundle(result: dict[str, Any]) -> list[str | Image]:
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
    return [_json(summary), *images]


@server.tool(structured_output=False)
def register_agent(
    campaign_id: int,
    name: str,
    description: str | None = None,
    task_count: int = 10,
    task_set_id: int | None = None,
    default_views: list[ViewSpec] | None = None,
) -> str:
    """Create a labelling agent on a campaign and assign it task_count tasks.

    name: 1-20 chars of letters, digits, ".", "_" or "-". Register one agent per worker;
    never share an agent_id between workers.
    default_views: up to 4 views rendered for every task when next_task is called without
    views. Omit to get a sensible overview (every period's cover plus time series, and a
    basemap context/detail pair).

    Returns the agent (keep agent_id), the campaign context (guide, labels, form fields,
    imagery slices, basemaps, time series), the default views, and the render host URL.
    Images are drawn by a browser tab the owner keeps open at render_host_url.
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
            }
        ),
    )
    creds = _credentials.load()
    if creds is not None:
        result["render_host_url"] = creds.url + result["agent"]["render_host_path"]
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
def next_task(agent_id: str, views: list[ViewSpec] | None = None) -> list[str | Image]:
    """The agent's next open task with its views rendered, waiting up to ~2 minutes.

    views: up to 8 view specs; omit for the agent's default views (usually ready at once).
    Returns JSON {task, remaining, views}, then the images. Each view entry has a status,
    its spec, and either image (1-based position among the returned images) with meta
    (per-cell captions, zoom, meters_per_pixel, time series values) or an error.
    task null means every assigned task is done. The same task is returned until it is
    labelled or skipped.
    """
    return _bundle(
        _post(
            f"/agents/{agent_id}/next",
            _without_none({"views": views}),
            timeout=RENDER_TIMEOUT_SECONDS,
        )
    )


@server.tool(structured_output=False)
def get_views(agent_id: str, task_id: int, views: list[ViewSpec]) -> list[str | Image]:
    """Render more views of the agent's open task: finer slices, higher zoom, other
    visualizations or basemaps. Up to 8 views; same return shape as next_task."""
    return _bundle(
        _post(
            f"/agents/{agent_id}/tasks/{task_id}/views",
            {"views": views},
            timeout=RENDER_TIMEOUT_SECONDS,
        )
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


if __name__ == "__main__":
    server.run()

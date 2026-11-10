"""MCP server that lets a model set up STACNotator campaigns and work through them as a
labelling agent.

Run `stacnotator-mcp` (or `python -m stacnotator.agent_mcp`) over stdio; the model signs in
with the `login` tool. One server process can drive many agents, so every tool after registration
takes the agent_id it acts for. Views are drawn by a headless browser page per agent that
this process runs; nothing is rendered on the server.
"""

import asyncio
import base64
import contextlib
import functools
import itertools
import json
import os
import secrets
import subprocess
from collections.abc import Callable
from typing import Any, Literal, cast
from urllib.parse import urlparse
from uuid import uuid4

from mcp.server.mcpserver import Image, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import ConfigDict
from shapely.wkt import loads
from typing_extensions import Required, TypedDict

from stacnotator import _credentials
from stacnotator._http import Http
from stacnotator._render_browsers import ChromiumMissingError, RenderBrowsers, install_chromium
from stacnotator.campaign import Campaign
from stacnotator.client import Client
from stacnotator.client import login as sdk_login
from stacnotator.errors import NotLoggedInError, StacnotatorError


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
    at most 36 cells. Cells shrink until the image fits the agent's image limits."""

    cells: Required[list[ViewCell]]
    columns: int
    cell_px: int
    zoom: float


class RecipeSlice(TypedDict, total=False):
    """A date range, YYYY-MM-DD, both ends included; name defaults to the dates."""

    start: Required[str]
    end: Required[str]
    name: str


class RecipeWindow(TypedDict):
    """One collection of the source: the slices annotators step through, in order, and its
    cover, which default views show for the window: a slice index, or a dedicated date
    range composited from its least cloudy images."""

    name: str
    slices: list[RecipeSlice]
    cover: int | RecipeSlice


class ImageryRecipe(TypedDict, total=False):
    """One imagery source over a collection from setup_options, its windows spelled out.
    visualizations: names from the collection's list (True Color and False Color when
    omitted). max_cloud_cover: 0-100, default 90. name: defaults to the collection's."""

    collection: Required[str]
    windows: Required[list[RecipeWindow]]
    visualizations: list[str]
    max_cloud_cover: float
    name: str


class TimeseriesSpec(TypedDict, total=False):
    """A time series chart sampled at each task. data_source: a key from setup_options'
    timeseries sources; ts_type: one of that source's index_keys. start_ym, end_ym: YYYYMM."""

    name: Required[str]
    data_source: Required[str]
    ts_type: Required[str]
    start_ym: Required[str]
    end_ym: Required[str]


class CampaignSettings(TypedDict, total=False):
    """A new campaign needs name, labels and the bbox; an edit gives only what changes.
    labels: every label, [{"id", "name", "geometry_type": "point"|"polygon"|"line"}], ids
    from 1; a label keeps its id when renamed and cannot be removed. bbox_west, _south,
    _east, _north: WGS84 degrees, all four together. guide_markdown: the guide labellers
    and agents read. task_output: classify (a label per task) or draw (shapes per task).
    sample_extent_meters: the square drawn around each task. form_fields: extra questions
    per task, in the campaign's form field schema. embedding_year: year of satellite
    embeddings for similarity search. In an edit, null clears sample_extent_meters or
    embedding_year. labelling_policy: who labels each task and how
    their answers are agreed."""

    __pydantic_config__ = ConfigDict(extra="forbid")  # type: ignore[misc]
    name: str
    labels: list[dict[str, Any]]
    bbox_west: float
    bbox_south: float
    bbox_east: float
    bbox_north: float
    guide_markdown: str
    task_output: Literal["classify", "draw"]
    sample_extent_meters: float | None
    form_fields: list[dict[str, Any]]
    embedding_year: int | None
    labelling_policy: dict[str, Any]


class SamplingSpec(TypedDict, total=False):
    """random: num_samples points. grid: a lattice spacing_km apart. Drawn across the
    campaign box; seed makes either reproducible."""

    strategy_type: Required[Literal["random", "grid"]]
    num_samples: int
    spacing_km: float
    seed: int


class ProbePoint(TypedDict, total=False):
    """Either reply, image, x and y: a pixel of an image you were shown for this task (x right,
    y down from that image's top-left corner, in its own pixels), on a map cell. Or lat and
    lon."""

    reply: int
    image: int
    x: float
    y: float
    lat: float
    lon: float


server = MCPServer(
    "stacnotator",
    instructions=(
        "Set up STACNotator campaigns and label their tasks from rendered imagery. Tools "
        "that create or change campaigns (create_campaign, add_tasks, edit_campaign, "
        "edit_imagery) are only here when the user granted them; when one you need is "
        "missing, tell the user it was not granted and never make the change another way, "
        "such as through the SDK or the API. Before any such change, follow the "
        "stacnotator-campaign-setup skill: never invent the area, the period or the labels; "
        "ask the user and make the change only once they accept your proposal. Then "
        "get_campaign until imagery is ready -> "
        "preview_campaign. To label: register one agent per worker, read the campaign "
        "guide in its context, then loop next_task -> (get_views, probe_timeseries) -> "
        "submit_label or skip_task, always passing your own agent_id."
    ),
)

# Kept for the life of this process only: a restarted server falls back to the built-in
# default views and asks next_task for the current task again.
_agents: dict[str, dict[str, Any]] = {}
_default_views: dict[str, list[ViewSpec]] = {}
_current_tasks: dict[str, dict[str, Any]] = {}
_image_limits: dict[str, dict[str, float]] = {}
# The views behind the images of each agent's recent replies, by reply number, at the size
# they were drawn and with the task they are centred on, so a probe's pixel can be turned
# back into a place.
_replies: dict[str, dict[int, tuple[int, list[ViewSpec]]]] = {}
KEPT_REPLIES = 8
# Numbers start somewhere new in each process, so a number from before a restart is refused
# rather than matched to a different image.
_reply_numbers = itertools.count(100_000 + secrets.randbelow(900_000))
# Task assignment locks the campaign's whole open pool, so a registration running alongside
# another would find every task taken and get none.
_registering = asyncio.Lock()


# The deployment the user named in this session. A login saved earlier never picks one:
# labelling on the wrong STACNotator writes real annotations there.
_session_url: str | None = None
NO_DEPLOYMENT = (
    "No STACNotator deployment chosen in this session. Ask the user for the full URL to label "
    "on (like https://stacnotator.example.org), never assume or reuse one, then call login(url)."
)


def _http() -> Http:
    if _session_url is None:
        raise ToolError(NO_DEPLOYMENT)
    return _signed_in_http()


@functools.cache
def _signed_in_http() -> Http:
    try:
        return Client()._http
    except NotLoggedInError as exc:
        raise ToolError(NO_DEPLOYMENT) from exc


def _browsers() -> RenderBrowsers:
    if _session_url is None:
        raise ToolError(NO_DEPLOYMENT)
    return _render_browsers(_session_url)


@functools.cache
def _render_browsers(app_url: str) -> RenderBrowsers:
    return RenderBrowsers(app_url, lambda: asyncio.to_thread(_http().token))


def _full_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ToolError(
            "login needs the full URL the user gave, with http:// or https:// "
            "(like https://stacnotator.example.org). Ask the user for it."
        )
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}"


def _sign_in(url: str) -> dict[str, Any]:
    creds = _credentials.load()
    if creds is not None and creds.url == url:
        try:
            me: dict[str, Any] = Client().whoami()
            return me
        except StacnotatorError:
            pass
    result: dict[str, Any] = sdk_login(url)
    return result


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


def _limits_of(agent_id: str) -> dict[str, float]:
    if agent_id not in _image_limits:
        raise ToolError(
            "This agent's image limits are not known to this MCP server (it was registered "
            "before a restart): call set_image_limits first."
        )
    return _image_limits[agent_id]


def _limits(max_image_edge_px: int, max_image_megapixels: float) -> dict[str, float]:
    if max_image_edge_px < 96 or max_image_megapixels <= 0:
        raise ToolError("Image limits must be at least 96 px and more than 0 megapixels.")
    return {"max_edge_px": max_image_edge_px, "max_megapixels": max_image_megapixels}


def _agents_page(agent: dict[str, Any]) -> str:
    return f"{_session_url}/projects/{agent['project_id']}/campaigns/{agent['campaign_id']}/agents"


def _json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"))


def _without_none(body: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in body.items() if value is not None}


def _pack(
    summary: dict[str, Any], rendered: list[dict[str, Any]], agent_id: str | None = None
) -> list[str | Image]:
    """The summary and one entry per view as text, then the drawn images in order. Each view
    entry names the image it corresponds to, since failed views have none."""
    images: list[str | Image] = []
    views = []
    shown: list[ViewSpec] = []
    for view in rendered:
        entry: dict[str, Any] = {"view": view["view"]}
        if "image_base64" in view:
            images.append(Image(data=base64.b64decode(view["image_base64"]), format="jpeg"))
            entry["image"] = len(images)
            entry["meta"] = view["meta"]
            grid = view["meta"].get("grid", {})
            shown.append(cast(ViewSpec, {**view["view"], **grid}))
        else:
            entry["error"] = view["error"]
        views.append(entry)
    reply: dict[str, Any] = {}
    if shown and agent_id is not None:
        number = next(_reply_numbers)
        kept = _replies.setdefault(agent_id, {})
        kept[number] = (summary["task"]["task_id"], shown)
        for old in list(kept)[:-KEPT_REPLIES]:
            del kept[old]
        reply = {"reply": number}
    return [_json({**reply, **summary, "views": views}), *images]


async def _bundle(
    agent_id: str, summary: dict[str, Any], rendered: list[dict[str, Any]]
) -> list[str | Image]:
    drawn = [view["image_base64"] for view in rendered if "image_base64" in view]
    agent = await _agent(agent_id)
    # Watching is a side show: a closed window never fails the agent's call.
    with contextlib.suppress(Exception):
        await _browsers().show(agent["name"], summary["task"]["task_id"], drawn)
    return _pack(summary, rendered, agent_id)


@server.tool(structured_output=False)
async def login(url: str) -> str:
    """Choose the STACNotator deployment for this session and sign in to it. Required before
    any other tool. url: the full web app address the user gave you (https://...). Always
    ask the user which deployment to use; never assume one or reuse one from an earlier
    session. Opens a browser tab to sign in when needed."""
    global _session_url
    url = _full_url(url)
    _signed_in_http.cache_clear()
    try:
        me = await asyncio.to_thread(_sign_in, url)
    except StacnotatorError as exc:
        raise ToolError(str(exc)) from exc
    if url != _session_url:
        for state in (_agents, _default_views, _current_tasks, _image_limits, _replies):
            state.clear()
    _session_url = url
    _signed_in_http.cache_clear()
    return _json({"deployment": url, "signed_in_as": me.get("display_name") or me.get("email")})


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
    max_image_edge_px: int,
    max_image_megapixels: float,
    description: str | None = None,
    task_count: int = 10,
    task_set_id: int | None = None,
    takes_over_work: bool = False,
    default_views: list[ViewSpec] | None = None,
    watch_window: bool = True,
) -> str:
    """Create a labelling agent on a campaign and assign it task_count tasks.

    name: 1-20 chars of letters, digits, ".", "_" or "-". Register one agent per worker;
    never share an agent_id between workers.
    max_image_edge_px, max_image_megapixels: the largest image the model doing the labelling
    takes in without downscaling it, from what that model knows about itself. Every image is
    fitted to them, so no detail is lost to downscaling.
    takes_over_work: when this agent runs out of tasks, next_task moves a task over from
    your other agents on the campaign that still have work queued.
    default_views: up to 4 views next_task returns for every task, drawn ahead for the
    tasks after it. Omit for a built-in overview; change later with set_default_views.
    watch_window: open a window on the user's screen showing every agent's latest views.
    On by default; pass false only when the user does not want it.

    Returns the agent (keep agent_id), the campaign context (guide, labels, form fields,
    imagery slices, basemaps, time series), the default views and agents_page, the URL to
    give the user for following progress. When the render browser cannot start,
    render_browser says why instead: follow it, and never register again.
    """
    limits = _limits(max_image_edge_px, max_image_megapixels)
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
    _image_limits[agent_id] = limits
    page = _agents_page(agent)
    try:
        context = await _on_page(agent_id, "context")
        views = await _views_of(agent_id)
    except ToolError as exc:
        # The agent exists either way: registering again would make a second one.
        note = f"{exc} Once that is solved, call campaign_context with this agent_id."
        return _json({"agent": agent, "agents_page": page, "render_browser": note})
    if watch_window:
        # A machine without a screen, or a user who closed the window, must not fail a run.
        with contextlib.suppress(Exception):
            await _browsers().open_watch_window(page)
    return _json({"agent": agent, "agents_page": page, "context": context, "default_views": views})


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
async def set_image_limits(
    agent_id: str, max_image_edge_px: int, max_image_megapixels: float
) -> str:
    """Set the largest image the agent's model takes in without downscaling it. Needed only
    for an agent registered before the MCP server restarted."""
    _image_limits[agent_id] = _limits(max_image_edge_px, max_image_megapixels)
    return _json(_image_limits[agent_id])


@server.tool(structured_output=False)
async def next_task(agent_id: str) -> list[str | Image]:
    """The agent's next open task with its default views drawn. The same views are drawn
    ahead for the tasks after it, so this is usually quick.

    Returns JSON {reply, task, remaining, views}, then the images; probe_timeseries picks
    pixels by reply and image number. Each view entry has its spec and
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
    limits = _limits_of(agent_id)
    rendered = await _on_page(agent_id, "render", task, views, limits)
    await _on_page(agent_id, "preload", upcoming, views, limits)
    return await _bundle(agent_id, {"task": task, "remaining": result["remaining"]}, rendered)


@server.tool(structured_output=False)
async def get_views(agent_id: str, task_id: int, views: list[ViewSpec]) -> list[str | Image]:
    """Draw more views of the agent's current task: other dates, finer slices, higher zoom,
    other visualizations or basemaps. Pack everything you need next into this one call, up
    to 8 views; same return shape as next_task."""
    task = _current_tasks.get(agent_id)
    if task is None or task["task_id"] != task_id:
        raise ToolError(f"Task {task_id} is not this agent's current task: call next_task.")
    if not 1 <= len(views) <= 8:
        raise ToolError("Pass 1-8 views.")
    rendered = await _on_page(agent_id, "render", task, views, _limits_of(agent_id))
    return await _bundle(agent_id, {"task": task}, rendered)


@server.tool(structured_output=False)
async def probe_timeseries(
    agent_id: str,
    task_id: int,
    points: list[ProbePoint],
    timeseries_ids: list[int] | None = None,
    remove_cloudy: bool = True,
    smoothed: bool = False,
) -> list[str | Image]:
    """Load the time series at 1-6 points you pick on a map, charted beside the task's own,
    to compare places that look alike (or unlike) with the task.

    points: {"reply", "image", "x", "y"} picks the pixel at x, y of image number `image`
    (1-based) of the next_task, get_views or probe_timeseries reply numbered `reply`, one of
    your last 8 for this task, measured in that image's own pixels from its top-left corner;
    meta.cells[i].rect gives each cell's [x, y, w, h]. It must fall on a map cell; the
    cell's zoom turns the pixel into a place. Or {"lat", "lon"}. timeseries_ids: default all
    of the campaign's, one chart each.

    Returns one image: each map cell a point was picked on, redrawn over the same ground (its
    size and zoom may change to fit your limits) with every point it covers marked P1, P2...
    at the exact pixel it resolved to, then the charts with a line for the task and one per
    point in its marker's colour. meta.probes gives each point's lat,
    lon, east_m and north_m from the task. Check every marker sits where you meant before
    reading the chart; pick again on this reply's image to correct one.
    """
    task = _current_tasks.get(agent_id)
    if task is None or task["task_id"] != task_id:
        raise ToolError(f"Task {task_id} is not this agent's current task: call next_task.")
    if not 1 <= len(points) <= 6:
        raise ToolError("Pass 1-6 points.")
    kept = _replies.get(agent_id, {})
    probes: list[dict[str, Any]] = []
    for point in points:
        if {"reply", "image", "x", "y"} == point.keys():
            number, image = point["reply"], point["image"]
            if number not in kept:
                raise ToolError(
                    f"Reply {number} is not one of your last {KEPT_REPLIES} replies: pick on a"
                    " recent one, or call get_views again."
                )
            reply_task, shown = kept[number]
            if reply_task != task_id:
                raise ToolError(f"Reply {number} was drawn for task {reply_task}, not {task_id}.")
            if not 1 <= image <= len(shown):
                count = f"{len(shown)} image{'' if len(shown) == 1 else 's'}"
                raise ToolError(f"Reply {number} has no image {image}: it had {count}.")
            probes.append({"view": shown[image - 1], **point})
        elif {"lat", "lon"} == point.keys():
            probes.append(dict(point))
        else:
            raise ToolError('Each point is {"reply", "image", "x", "y"} or {"lat", "lon"}.')
    options = _without_none(
        {"timeseries_ids": timeseries_ids, "remove_cloudy": remove_cloudy, "smoothed": smoothed}
    )
    rendered = await _on_page(agent_id, "probe", task, probes, options, _limits_of(agent_id))
    if "error" in rendered:
        raise ToolError(rendered["error"])
    return await _bundle(agent_id, {"task": task}, [rendered])


@server.tool(structured_output=False)
async def submit_label(
    agent_id: str,
    task_id: int,
    label_id: int,
    confidence: int,
    comment: str,
    form_values: dict[str, Any] | None = None,
    flagged_for_review: bool = False,
    flag_comment: str | None = None,
) -> str:
    """Label a task.

    label_id: an id from the context's labels. confidence: 0-5, honest.
    comment: your reasoning for the decision: the evidence per date or view, what ruled out
    the other labels, and what stayed uncertain.
    form_values: keyed by form field id as a string; category -> option id,
    multicategory -> list of option ids, number, text, date "YYYY-MM-DD",
    daterange {"start", "end"}. Required fields must be filled.
    flagged_for_review: set when a human should check this label, with flag_comment.
    """
    if not 0 <= confidence <= 5:
        raise ToolError("confidence is 0-5.")
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


async def _on_setup_page(project_id: int, method: str, *args: Any) -> Any:
    try:
        return await _browsers().setup(project_id, method, *args)
    except ChromiumMissingError as exc:
        raise ToolError(str(exc)) from exc
    except Exception as exc:
        # Only the page's own message, without Playwright's prefix and the JS stack.
        message = str(exc).split("\n    at ")[0].removeprefix("Page.evaluate: Error: ")
        raise ToolError(f"Building the imagery failed: {message}") from exc


def _campaign_url(project_id: int, campaign_id: int) -> str:
    return f"{_session_url}/projects/{project_id}/campaigns/{campaign_id}"


# Tools that create or change campaigns are served only when the user names them in
# STACNOTATOR_MCP_ALLOW (comma-separated), so a model only has the ones it was given.
_ALLOWED = {name.strip() for name in os.environ.get("STACNOTATOR_MCP_ALLOW", "").split(",")}


def _grantable_tool(fn: Callable[..., Any]) -> Callable[..., Any]:
    if fn.__name__ in _ALLOWED:
        server.tool(structured_output=False)(fn)
    return fn


@server.tool(structured_output=False)
async def list_projects() -> str:
    """Projects you can access (id, name, is_admin). A campaign is created in a project you
    are an admin of; ask the user which one when they did not say."""
    projects = (await _api(_http().get, "/projects/"))["items"]
    return _json(
        [{key: p.get(key) for key in ("id", "name", "description", "is_admin")} for p in projects]
    )


@server.tool(structured_output=False)
async def setup_options(project_id: int) -> str:
    """What imagery recipes and time series accept: imagery collections (id,
    visualizations), basemaps by name, and time series data sources and types."""
    options = await _on_setup_page(project_id, "options")
    options["timeseries"] = await _api(_http().get, "/timeseries/create-options")
    return _json(options)


@_grantable_tool
async def create_campaign(
    project_id: int,
    settings: CampaignSettings,
    imagery: list[ImageryRecipe],
    basemaps: list[str] | None = None,
    timeseries: list[TimeseriesSpec] | None = None,
) -> str:
    """Create a new campaign. Only call it once the user has accepted your whole proposal.
    imagery: one recipe per source, its windows, slices and covers chosen for what the
    labels need to see. basemaps: names from setup_options, all of them when omitted.
    Mosaic registration starts in the background; get_campaign says when it is done."""
    if not imagery:
        raise ToolError("Give at least one imagery recipe.")
    guide = settings.pop("guide_markdown", None)
    body = {
        "name": settings.pop("name", None),
        "project_id": project_id,
        "labelling_policy": settings.pop("labelling_policy", None),
        "settings": settings,
        "imagery_editor_state": await _on_setup_page(
            project_id, "imagery", None, imagery, basemaps
        ),
        "timeseries_configs": timeseries,
    }
    campaign = await _api(_http().post, "/campaigns/", _without_none(body))
    if guide is not None:
        await _api(_http().patch, f"/campaigns/{campaign['id']}", {"guide_markdown": guide})
    return _json(
        {
            "campaign_id": campaign["id"],
            "url": _campaign_url(project_id, campaign["id"]),
            "registration_status": campaign.get("registration_status"),
            "task_sets": await _task_sets(campaign["id"]),
        }
    )


@_grantable_tool
async def edit_campaign(campaign_id: int, settings: CampaignSettings) -> str:
    """Change an existing campaign's settings. Read the current values with get_campaign
    first and agree the change with the user. Imagery is changed with edit_imagery."""
    campaign = await _api(_http().patch, f"/campaigns/{campaign_id}", settings)
    return _json({"campaign_id": campaign_id, "settings": campaign["settings"]})


@_grantable_tool
async def edit_imagery(
    campaign_id: int,
    imagery: list[ImageryRecipe] | None = None,
    remove: list[str] | None = None,
    basemaps: list[str] | None = None,
) -> str:
    """Change an existing campaign's imagery. Read the current sources with get_campaign
    first and agree the change with the user.

    imagery: recipes, as in create_campaign. A recipe whose source name (its name, else
    the collection's label) matches a stored source replaces that source's windows,
    visualizations and cloud cover, so list every window it should keep; windows with
    unchanged dates keep their registration. Any other recipe is added. remove: names of sources to
    delete. Sources you do not name are kept as they are. basemaps: names from
    setup_options that replace the campaign's basemaps; omitted, they are kept. Changed
    imagery registers again in the background; get_campaign says when it is done."""
    if not imagery and not remove and basemaps is None:
        raise ToolError("Pass imagery, remove or basemaps.")
    summary = await _api(_http().get, f"/campaigns/{campaign_id}/summary")
    state = await _on_setup_page(
        summary["project_id"], "imagery", campaign_id, imagery or [], basemaps, remove
    )
    await _api(_http().put, f"/campaigns/{campaign_id}/imagery", state)
    return _json(
        {
            "campaign_id": campaign_id,
            "sources": [source["name"] for source in state["sources"]],
            "basemaps": [basemap["name"] for basemap in state["basemaps"]],
        }
    )


@_grantable_tool
async def add_tasks(
    campaign_id: int,
    task_set: str,
    geojson: dict[str, Any] | None = None,
    sampling: SamplingSpec | None = None,
) -> str:
    """Add tasks to a campaign's task set, created when no set has that name. Pass exactly
    one of geojson (a FeatureCollection of points or polygons) or sampling (points drawn
    across the campaign box). Agree the task set, the count and where they go with the
    user first."""
    if (geojson is None) == (sampling is None):
        raise ToolError("Pass exactly one of geojson or sampling.")
    campaign = Campaign(_http(), {"id": campaign_id})

    def run() -> int:
        try:
            if geojson is not None:
                return campaign.upload_tasks(geojson, task_set, create_missing=True)
            task_set_id = campaign._task_set_id(task_set, create_missing=True)
            result = _http().post(
                f"/campaigns/{campaign_id}/sampling/generate-tasks",
                data={
                    "strategy": json.dumps(sampling),
                    "task_set_id": str(task_set_id),
                    "use_campaign_bbox": "true",
                },
            )
            return int(result["num_tasks_created"])
        except ValueError as exc:
            raise ToolError(str(exc)) from exc

    created = await _api(run)
    return _json({"tasks_created": created, "task_sets": await _task_sets(campaign_id)})


async def _task_sets(campaign_id: int) -> list[dict[str, Any]]:
    sets = await _api(_http().get, f"/campaigns/{campaign_id}/task-sets")
    return [{k: s[k] for k in ("id", "name", "num_tasks", "num_labeled")} for s in sets]


def _imagery_summary(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": source["name"],
        "visualizations": [v["name"] for v in source["visualizations"]],
        "windows": [
            {
                "name": col["name"],
                "collection": (col.get("search") or {}).get("stac_collection_id"),
                "slices": [f"{s['start_date']} to {s['end_date']}" for s in col["slices"]],
                "cover_slice_index": col["cover_slice_index"],
                "has_dedicated_cover": col["has_dedicated_cover"],
            }
            for col in source["collections"]
        ],
    }


@server.tool(structured_output=False)
async def get_campaign(campaign_id: int) -> str:
    """A campaign's settings (labels with their ids, guide, area, form fields), imagery
    sources with their windows and slices, basemaps, time series and task sets, and
    whether its imagery is registered (registration_status ready) and its embeddings
    computed, with any errors. Annotation and preview_campaign wait for registration;
    while it runs, poll every half minute or so."""
    campaign = await _api(_http().get, f"/campaigns/{campaign_id}")
    keys = (
        "id",
        "name",
        "registration_status",
        "registration_errors",
        "embedding_status",
        "embedding_errors",
        "settings",
    )
    return _json(
        {
            **{key: campaign.get(key) for key in keys},
            "url": _campaign_url(campaign["project_id"], campaign_id),
            "imagery": [_imagery_summary(source) for source in campaign["imagery_sources"]],
            "basemaps": [basemap["name"] for basemap in campaign["basemaps"]],
            "time_series": [
                {k: ts.get(k) for k in ("name", "data_source", "ts_type", "start_ym", "end_ym")}
                for ts in campaign["time_series"]
            ],
            "task_sets": await _task_sets(campaign_id),
        }
    )


def _preview_task(task: dict[str, Any]) -> dict[str, Any]:
    centroid = loads(task["geometry_wkt"]).centroid
    return {
        "task_id": task["id"],
        "lon": centroid.x,
        "lat": centroid.y,
        "geometry_wkt": task["geometry_wkt"],
    }


@server.tool(structured_output=False)
async def preview_campaign(
    campaign_id: int,
    max_image_edge_px: int,
    max_image_megapixels: float,
    task_count: int = 2,
) -> list[str | Image]:
    """Draw the default views of a campaign's first tasks, to check the imagery shows what
    the labels need before handing the campaign over. Needs registration to be ready and
    at least one task. Same image limits as register_agent."""
    limits = _limits(max_image_edge_px, max_image_megapixels)
    summary = await _api(_http().get, f"/campaigns/{campaign_id}/summary")
    if summary["registration_status"] != "ready":
        raise ToolError(
            f"Imagery registration is {summary['registration_status']}"
            f" ({summary.get('registration_errors')}); wait for get_campaign to say ready."
        )
    tasks = (await _api(_http().get, f"/campaigns/{campaign_id}/tasks"))["tasks"]
    if not tasks:
        raise ToolError("The campaign has no tasks yet: add_tasks first.")
    key = f"preview:{campaign_id}:{uuid4()}"
    try:
        views = await _browsers().call(key, campaign_id, "defaultViews")
        out: list[str | Image] = []
        for task in tasks[: max(1, min(task_count, 5))]:
            agent_task = _preview_task(task)
            rendered = await _browsers().call(key, campaign_id, "render", agent_task, views, limits)
            out += _pack({"task": agent_task}, rendered)
    except ChromiumMissingError as exc:
        raise ToolError(str(exc)) from exc
    except Exception as exc:
        raise ToolError(f"The render browser failed: {exc}") from exc
    finally:
        # The page reads the campaign once, so a later preview after an edit needs a new one.
        await _browsers().close(key)
    return out


@server.tool(structured_output=False)
async def watch_agents() -> str:
    """Open the window on the user's screen showing the latest views of every agent as they
    are drawn, or bring it to the front. register_agent opens it already, so this is for
    reopening it after the user closed it."""
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


def main() -> None:
    server.run()


if __name__ == "__main__":
    main()

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
import json
import os
import re
import subprocess
from collections.abc import Callable
from typing import Any, Literal
from urllib.parse import urlparse

from mcp.server.mcpserver import Image, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from typing_extensions import Required, TypedDict

from stacnotator import _areas, _credentials
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
    timeseries sources; ts_type: one of that source's index_keys. start_ym, end_ym: YYYY-MM."""

    name: Required[str]
    data_source: Required[str]
    ts_type: Required[str]
    start_ym: Required[str]
    end_ym: Required[str]


class SamplingSpec(TypedDict, total=False):
    """random: num_samples points. grid: a lattice spacing_km apart. Drawn inside the
    outline of area_id (from find_area) when given, else across the campaign box. seed
    makes either reproducible."""

    strategy_type: Required[Literal["random", "grid"]]
    num_samples: int
    spacing_km: float
    seed: int
    area_id: str


server = MCPServer(
    "stacnotator",
    instructions=(
        "Set up STACNotator campaigns and label their tasks from rendered imagery. Tools "
        "that create or change campaigns (create_campaign, add_tasks, edit_campaign, "
        "edit_imagery) are only here when the user granted them; when one you need is "
        "missing, tell the user it was not granted and never make the change another way, "
        "such as through the SDK or the API. Before any such change, follow the "
        "stacnotator-campaign-setup skill: never invent the area, the period or the labels; "
        "ask the user, look regions up with find_area and make the change only once they "
        "accept your proposal. Then get_campaign until imagery is ready -> "
        "preview_campaign. To label: register one agent per worker, read the campaign "
        "guide in its context, then loop next_task -> (get_views) -> submit_label or "
        "skip_task, always passing your own agent_id."
    ),
)

# Kept for the life of this process only: a restarted server falls back to the built-in
# default views and asks next_task for the current task again.
_agents: dict[str, dict[str, Any]] = {}
_default_views: dict[str, list[ViewSpec]] = {}
_current_tasks: dict[str, dict[str, Any]] = {}
_image_limits: dict[str, dict[str, float]] = {}
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


def _pack(summary: dict[str, Any], rendered: list[dict[str, Any]]) -> list[str | Image]:
    """The summary and one entry per view as text, then the drawn images in order. Each view
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
    return [_json({**summary, "views": views}), *images]


async def _bundle(
    agent_id: str, summary: dict[str, Any], rendered: list[dict[str, Any]]
) -> list[str | Image]:
    drawn = [view["image_base64"] for view in rendered if "image_base64" in view]
    agent = await _agent(agent_id)
    # Watching is a side show: a closed window never fails the agent's call.
    with contextlib.suppress(Exception):
        await _browsers().show(agent["name"], summary["task"]["task_id"], drawn)
    return _pack(summary, rendered)


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
        for state in (_agents, _default_views, _current_tasks, _image_limits):
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


def _area(area_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    try:
        return _areas.get(area_id)
    except _areas.AreaError as exc:
        raise ToolError(str(exc)) from exc


_BBOX_FIELDS = ("bbox_west", "bbox_south", "bbox_east", "bbox_north")

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


@server.tool(structured_output=False)
async def find_area(
    country: str, name: str, level: str | None = None, within: str | None = None
) -> str:
    """Look up an administrative unit (state, province, county, district) in geoBoundaries,
    the default reference for where a campaign is. country: ISO 3166-1 alpha-3, like USA
    or UKR. name: the unit's name; words like County or Oblast are ignored. level: ADM1
    (states, provinces, oblasts) to ADM5; ADM1 and ADM2 are searched when omitted. within:
    the ADM1 unit it lies in, to tell apart same-named units. Returns up to 10 matches with
    its bbox for a campaign's area and an area_id for sampling tasks inside its outline,
    and the boundary's source and year: show the user which unit you mean, and its year, before
    using one."""
    try:
        found = await asyncio.to_thread(_areas.find, country, name, level, within)
    except _areas.AreaError as exc:
        raise ToolError(str(exc)) from exc
    except Exception as exc:
        raise ToolError(f"Could not read geoBoundaries: {exc}") from exc
    if not found:
        raise ToolError(
            f'No unit of {country} matches "{name}". Try another spelling, level or the '
            "local name, or ask the user for a bounding box."
        )
    return _json(found)


@_grantable_tool
async def create_campaign(
    project_id: int,
    name: str,
    labels: list[str],
    imagery: list[ImageryRecipe],
    bbox: list[float],
    guide_markdown: str | None = None,
    basemaps: list[str] | None = None,
    timeseries: list[TimeseriesSpec] | None = None,
    label_geometry: Literal["point", "polygon", "line"] = "polygon",
    task_output: Literal["classify", "draw"] = "classify",
    sample_extent_meters: float | None = None,
    form_fields: list[dict[str, Any]] | None = None,
    embedding_year: int | None = None,
) -> str:
    """Create a new campaign. Only call it once the user has accepted your whole proposal.

    bbox: [west, south, east, north] in WGS84 degrees, from find_area or as the user gave
    it. labels: class
    names, given ids 1..n in order. imagery: one recipe per source, its windows, slices and
    covers chosen for what the labels need to see. guide_markdown: the annotation guide
    labellers and agents read. basemaps: names from setup_options, all of them when
    omitted. label_geometry: what a label is drawn as in draw tasks and Explore.
    task_output: classify (pick a label per task) or draw (draw shapes per task).
    sample_extent_meters: the square drawn around each task, when it has one.
    form_fields: extra questions per task, in the campaign's form field schema.
    embedding_year: year of satellite embeddings for similarity search, when wanted.
    Mosaic registration starts in the background; get_campaign says when it is done."""
    if not labels:
        raise ToolError("Give at least one label.")
    if not imagery:
        raise ToolError("Give at least one imagery recipe.")
    editor_state = await _on_setup_page(project_id, "imagery", imagery, basemaps)
    body = _without_none(
        {
            "name": name,
            "project_id": project_id,
            "settings": _without_none(
                {
                    "labels": [
                        {"id": i, "name": label, "geometry_type": label_geometry}
                        for i, label in enumerate(labels, start=1)
                    ],
                    **dict(zip(_BBOX_FIELDS, bbox, strict=True)),
                    "embedding_year": embedding_year,
                    "sample_extent_meters": sample_extent_meters,
                    "form_fields": form_fields,
                    "task_output": task_output,
                }
            ),
            "imagery_editor_state": editor_state,
            "timeseries_configs": timeseries
            and [
                {
                    **ts,
                    "start_ym": ts["start_ym"].replace("-", ""),
                    "end_ym": ts["end_ym"].replace("-", ""),
                }
                for ts in timeseries
            ],
        }
    )
    campaign = await _api(_http().post, "/campaigns/", body)
    if guide_markdown:
        await _api(
            _http().patch, f"/campaigns/{campaign['id']}", {"guide_markdown": guide_markdown}
        )
    return _json(
        {
            "campaign_id": campaign["id"],
            "url": _campaign_url(project_id, campaign["id"]),
            "registration_status": campaign.get("registration_status"),
            "task_sets": await _task_sets(campaign["id"]),
        }
    )


@_grantable_tool
async def edit_campaign(campaign_id: int, settings: dict[str, Any]) -> str:
    """Change an existing campaign's settings. Read the current values with get_campaign
    first and agree the change with the user. settings holds only what changes, out of:
    name, guide_markdown, labels, bbox_west/south/east/north (all four together),
    task_output, sample_extent_meters, form_fields, embedding_year, labelling_policy.
    labels is the full list [{"id", "name", "geometry_type"}]: keep each existing label's
    id (renaming keeps it) and give new ones the next free ids; a label cannot be removed.
    Imagery is changed with edit_imagery."""
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
    visualizations and cloud cover; any other is added. remove: names of sources to
    delete. Sources you do not name are kept as they are. basemaps: names from
    setup_options that replace the campaign's basemaps; omitted, they are kept. Changed
    imagery registers again in the background; get_campaign says when it is done."""
    if not imagery and not remove and basemaps is None:
        raise ToolError("Pass imagery, remove or basemaps.")
    summary = await _api(_http().get, f"/campaigns/{campaign_id}/summary")
    state = await _on_setup_page(
        summary["project_id"], "editImagery", campaign_id, imagery or [], basemaps, remove
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
    in an area_id's outline or across the campaign box). Agree
    the task set, the count and where they go with the user first."""
    if (geojson is None) == (sampling is None):
        raise ToolError("Pass exactly one of geojson or sampling.")
    campaign = Campaign(_http(), {"id": campaign_id})
    outline = None
    if sampling is not None and "area_id" in sampling:
        _, outline = await asyncio.to_thread(_area, sampling["area_id"])

    def run() -> int:
        try:
            if sampling is not None:
                task_set_id = campaign._task_set_id(task_set, create_missing=True)
                region = outline and {
                    "region_file": ("area.geojson", json.dumps(outline), "application/geo+json")
                }
                result = _http().post(
                    f"/campaigns/{campaign_id}/sampling/generate-tasks",
                    data={
                        "strategy": json.dumps(
                            {k: v for k, v in sampling.items() if k != "area_id"}
                        ),
                        "task_set_id": str(task_set_id),
                        "use_campaign_bbox": "false" if outline else "true",
                    },
                    files=region or None,
                )
                return int(result["num_tasks_created"])
            return campaign.upload_tasks(geojson or {}, task_set, create_missing=True)
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


_POINT = re.compile(r"(-?\d+(?:\.\d+)?(?:[eE]-?\d+)?)\s+(-?\d+(?:\.\d+)?(?:[eE]-?\d+)?)")


def _preview_task(task: dict[str, Any]) -> dict[str, Any]:
    coords = [(float(x), float(y)) for x, y in _POINT.findall(task["geometry_wkt"])]
    xs, ys = [x for x, _ in coords], [y for _, y in coords]
    return {
        "task_id": task["id"],
        "lon": (min(xs) + max(xs)) / 2,
        "lat": (min(ys) + max(ys)) / 2,
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
    key = f"preview:{campaign_id}"
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

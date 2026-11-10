"""Label a campaign's tasks with a model API instead of a coding agent.

`stacnotator-label run` registers labelling agents and works each of them through its tasks
by calling a model API directly. It uses the MCP server's tools in this process, so the views
are drawn by the same headless pages, and only the decision on each task goes to the model.
Each task is a new conversation: images never pile up from one task to the next. Every rule
about how to label comes from the instructions file the user passes; this module only says
how the tools and views work.
"""

import argparse
import asyncio
import json
import logging
import sys
import time
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Any, cast

from mcp.server.mcpserver import Image
from mcp.server.mcpserver.exceptions import ToolError

from stacnotator import agent_mcp
from stacnotator._model_api import (
    PROVIDERS,
    ContentBlockedError,
    ModelReply,
    Provider,
    ProviderConfig,
    Session,
    ToolCall,
    ToolResult,
    ToolSpec,
    UserTurn,
)

log = logging.getLogger("stacnotator.label")

VIEW_TOOLS = ("get_views", "probe_timeseries")
# Bound by the runner, never chosen by the model.
BOUND_ARGUMENTS = ("agent_id", "task_id")
COMMENT_MAX = 5000
REDRAW_EVERY_S = 10.0

DECIDE = ToolSpec(
    name="decide",
    description=(
        "Your final answer for this task; ends the conversation. label_id: one of the "
        "campaign's label ids, or null when the imagery cannot tell (the task is skipped). "
        "confidence: 0-5, 5 no doubt, 0 a guess. comment: your reasoning: the evidence per "
        "date or view, what ruled out the other labels, what stays uncertain. form_values: "
        "keyed by form field id as a string; category -> option id, multicategory -> list "
        'of option ids, number, text, date "YYYY-MM-DD", daterange {"start", "end"}; '
        "required fields must be filled. flagged_for_review with flag_comment: a person "
        "should check this label."
    ),
    parameters={
        "type": "object",
        "properties": {
            "label_id": {"type": ["integer", "null"]},
            "confidence": {"type": "integer", "minimum": 0, "maximum": 5},
            "comment": {"type": "string"},
            "form_values": {"type": "object"},
            "flagged_for_review": {"type": "boolean"},
            "flag_comment": {"type": "string"},
        },
        "required": ["label_id", "confidence", "comment"],
    },
)

SYSTEM_PROMPT = """\
You are a photo-interpreter labelling one task (one place) of the STACNotator campaign \
"{campaign_name}" from satellite imagery. Each conversation is one task. The labelling \
instructions at the end are the rules for this campaign: follow them, and where they \
conflict with anything else here, they win.

# How to work

- The first message gives the task and a first look: packed images ("views") with their \
metadata as JSON.
- Ask for whatever is still unclear with get_views, packing everything you need next into \
one call (up to 8 views). Use probe_timeseries when comparing the task with other places \
helps.
- Finish with decide. You have at most {max_turns} replies, including the one that decides; \
the last one must decide.

# Reading the views

- A view is a grid of cells, each centred on the task: an imagery slice (one date or \
period), a basemap or a time series chart. Cells are captioned "#i <dates>, z<zoom>" and \
match meta.cells[i], whose rect is [x, y, w, h] in image pixels.
- A thin red box sits just outside the sample extent, or a crosshair when the extent is too \
small to draw. For point tasks, inside_box describes the pixels inside it as drawn: \
mean_rgb, green_index (excess green, -1 to 1), bright_share (share of very bright pixels) \
and no_data_share.
- "(!)" and hatched grey mean no data; the cell's warning says why.
- Time series values are in series[].rows.
- Meters per pixel = 156543 * cos(lat) / 2^zoom. Past a source's max_native_zoom, pixels \
only get bigger.
- Basemaps have no date: they can be years old and from any season.
- Sources marked on_demand search for scenes around the task, so a date can be empty.

# View syntax

{{"cells": [...], "columns": 4, "cell_px": 320, "zoom": 15}}. Each cell is one of \
{{"slice_id", "visualization"?}}, {{"basemap_id"}} or {{"timeseries_ids": [...], \
"remove_cloudy"?, "smoothed"?}}, with an optional own "zoom". At most 36 cells per view; a \
chart takes a full row; cell_px shrinks to fit the image limits.

# Campaign

{campaign}

# Labelling instructions

{instructions}
"""

IMAGES_WITHHELD = (
    "The model API's content filter refused the images of this message, so they are left "
    "out: use the metadata and time series values above."
)


@dataclass
class Settings:
    instructions: str
    votes: int = 1
    reasoning: str | None = None
    arbiter_reasoning: str | None = None
    max_turns: int = 8
    imagery_wait_s: float = 120.0
    view_wait_s: float = 30.0


@dataclass
class Decision:
    label_id: int | None
    confidence: int
    comment: str
    form_values: dict[str, Any] | None = None
    flagged_for_review: bool = False
    flag_comment: str | None = None
    turns: int = 0
    input_tokens: int = 0
    output_tokens: int = 0

    def flag(self, reason: str) -> None:
        self.flagged_for_review = True
        self.flag_comment = "; ".join(filter(None, [self.flag_comment, reason]))


class LabellingError(Exception):
    pass


def _split(output: list[str | Image]) -> tuple[dict[str, Any], list[bytes]]:
    payload: dict[str, Any] = json.loads(cast(str, output[0]))
    return payload, [cast(bytes, image.data) for image in output[1:] if isinstance(image, Image)]


def _missing_tiles(payload: dict[str, Any]) -> list[str]:
    return [
        cell.get("label", f"#{cell.get('i')}")
        for view in payload.get("views", [])
        for cell in view.get("meta", {}).get("cells", [])
        if cell.get("tiles_missing")
    ]


async def _until_drawn(
    agent_id: str, task_id: int, output: list[str | Image], wait_s: float
) -> list[str | Image]:
    """Draw the views again while tiles are missing, up to wait_s: tiles that loaded come
    from the page's cache, failed ones are fetched again."""
    deadline = time.monotonic() + wait_s
    payload, _ = _split(output)
    while _missing_tiles(payload) and time.monotonic() < deadline:
        await asyncio.sleep(REDRAW_EVERY_S)
        views = [view["view"] for view in payload["views"]]
        output = await agent_mcp.get_views(agent_id, task_id, views)
        payload, _ = _split(output)
    return output


def tool_specs(server_tools: list[Any]) -> list[ToolSpec]:
    """The MCP server's view tools as the model sees them, without the arguments the runner
    fills in itself."""
    specs = []
    for tool in server_tools:
        if tool.name not in VIEW_TOOLS:
            continue
        schema = json.loads(json.dumps(tool.input_schema))
        for name in BOUND_ARGUMENTS:
            schema["properties"].pop(name, None)
        schema["required"] = [r for r in schema.get("required", []) if r not in BOUND_ARGUMENTS]
        specs.append(ToolSpec(tool.name, tool.description or "", schema))
    return [*specs, DECIDE]


def system_prompt(context: dict[str, Any], settings: Settings) -> str:
    # The campaign's own guide is left out: the instructions file is the one source of rules.
    campaign = {key: value for key, value in context.items() if key != "guide_markdown"}
    return SYSTEM_PROMPT.format(
        campaign_name=context.get("name", ""),
        max_turns=settings.max_turns,
        campaign=json.dumps(campaign, indent=1),
        instructions=settings.instructions.strip(),
    )


def _with_flags(decision: Decision, votes: list[Decision]) -> Decision:
    for vote in votes:
        if vote.flagged_for_review:
            decision.flag(vote.flag_comment or "a vote asked for review")
    return decision


def _clip(text: str) -> str:
    return text if len(text) <= COMMENT_MAX else text[: COMMENT_MAX - 3] + "..."


class Labeller:
    def __init__(
        self,
        provider: Provider,
        settings: Settings,
        context: dict[str, Any],
        tools: list[ToolSpec],
        log_path: Path | None = None,
    ):
        self._provider = provider
        self._settings = settings
        self._instructions = system_prompt(context, settings)
        self._tools = tools
        self._properties = {tool.name: set(tool.parameters["properties"]) for tool in tools}
        self._labels = {label["id"]: label["name"] for label in context["labels"]}
        self._required_fields = [
            str(f["id"]) for f in context.get("form_fields", []) if f.get("required")
        ]
        self._log_path = log_path

    async def work(self, agent_id: str, name: str) -> int:
        """Label the agent's tasks until it has none left; returns how many it finished."""
        done = 0
        while True:
            output = await agent_mcp.next_task(agent_id)
            payload, _ = _split(output)
            task = payload["task"]
            if task is None:
                log.info("%s: no tasks left after %d", name, done)
                return done
            started = time.monotonic()
            output = await _until_drawn(
                agent_id, task["task_id"], output, self._settings.imagery_wait_s
            )
            decision, votes = await self.label(agent_id, task, output)
            await self._submit(agent_id, task["task_id"], decision)
            done += 1
            self._report(name, task, decision, votes, time.monotonic() - started)

    async def label(
        self, agent_id: str, task: dict[str, Any], first_look: list[str | Image]
    ) -> tuple[Decision, list[Decision]]:
        payload, images = _split(first_look)
        text = (
            f"Task {task['task_id']} (sample {task.get('annotation_number')}), "
            f"lat {task['lat']}, lon {task['lon']}. First look:\n{json.dumps(payload)}"
        )
        missing = _missing_tiles(payload)
        if missing:
            text += (
                "\n\nSome tiles of these cells could not be loaded and are hatched: "
                + ", ".join(missing)
            )
        opening = UserTurn(text, images)
        task_id = task["task_id"]
        try:
            if self._settings.votes == 1:
                votes = [await self._session(agent_id, task_id, opening, self._settings.reasoning)]
                decision = replace(votes[0])
            else:
                votes = list(
                    await asyncio.gather(
                        *(
                            self._session(agent_id, task_id, opening, self._settings.reasoning)
                            for _ in range(self._settings.votes)
                        )
                    )
                )
                decision, votes = await self._settle(agent_id, task_id, opening, votes)
        except ContentBlockedError as exc:
            reason = f"Skipped: the model API's content filter refused this task ({exc})"
            return Decision(None, 0, _clip(reason)), []
        if missing and decision.label_id is not None:
            decision.flag("imagery missing for: " + ", ".join(missing))
        return decision, votes

    async def _settle(
        self, agent_id: str, task_id: int, opening: UserTurn, votes: list[Decision]
    ) -> tuple[Decision, list[Decision]]:
        summary = " | ".join(
            f"V{i} {self._name(v.label_id)} (conf {v.confidence}): {v.comment}"
            for i, v in enumerate(votes, 1)
        )
        if len({vote.label_id for vote in votes}) == 1:
            first = votes[0]
            decision = Decision(
                first.label_id,
                round(sum(v.confidence for v in votes) / len(votes)),
                _clip(f"{len(votes)} votes agreed | {summary}"),
                first.form_values,
            )
            return _with_flags(decision, votes), votes
        disagreement = "\n".join(
            f"- Interpreter {i}: {self._name(v.label_id)}, confidence {v.confidence}. {v.comment}"
            for i, v in enumerate(votes, 1)
        )
        arbiter_opening = UserTurn(
            f"{opening.text}\n\nIndependent interpreters disagreed on this task:\n"
            f"{disagreement}\n\nLook again where they differ, then decide.",
            opening.images,
        )
        arbiter = await self._session(
            agent_id,
            task_id,
            arbiter_opening,
            self._settings.arbiter_reasoning or self._settings.reasoning,
        )
        decision = replace(
            arbiter,
            comment=_clip(f"Arbitrated (conf {arbiter.confidence}): {arbiter.comment} | {summary}"),
        )
        return _with_flags(decision, votes), [*votes, arbiter]

    def _name(self, label_id: int | None) -> str:
        return "skip" if label_id is None else self._labels.get(label_id, str(label_id))

    async def _session(
        self, agent_id: str, task_id: int, opening: UserTurn, reasoning: str | None
    ) -> Decision:
        session = self._provider.session(self._instructions, self._tools, reasoning)
        items: list[UserTurn | ToolResult] = [opening]
        withheld = False
        tokens = [0, 0]
        for turn in range(1, self._settings.max_turns + 1):
            last = turn == self._settings.max_turns
            reply, blocked = await _send(session, items, "decide" if last else None)
            withheld = withheld or blocked
            tokens = [tokens[0] + reply.input_tokens, tokens[1] + reply.output_tokens]
            if not reply.tool_calls:
                items = [UserTurn("Answer only through the tools: ask for views, or decide.")]
                continue
            results: list[UserTurn | ToolResult] = []
            for call in reply.tool_calls:
                if call.name == DECIDE.name:
                    decision, error = self._decision(call.arguments)
                    if decision is not None:
                        decision.turns, decision.input_tokens, decision.output_tokens = (
                            turn,
                            *tokens,
                        )
                        if withheld and decision.label_id is not None:
                            decision.flag("decided without images the content filter refused")
                        return decision
                    results.append(ToolResult(call.call_id, f"Error: {error}"))
                else:
                    results.append(await self._run_tool(agent_id, task_id, call))
            items = results
        raise LabellingError(f"no decision on task {task_id} in {self._settings.max_turns} turns")

    async def _run_tool(self, agent_id: str, task_id: int, call: ToolCall) -> ToolResult:
        if call.name not in VIEW_TOOLS:
            return ToolResult(call.call_id, f"Error: there is no tool {call.name}.")
        if call.arguments is None:
            return ToolResult(call.call_id, "Error: the arguments are not valid JSON.")
        arguments = {k: v for k, v in call.arguments.items() if k not in BOUND_ARGUMENTS}
        unknown = set(arguments) - self._properties[call.name]
        if unknown:
            return ToolResult(call.call_id, f"Error: unknown arguments {sorted(unknown)}.")
        try:
            if call.name == "get_views":
                output = await agent_mcp.get_views(agent_id, task_id, **arguments)
                output = await _until_drawn(agent_id, task_id, output, self._settings.view_wait_s)
            else:
                output = await agent_mcp.probe_timeseries(agent_id, task_id, **arguments)
        except (ToolError, TypeError) as exc:
            return ToolResult(call.call_id, f"Error: {exc}")
        payload, images = _split(output)
        return ToolResult(call.call_id, json.dumps(payload), images)

    def _decision(self, arguments: dict[str, Any] | None) -> tuple[Decision | None, str]:
        if arguments is None:
            return None, "the arguments are not valid JSON."
        comment = str(arguments.get("comment") or "").strip()
        if not comment:
            return None, "comment is required: explain the decision."
        label_id = arguments.get("label_id")
        if label_id is None:
            return Decision(None, 0, _clip(comment)), ""
        if label_id not in self._labels:
            return None, f"label_id must be one of {sorted(self._labels)}, or null to skip."
        confidence = arguments.get("confidence")
        if not isinstance(confidence, int) or not 0 <= confidence <= 5:
            return None, "confidence must be a whole number from 0 to 5."
        form_values = arguments.get("form_values") or None
        if form_values is not None and not isinstance(form_values, dict):
            return None, "form_values must be an object keyed by form field id."
        missing = [f for f in self._required_fields if f not in (form_values or {})]
        if missing:
            return None, f"fill the required form fields {missing}."
        decision = Decision(label_id, confidence, _clip(comment), form_values)
        if arguments.get("flagged_for_review"):
            decision.flag(str(arguments.get("flag_comment") or "").strip())
        return decision, ""

    async def _submit(self, agent_id: str, task_id: int, decision: Decision) -> None:
        if decision.label_id is None:
            await agent_mcp.skip_task(agent_id, task_id, decision.comment)
            return
        await agent_mcp.submit_label(
            agent_id,
            task_id,
            decision.label_id,
            decision.confidence,
            decision.comment,
            form_values=decision.form_values,
            flagged_for_review=decision.flagged_for_review,
            flag_comment=_clip(decision.flag_comment) if decision.flag_comment else None,
        )

    def _report(
        self,
        name: str,
        task: dict[str, Any],
        decision: Decision,
        votes: list[Decision],
        seconds: float,
    ) -> None:
        flagged = " (flagged)" if decision.flagged_for_review else ""
        log.info(
            "%s: task %s -> %s, confidence %s%s",
            name,
            task["task_id"],
            self._name(decision.label_id),
            decision.confidence,
            flagged,
        )
        if self._log_path is None:
            return
        record = {
            "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "agent": name,
            "task_id": task["task_id"],
            "annotation_number": task.get("annotation_number"),
            "label_id": decision.label_id,
            "label": self._name(decision.label_id),
            "confidence": decision.confidence,
            "flagged_for_review": decision.flagged_for_review,
            "flag_comment": decision.flag_comment,
            "comment": decision.comment,
            "votes": [
                {k: v for k, v in asdict(vote).items() if k != "form_values"} for vote in votes
            ],
            "seconds": round(seconds, 1),
        }
        with self._log_path.open("a") as file:
            file.write(json.dumps(record) + "\n")


async def _send(
    session: Session, items: list[UserTurn | ToolResult], force_tool: str | None
) -> tuple[ModelReply, bool]:
    """Send a turn; when the content filter refuses its images, send it once more without
    them. Returns the reply and whether images were left out."""
    try:
        return await session.send(items, force_tool), False
    except ContentBlockedError:
        if not any(item.images for item in items):
            raise
    stripped = [
        replace(item, images=[], text=f"{item.text}\n\n{IMAGES_WITHHELD}") for item in items
    ]
    return await session.send(stripped, force_tool), True


@dataclass
class RunOptions:
    url: str
    campaign_id: int | None
    agent_ids: list[str]
    agents: int = 1
    tasks_per_agent: int = 10
    task_set_id: int | None = None
    name_prefix: str = "api"
    first_look: list[dict[str, Any]] | None = None
    max_image_edge_px: int = 2048
    max_image_megapixels: float = 4.0
    watch: bool = True
    log_path: Path | None = None
    settings: Settings = field(default_factory=lambda: Settings(instructions=""))


async def run(options: RunOptions, provider: Provider) -> int:
    try:
        await provider.check()
    except Exception as exc:
        raise LabellingError(f"The model API failed a test call: {exc}") from exc
    await agent_mcp.login(options.url)
    agents: list[tuple[str, str]] = []
    context: dict[str, Any] | None = None
    if options.agent_ids:
        for agent_id in options.agent_ids:
            await agent_mcp.set_image_limits(
                agent_id, options.max_image_edge_px, options.max_image_megapixels
            )
            if options.first_look:
                await agent_mcp.set_default_views(agent_id, cast(Any, options.first_look))
            agent = await agent_mcp._agent(agent_id)
            agents.append((agent_id, agent["name"]))
        context = json.loads(await agent_mcp.campaign_context(options.agent_ids[0]))
    elif options.campaign_id is not None:
        for i in range(1, options.agents + 1):
            registered = json.loads(
                await agent_mcp.register_agent(
                    options.campaign_id,
                    f"{options.name_prefix}-{i}",
                    options.max_image_edge_px,
                    options.max_image_megapixels,
                    description="Labelled through a model API with stacnotator-label",
                    task_count=options.tasks_per_agent,
                    task_set_id=options.task_set_id,
                    takes_over_work=True,
                    default_views=cast(Any, options.first_look),
                    watch_window=options.watch and i == 1,
                )
            )
            agent = registered["agent"]
            if "render_browser" in registered:
                raise LabellingError(registered["render_browser"])
            agents.append((agent["agent_id"], agent["name"]))
            context = context or registered["context"]
            log.info("registered %s (%s)", agent["name"], agent["agent_id"])
        log.info("progress: %s", registered["agents_page"])
    if context is None:
        raise LabellingError("Pass --campaign or at least one --agent-id.")
    tools = tool_specs(await agent_mcp.server.list_tools())
    labeller = Labeller(provider, options.settings, context, tools, options.log_path)
    results = await asyncio.gather(
        *(labeller.work(agent_id, name) for agent_id, name in agents), return_exceptions=True
    )
    failed = 0
    for (agent_id, name), result in zip(agents, results, strict=True):
        if isinstance(result, BaseException):
            failed += 1
            log.error("%s (%s) stopped: %s", name, agent_id, result)
    if failed:
        log.error(
            "Resume with --agent-id for the stopped agents, or free their tasks with "
            "`stacnotator-label release`."
        )
    return 1 if failed else 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="stacnotator-label",
        description="Label STACNotator campaign tasks with a model API.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    run_cmd = commands.add_parser("run", help="register agents (or resume them) and label")
    run_cmd.add_argument("--url", required=True, help="the STACNotator web app, https://...")
    target = run_cmd.add_mutually_exclusive_group(required=True)
    target.add_argument("--campaign", type=int, help="campaign id to register new agents on")
    target.add_argument(
        "--agent-id", action="append", default=[], help="resume an agent (repeatable)"
    )
    run_cmd.add_argument(
        "--instructions",
        type=Path,
        required=True,
        help="file with the labelling rules and photo-interpretation guidance",
    )
    run_cmd.add_argument("--agents", type=int, default=1, help="agents to register")
    run_cmd.add_argument("--tasks-per-agent", type=int, default=10)
    run_cmd.add_argument("--task-set-id", type=int)
    run_cmd.add_argument("--name-prefix", default="api", help="agents are named <prefix>-<n>")
    run_cmd.add_argument(
        "--first-look", type=Path, help="JSON list of 1-4 views shown first for every task"
    )
    run_cmd.add_argument(
        "--votes",
        type=int,
        default=1,
        help="independent sessions per task; when they disagree, another session decides",
    )
    run_cmd.add_argument("--max-turns", type=int, default=8, help="model replies per session")
    run_cmd.add_argument("--imagery-wait", type=float, default=120.0, help="seconds")
    run_cmd.add_argument("--view-wait", type=float, default=30.0, help="seconds")
    run_cmd.add_argument("--max-image-edge-px", type=int, default=2048)
    run_cmd.add_argument("--max-image-megapixels", type=float, default=4.0)
    run_cmd.add_argument("--no-watch", action="store_true", help="no window showing the views")
    run_cmd.add_argument("--log", type=Path, help="append one JSON line per task here")

    model = run_cmd.add_argument_group("model API")
    model.add_argument("--provider", choices=sorted(PROVIDERS), default="openai")
    model.add_argument("--model", required=True, help="model, or Azure deployment, name")
    model.add_argument(
        "--base-url", help="API endpoint, e.g. https://<resource>.openai.azure.com/openai/v1/"
    )
    model.add_argument("--api-key-env", default="OPENAI_API_KEY", help="env var with the key")
    model.add_argument(
        "--entra",
        nargs="?",
        const="https://cognitiveservices.azure.com/.default",
        metavar="SCOPE",
        help="sign in with Microsoft Entra ID (az login) instead of an API key",
    )
    model.add_argument("--entra-tenant", help="the resource's tenant id, if not your default")
    model.add_argument("--reasoning", help="reasoning effort, e.g. low, medium, high")
    model.add_argument("--arbiter-reasoning", help="reasoning effort of the deciding session")
    model.add_argument("--image-detail", default="high")

    release = commands.add_parser("release", help="free your agents' unfinished tasks")
    release.add_argument("--url", required=True)
    release.add_argument("--campaign", type=int, required=True)
    release.add_argument("--agent-id")
    return parser


def _options(args: argparse.Namespace) -> RunOptions:
    if args.votes < 1 or args.max_turns < 2 or args.agents < 1:
        raise SystemExit("--votes and --agents must be at least 1, --max-turns at least 2.")
    instructions = args.instructions.read_text().strip()
    if not instructions:
        raise SystemExit(f"{args.instructions} is empty.")
    first_look = json.loads(args.first_look.read_text()) if args.first_look else None
    return RunOptions(
        url=args.url,
        campaign_id=args.campaign,
        agent_ids=args.agent_id,
        agents=args.agents,
        tasks_per_agent=args.tasks_per_agent,
        task_set_id=args.task_set_id,
        name_prefix=args.name_prefix,
        first_look=first_look,
        max_image_edge_px=args.max_image_edge_px,
        max_image_megapixels=args.max_image_megapixels,
        watch=not args.no_watch,
        log_path=args.log,
        settings=Settings(
            instructions=instructions,
            votes=args.votes,
            reasoning=args.reasoning,
            arbiter_reasoning=args.arbiter_reasoning,
            max_turns=args.max_turns,
            imagery_wait_s=args.imagery_wait,
            view_wait_s=args.view_wait,
        ),
    )


async def _release(url: str, campaign_id: int, agent_id: str | None) -> None:
    await agent_mcp.login(url)
    log.info("%s", await agent_mcp.release_tasks(campaign_id, agent_id))


def main(argv: list[str] | None = None) -> None:
    # force: importing the MCP server has already configured logging its own way.
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(message)s", stream=sys.stdout, force=True
    )
    for noisy in ("httpx", "httpx2", "openai", "azure"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    args = _parser().parse_args(argv)
    try:
        if args.command == "release":
            asyncio.run(_release(args.url, args.campaign, args.agent_id))
            return
        options = _options(args)
        provider = PROVIDERS[args.provider](
            ProviderConfig(
                model=args.model,
                base_url=args.base_url,
                api_key_env=args.api_key_env,
                entra_scope=args.entra,
                entra_tenant=args.entra_tenant,
                image_detail=args.image_detail,
            )
        )
        sys.exit(asyncio.run(run(options, provider)))
    except (ToolError, LabellingError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc
    except KeyboardInterrupt:
        raise SystemExit(
            "Stopped. The agents keep their unfinished tasks: resume with --agent-id, or free "
            "them with `stacnotator-label release`."
        ) from None


if __name__ == "__main__":
    main()

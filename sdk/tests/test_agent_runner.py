import asyncio
import json
from types import SimpleNamespace

import pytest
from mcp.server.mcpserver import Image
from mcp.server.mcpserver.exceptions import ToolError

from stacnotator import agent_mcp, agent_runner
from stacnotator._model_api import (
    ContentBlockedError,
    ModelReply,
    OpenAIResponses,
    ToolCall,
    ToolResult,
    ToolSpec,
    UserTurn,
)

AGENT = "agent-1"
TASK = {"task_id": 5, "annotation_number": 1, "lat": 1.5, "lon": 30.0}
CONTEXT = {
    "name": "Crops",
    "guide_markdown": "the campaign's own guide",
    "labels": [{"id": 1, "name": "crop"}, {"id": 2, "name": "fallow"}],
    "form_fields": [{"id": 9, "title": "Season", "required": True}],
}
JPEG = b"\xff\xd8jpeg"


def bundle(missing: bool = False) -> list[str | Image]:
    cell = {"i": 0, "label": "#0 May 2026, z15", **({"tiles_missing": True} if missing else {})}
    payload = {
        "reply": 1,
        "task": TASK,
        "views": [{"view": {"cells": []}, "image": 1, "meta": {"cells": [cell]}}],
    }
    return [json.dumps(payload), Image(data=JPEG, format="jpeg")]


class ScriptedModel:
    """Each session answers with the next scripted list of replies."""

    def __init__(self, *scripts: list[ModelReply | Exception]):
        self.scripts = list(scripts)
        self.sent: list[list[UserTurn | ToolResult]] = []
        self.only: list[object] = []
        self.instructions: list[str] = []

    def session(self, instructions, tools):
        self.instructions.append(instructions)
        replies = self.scripts.pop(0)
        model = self

        class _Session:
            async def send(self, items, only=None):
                model.sent.append(list(items))
                model.only.append(only)
                reply = replies.pop(0)
                if isinstance(reply, Exception):
                    raise reply
                return reply

        return _Session()


def call(name: str, **arguments) -> ModelReply:
    return ModelReply("", [ToolCall(f"c-{name}", name, arguments)])


def labeller(model, **kwargs) -> agent_runner.Labeller:
    return agent_runner.Labeller(model, "Rules: crops are green.", CONTEXT, [], **kwargs)


@pytest.fixture
def server(monkeypatch):
    """The MCP tools the runner calls; submit_label refuses label 7 the way the backend does."""
    calls: list[tuple[str, dict]] = []

    async def get_views(agent_id, task_id, views):
        calls.append(("get_views", {"views": views}))
        return bundle()

    async def submit_label(agent_id, task_id, label_id, confidence, comment, **rest):
        calls.append(("submit_label", {"label_id": label_id, **rest}))
        if label_id == 7:
            raise ToolError("Label 7 is not one of this campaign's labels")
        return '{"ok": true}'

    async def skip_task(agent_id, task_id, comment):
        calls.append(("skip_task", {"comment": comment}))
        return '{"ok": true}'

    tools = {"get_views": get_views, "submit_label": submit_label, "skip_task": skip_task}
    monkeypatch.setattr(agent_runner, "TOOLS", tools)
    monkeypatch.setattr(agent_mcp, "skip_task", skip_task)
    return calls


def test_a_session_runs_the_tools_and_feeds_back_rejected_labels(server):
    model = ScriptedModel(
        [
            call("get_views", agent_id="x", views=[{"cells": []}]),
            call("submit_label", label_id=7, confidence=3, comment="looks cropped"),
            call("submit_label", label_id=1, confidence=4, comment="green in May"),
        ]
    )
    answer = asyncio.run(labeller(model).label(AGENT, TASK, bundle(missing=True)))

    assert answer.arguments["label_id"] == 1 and answer.turns == 3
    assert server[0] == ("get_views", {"views": [{"cells": []}]})
    tool_result = model.sent[1][0]
    assert tool_result.call_id == "c-get_views" and tool_result.images == [JPEG]
    assert "Label 7 is not one of" in model.sent[2][0].text
    assert server[-1][1]["flagged_for_review"]
    assert "imagery missing for: #0 May 2026" in server[-1][1]["flag_comment"]
    assert "Rules: crops are green." in model.instructions[0]
    assert "the campaign's own guide" not in model.instructions[0]


def test_the_last_turn_may_only_finish(server):
    model = ScriptedModel(
        [call("get_views", views=[{"cells": []}]), call("skip_task", comment="all cloud")]
    )
    answer = asyncio.run(labeller(model, max_turns=2).label(AGENT, TASK, bundle()))

    assert model.only == [None, agent_runner.FINISH_TOOLS]
    assert answer.arguments["label_id"] is None and server[-1][0] == "skip_task"


def test_images_the_content_filter_refuses_are_left_out_and_the_label_flagged(server):
    model = ScriptedModel(
        [
            ContentBlockedError("blocked"),
            call("submit_label", label_id=1, confidence=2, comment="x"),
        ]
    )
    asyncio.run(labeller(model).label(AGENT, TASK, bundle()))

    retried = model.sent[1][0]
    assert retried.images == [] and agent_runner.IMAGES_WITHHELD in retried.text
    assert server[-1][1]["flagged_for_review"]


def test_a_task_the_filter_refuses_even_without_images_is_skipped(server):
    model = ScriptedModel([ContentBlockedError("blocked"), ContentBlockedError("blocked")])
    answer = asyncio.run(labeller(model).label(AGENT, TASK, bundle()))

    assert answer.arguments["label_id"] is None
    assert server == [("skip_task", {"comment": answer.arguments["comment"]})]
    assert "content filter" in answer.arguments["comment"]


def test_view_tools_hide_the_arguments_the_runner_binds():
    tools = asyncio.run(agent_mcp.server.list_tools())
    specs = {spec.name: spec for spec in agent_runner.tool_specs(tools)}

    assert set(specs) == set(agent_runner.TOOLS)
    for spec in specs.values():
        assert not {"agent_id", "task_id"} & set(spec.parameters["properties"])
        assert not {"agent_id", "task_id"} & set(spec.parameters.get("required", []))


def test_responses_session_chains_turns_and_returns_images_from_tools():
    requests = []

    async def create(**params):
        requests.append(params)
        call = SimpleNamespace(
            type="function_call", call_id="c1", name="get_views", arguments='{"views": []}'
        )
        return SimpleNamespace(
            id=f"r{len(requests)}",
            output=[call],
            output_text="",
            usage=SimpleNamespace(input_tokens=10, output_tokens=2),
            incomplete_details=None,
        )

    client = SimpleNamespace(responses=SimpleNamespace(create=create))
    tools = [ToolSpec(name, "", {}) for name in ("get_views", "submit_label", "skip_task")]
    session = OpenAIResponses(client, "gpt-6-astra", "high").session("rules", tools)
    first = asyncio.run(session.send([UserTurn("look", [JPEG])]))
    asyncio.run(session.send([ToolResult("c1", "{}", [JPEG])], only=("submit_label", "skip_task")))

    assert first.tool_calls == [ToolCall("c1", "get_views", {"views": []})]
    assert "previous_response_id" not in requests[0]
    assert requests[0]["reasoning"] == {"effort": "high"}
    output = requests[1]["input"][0]
    assert requests[1]["previous_response_id"] == "r1"
    assert requests[1]["tool_choice"] == "required"
    assert [tool["name"] for tool in requests[1]["tools"]] == ["submit_label", "skip_task"]
    assert output["type"] == "function_call_output" and output["call_id"] == "c1"
    assert output["output"][1]["image_url"].startswith("data:image/jpeg;base64,")


def test_a_failing_model_stops_the_run_before_any_agent_is_registered(monkeypatch):
    class Refusing:
        async def check(self):
            raise RuntimeError("404 deployment not found")

    async def login(url):
        raise AssertionError("signed in despite the failed check")

    monkeypatch.setattr(agent_mcp, "login", login)
    options = agent_runner.RunOptions(
        url="https://x", campaign_id=1, agent_ids=[], instructions="rules"
    )
    with pytest.raises(agent_runner.LabellingError, match="404 deployment not found"):
        asyncio.run(agent_runner.run(options, Refusing()))

import asyncio
import json
from types import SimpleNamespace

import pytest
from mcp.server.mcpserver import Image

from stacnotator import _model_api, agent_mcp, agent_runner
from stacnotator._model_api import (
    ContentBlockedError,
    ModelReply,
    OpenAIResponses,
    ToolCall,
    ToolResult,
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
        self.sessions: list[tuple[str, str | None]] = []

    def session(self, instructions, tools, reasoning):
        self.sessions.append((instructions, reasoning))
        replies = self.scripts.pop(0)
        model = self

        class _Session:
            async def send(self, items, force_tool=None):
                model.sent.append(list(items))
                reply = replies.pop(0)
                if isinstance(reply, Exception):
                    raise reply
                return reply

        return _Session()


def decide(**arguments) -> ModelReply:
    return ModelReply("", [ToolCall("c-decide", "decide", arguments)])


def labeller(model, **settings) -> agent_runner.Labeller:
    tools = [
        _model_api.ToolSpec("get_views", "", {"properties": {"views": {}}}),
        agent_runner.DECIDE,
    ]
    return agent_runner.Labeller(
        model,
        agent_runner.Settings(instructions="Rules: crops are green.", **settings),
        CONTEXT,
        tools,
    )


@pytest.fixture
def views(monkeypatch):
    calls = []

    async def get_views(agent_id, task_id, views):
        calls.append(views)
        return bundle()

    monkeypatch.setattr(agent_mcp, "get_views", get_views)
    return calls


def test_a_session_runs_the_view_tools_and_feeds_back_invalid_decisions(views):
    model = ScriptedModel(
        [
            ModelReply(
                "", [ToolCall("c1", "get_views", {"agent_id": "x", "views": [{"cells": []}]})]
            ),
            decide(label_id=7, confidence=3, comment="looks cropped"),
            decide(label_id=1, confidence=4, comment="green in May", form_values={"9": "spring"}),
        ]
    )
    decision, _ = asyncio.run(labeller(model).label(AGENT, TASK, bundle()))

    assert (decision.label_id, decision.confidence, decision.turns) == (1, 4, 3)
    assert views == [[{"cells": []}]]
    tool_result = model.sent[1][0]
    assert tool_result.call_id == "c1" and tool_result.images == [JPEG]
    assert "label_id must be one of [1, 2]" in model.sent[2][0].text
    instructions = model.sessions[0][0]
    assert "Rules: crops are green." in instructions
    assert "the campaign's own guide" not in instructions


def test_disagreeing_votes_go_to_an_arbiter_with_their_reasons(views):
    model = ScriptedModel(
        [decide(label_id=1, confidence=4, comment="green", form_values={"9": "a"})],
        [
            decide(
                label_id=2,
                confidence=2,
                comment="bare",
                form_values={"9": "a"},
                flagged_for_review=True,
                flag_comment="unsure",
            )
        ],
        [decide(label_id=2, confidence=3, comment="bare in June", form_values={"9": "a"})],
    )
    run = labeller(model, votes=2, reasoning="medium", arbiter_reasoning="high")
    decision, votes = asyncio.run(run.label(AGENT, TASK, bundle()))

    assert decision.label_id == 2 and len(votes) == 3
    assert decision.comment.startswith("Arbitrated (conf 3): bare in June | V1 crop")
    assert decision.flagged_for_review and decision.flag_comment == "unsure"
    assert [reasoning for _, reasoning in model.sessions] == ["medium", "medium", "high"]
    arbiter_opening = model.sent[-1][0]
    assert "Interpreter 2: fallow, confidence 2. bare" in arbiter_opening.text


def test_images_the_content_filter_refuses_are_left_out_and_the_label_flagged(views):
    model = ScriptedModel(
        [
            ContentBlockedError("blocked"),
            decide(label_id=1, confidence=2, comment="from values", form_values={"9": "a"}),
        ]
    )
    decision, _ = asyncio.run(labeller(model).label(AGENT, TASK, bundle()))

    retried = model.sent[1][0]
    assert retried.images == [] and agent_runner.IMAGES_WITHHELD in retried.text
    assert decision.flagged_for_review


def test_a_task_the_filter_refuses_even_without_images_is_skipped(views):
    model = ScriptedModel([ContentBlockedError("blocked"), ContentBlockedError("blocked")])
    decision, _ = asyncio.run(labeller(model).label(AGENT, TASK, bundle()))

    assert decision.label_id is None and "content filter" in decision.comment


def test_views_with_missing_tiles_are_drawn_again_until_complete(monkeypatch):
    drawn = [bundle(missing=True), bundle()]

    async def get_views(agent_id, task_id, views):
        return drawn.pop(0)

    monkeypatch.setattr(agent_mcp, "get_views", get_views)
    monkeypatch.setattr(agent_runner, "REDRAW_EVERY_S", 0)
    output = asyncio.run(agent_runner._until_drawn(AGENT, 5, bundle(missing=True), 60))

    assert drawn == [] and agent_runner._missing_tiles(json.loads(output[0])) == []


def test_view_tools_hide_the_arguments_the_runner_binds():
    tools = asyncio.run(agent_mcp.server.list_tools())
    specs = {spec.name: spec for spec in agent_runner.tool_specs(tools)}

    assert set(specs) == {"get_views", "probe_timeseries", "decide"}
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
    session = OpenAIResponses(client, "gpt-6-astra").session("rules", [], "high")
    first = asyncio.run(session.send([UserTurn("look", [JPEG])]))
    asyncio.run(session.send([ToolResult("c1", "{}", [JPEG])], force_tool="decide"))

    assert first.tool_calls == [ToolCall("c1", "get_views", {"views": []})]
    assert "previous_response_id" not in requests[0]
    assert requests[0]["reasoning"] == {"effort": "high"}
    output = requests[1]["input"][0]
    assert requests[1]["previous_response_id"] == "r1"
    assert requests[1]["tool_choice"] == {"type": "function", "name": "decide"}
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
        url="https://x", campaign_id=1, agent_ids=[], settings=agent_runner.Settings("rules")
    )
    with pytest.raises(agent_runner.LabellingError, match="404 deployment not found"):
        asyncio.run(agent_runner.run(options, Refusing()))

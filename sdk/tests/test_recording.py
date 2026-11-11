import asyncio
import json

import pytest

from stacnotator import agent_mcp
from stacnotator._recording import Recording, read_recording

EVENT = {
    "agent": {"agent_id": "a", "name": "Scout"},
    "task": {"task_id": 1, "lat": 2, "lon": 3},
    "action": "get_views",
    "request": {"views": [{"cells": [{"slice_id": 7}]}]},
    "result": {"reply": 123},
    "images": ["exact-image-bytes"],
}


def test_recording_does_not_need_render_browsers_or_a_viewer(monkeypatch):
    def no_browser():
        raise AssertionError("Recording must not use a browser")

    recording = Recording()
    monkeypatch.setattr(agent_mcp, "_browsers", no_browser)
    monkeypatch.setattr(agent_mcp, "_recording", lambda: recording)
    assert (
        asyncio.run(
            agent_mcp._record_step(
                "a",
                EVENT["task"],
                EVENT["action"],
                EVENT["request"],
                EVENT["result"],
                EVENT["images"],
            )
        )
        is None
    )
    records = recording.read()
    assert records[0]["images"] == EVENT["images"]
    assert records[0]["request"] == EVENT["request"]
    assert records[0]["result"]["reply"] == 123
    assert recording.path.stat().st_mode & 0o777 == 0o600
    assert records[0]["version"] == 1
    assert records[0]["time"]


def test_reader_rejects_an_incomplete_recording_instead_of_hiding_missing_steps(tmp_path):
    path = tmp_path / "run.jsonl"
    path.write_text(json.dumps({"version": 1, **EVENT}) + "\n{")
    with pytest.raises(ValueError, match="line 2"):
        read_recording(path)


def test_recordings_are_separate_for_each_deployment(monkeypatch):
    agent_mcp._recordings.cache_clear()
    monkeypatch.setattr(agent_mcp, "_session_url", "https://first.example")
    first = agent_mcp._recording()
    first.append(EVENT)
    monkeypatch.setattr(agent_mcp, "_session_url", "https://second.example")
    second = agent_mcp._recording()
    assert second.path != first.path
    assert second.read() == []
    monkeypatch.setattr(agent_mcp, "_session_url", "https://first.example")
    assert agent_mcp._recording().read()[0]["result"] == EVENT["result"]

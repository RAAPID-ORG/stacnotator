"""Feedback has to say something - a verdict counts as saying it."""

import pytest
from pydantic import ValidationError

from src.visualizers.schemas import VisualizerArea, VisualizerFeedbackCreate

AREA = VisualizerArea(west=0, south=0, east=1, north=1)


def test_a_verdict_alone_is_feedback():
    payload = VisualizerFeedbackCreate(area=AREA, verdict="good")

    assert payload.verdict == "good"
    assert payload.note is None


def test_a_note_alone_is_still_feedback():
    assert VisualizerFeedbackCreate(area=AREA, note="the field is bare here").verdict is None


def test_silence_is_not():
    with pytest.raises(ValidationError):
        VisualizerFeedbackCreate(area=AREA, note="   ")


def test_only_the_two_verdicts_parse():
    with pytest.raises(ValidationError):
        VisualizerFeedbackCreate(area=AREA, verdict="maybe")

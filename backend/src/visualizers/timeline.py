"""Turn a campaign imagery source into the dated timelines a visualizer shows.

A source is authored for annotation: collections group slices into windows, and a
window may carry a dedicated cover composited over the whole window. A visualizer
has a date slider instead, so it needs ordered lists of intervals.

A source carrying dedicated covers holds two records at two cadences - monthly
composites over weekly acquisitions, say - and collapsing them into one list
throws the coarser one away. So a source is offered as two timelines exactly
when its covers are demonstrably coarser than its slices; otherwise as one, the
covers left out. Pure and DB-free so both rules can be tested on their own.
"""

from dataclasses import dataclass
from datetime import date
from statistics import median


@dataclass(frozen=True)
class SliceInput:
    slice_id: int
    name: str
    start_date: str
    end_date: str
    is_dedicated_cover: bool


@dataclass(frozen=True)
class Step:
    slice_id: int
    label: str
    start_date: str
    end_date: str


@dataclass(frozen=True)
class Timeline:
    """One cadence of one source: what the date slider steps through."""

    cadence: str
    steps: list[Step]


def timelines(slices: list[SliceInput]) -> list[Timeline]:
    """The one or two dated records this source holds.

    Two only when the covers are a genuinely coarser record than the slices.
    Equal cadences mean the cover is a composite of the same period its slice
    already covers, which is a rendering choice rather than a second record, so
    that stays one timeline.
    """
    covers = flatten([s for s in slices if s.is_dedicated_cover], covers=True)
    steps = flatten(slices)
    if not steps:
        return [Timeline(cadence=cadence(covers), steps=covers)] if covers else []
    if not covers:
        return [Timeline(cadence=cadence(steps), steps=steps)]

    coarse, fine = cadence(covers), cadence(steps)
    if coarse == fine or _median_span(covers) <= _median_span(steps):
        return [Timeline(cadence=fine, steps=steps)]
    return [Timeline(cadence=coarse, steps=covers), Timeline(cadence=fine, steps=steps)]


def cadence(steps: list[Step]) -> str:
    """What to call how often these intervals come round.

    Named only where the name is unambiguous; anything else reports the length
    it actually has rather than being rounded to a name it does not deserve.
    """
    if not steps:
        return "undated"
    days = _median_span(steps)
    if days <= 1.5:
        return "daily"
    if 6 <= days <= 8:
        return "weekly"
    if 13 <= days <= 16:
        return "fortnightly"
    if 27 <= days <= 32:
        return "monthly"
    if 88 <= days <= 94:
        return "quarterly"
    if 360 <= days <= 370:
        return "yearly"
    return f"{round(days)}-day"


def _median_span(steps: list[Step]) -> float:
    """Days one interval covers, end inclusive. Median so one odd trailing
    partial period does not rename the whole record."""
    spans = []
    for step in steps:
        start, end = _parsed(step.start_date), _parsed(step.end_date)
        if start and end:
            spans.append((end - start).days + 1)
    return median(spans) if spans else 0


def flatten(slices: list[SliceInput], *, covers: bool = False) -> list[Step]:
    """The source's intervals of one kind, oldest first.

    Intervals repeated across collections collapse into the step that comes
    first, so a slider never offers the same date twice.
    """
    steps: list[Step] = []
    seen: set[tuple[str, str]] = set()
    for s in sorted(
        (s for s in slices if s.is_dedicated_cover == covers),
        key=lambda s: (s.start_date, s.end_date, s.slice_id),
    ):
        span = (s.start_date, s.end_date)
        if span in seen:
            continue
        seen.add(span)
        steps.append(
            Step(
                slice_id=s.slice_id,
                label=s.name.strip() or interval_label(s.start_date, s.end_date),
                start_date=s.start_date,
                end_date=s.end_date,
            )
        )
    return steps


def interval_label(start_date: str, end_date: str) -> str:
    """What the date slider prints under a step when the slice has no name."""
    if start_date == end_date:
        return _pretty(start_date)
    if _covers_whole_month(start_date, end_date):
        return _month(start_date)
    return f"{_pretty(start_date)} - {_pretty(end_date)}"


_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _parsed(value: str) -> date | None:
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _pretty(value: str) -> str:
    parsed = _parsed(value)
    if parsed is None:
        return value
    return f"{parsed.day} {_MONTHS[parsed.month - 1]} {parsed.year}"


def _month(value: str) -> str:
    parsed = _parsed(value)
    if parsed is None:
        return value
    return f"{_MONTHS[parsed.month - 1]} {parsed.year}"


def _covers_whole_month(start_date: str, end_date: str) -> bool:
    start, end = _parsed(start_date), _parsed(end_date)
    if start is None or end is None or start.day != 1:
        return False
    return (start.year, start.month) == (end.year, end.month) and end.day >= 28

"""Flatten a campaign imagery source into the one dated timeline a visualizer shows.

A source is authored for annotation: collections group slices into windows, and a
window may carry a dedicated cover composited over the whole window. None of that
survives here - a visualizer has a date slider, so it needs a single ordered list
of intervals. Pure and DB-free so the flattening rule can be tested on its own.
"""

from dataclasses import dataclass
from datetime import date


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


def flatten(slices: list[SliceInput]) -> list[Step]:
    """The source's browsable intervals, oldest first.

    Dedicated covers are dropped: they are a composite over a whole window
    rather than a date anyone can point at. Intervals repeated across
    collections collapse into the step that comes first.
    """
    steps: list[Step] = []
    seen: set[tuple[str, str]] = set()
    for s in sorted(
        (s for s in slices if not s.is_dedicated_cover),
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

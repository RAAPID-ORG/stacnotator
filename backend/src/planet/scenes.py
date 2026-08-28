"""Grouping Planet scenes into the windows and slices a source is made of (pure).

A Planet scene is not addressable imagery. It becomes tiles only once a set of scene
ids has been minted into a layer, and a layer is one flat picture with no time in it.
What this module decides is which ids belong together and in what order - one list per
slice - so the caller can mint one layer each and store what comes back.

The periods come from the generator config rather than from the scenes themselves,
which is what makes a scene source browse like every other source: a slice is a date
range, and "daily" is just a slice period of one day.
"""

import calendar
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from src.planet.schemas import PlanetScenesGenerationConfigV1

# One POST carries every id, and a layer of the clearest few hundred already has no
# gaps left to fill.
MAX_SCENES_PER_LAYER = 200


@dataclass(frozen=True)
class Scene:
    """One acquisition, reduced to what grouping needs."""

    # ``ItemType:id``, the form the layers endpoint takes.
    id: str
    acquired: date
    # 0-100, higher is clearer.
    quality: float


@dataclass(frozen=True)
class Period:
    """A date range, both ends inclusive - the same convention as a stored slice."""

    start: date
    end: date


@dataclass(frozen=True)
class SliceGroup:
    period: Period
    scene_ids: tuple[str, ...]


@dataclass(frozen=True)
class WindowGroup:
    """One collection: its slices, and the cover stacked from the whole window."""

    period: Period
    cover: SliceGroup | None
    slices: tuple[SliceGroup, ...]


def quality(properties: dict[str, Any]) -> float:
    """How clear a scene is, 0-100.

    ``clear_percent`` exists only on newer items, so ``cloud_cover`` stands in where it
    is missing, weighted lower because it is a coarser measure that misses thin cloud.
    Scoring both onto one scale is what keeps an older item rankable against a newer
    one instead of being dropped for lacking a field.
    """
    clear = properties.get("clear_percent")
    if clear is not None:
        return float(clear)
    cloud = properties.get("cloud_cover")
    if cloud is None:
        return 0.0
    return (1.0 - float(cloud)) * 50.0


def scene(feature: dict[str, Any]) -> Scene | None:
    """One search result as a ``Scene``, or None if it is missing what grouping needs."""
    properties = feature.get("properties") or {}
    item_type = properties.get("item_type")
    acquired = properties.get("acquired")
    if not feature.get("id") or not item_type or not acquired:
        return None
    try:
        day = date.fromisoformat(str(acquired)[:10])
    except ValueError:
        return None
    return Scene(id=f"{item_type}:{feature['id']}", acquired=day, quality=quality(properties))


def scenes(features: Iterable[dict[str, Any]]) -> list[Scene]:
    return [s for s in (scene(f) for f in features) if s is not None]


def _add_months(start: date, months: int) -> date:
    total = start.month - 1 + months
    year, month = start.year + total // 12, total % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return start.replace(year=year, month=month, day=day)


def _advance(start: date, interval: int, unit: str) -> date:
    if unit == "days":
        return start + timedelta(days=interval)
    if unit == "weeks":
        return start + timedelta(weeks=interval)
    if unit == "months":
        return _add_months(start, interval)
    return _add_months(start, interval * 12)


def periods(start: date, end: date, interval: int, unit: str) -> list[Period]:
    """Consecutive ranges covering ``start``..``end``, stepping from ``start``.

    Stepping from the start date rather than snapping to the calendar keeps the ranges
    contiguous whatever is asked for; a caller wanting calendar months starts on the
    first of one.
    """
    out: list[Period] = []
    cursor = start
    while cursor <= end:
        following = _advance(cursor, interval, unit)
        out.append(Period(cursor, min(following - timedelta(days=1), end)))
        cursor = following
    return out


def layer_ids(candidates: Iterable[Scene]) -> tuple[str, ...]:
    """The ids one layer is minted from: the clearest few hundred, in draw order.

    A layer stacks its ids in the order it is given them, so the best scene is emitted
    last. Which end Planet actually draws on top is the one thing here that has to be
    confirmed against the live service - flipping it is this ``reversed`` and its test.
    Ties break on the id so the same search always mints the same layer.
    """
    kept = sorted(candidates, key=lambda s: (s.quality, s.id), reverse=True)[:MAX_SCENES_PER_LAYER]
    return tuple(s.id for s in reversed(kept))


def group(
    features: Iterable[dict[str, Any]], config: PlanetScenesGenerationConfigV1
) -> list[WindowGroup]:
    """Expand a search result into the windows and slices the source is made of.

    A window with nothing in it is dropped rather than stored empty: an imagery window
    that can never render is worse than one that is not offered.
    """
    found = scenes(features)
    windows: list[WindowGroup] = []
    for window in periods(
        date.fromisoformat(config.start_date),
        date.fromisoformat(config.end_date),
        config.collection_period_interval,
        config.collection_period_unit,
    ):
        inside = [s for s in found if window.start <= s.acquired <= window.end]
        slices = tuple(
            SliceGroup(period, ids)
            for period in periods(
                window.start, window.end, config.slice_period_interval, config.slice_period_unit
            )
            if (ids := layer_ids(s for s in inside if period.start <= s.acquired <= period.end))
        )
        cover = (
            SliceGroup(window, layer_ids(inside)) if config.whole_window_cover and inside else None
        )
        if cover or slices:
            windows.append(WindowGroup(window, cover, slices))
    return windows

"""Pure helpers for mapping a campaign's timeseries onto canvas windows.

Timeseries are grouped into canvas windows by ``window_name``: every timeseries
sharing a name renders in the same window, and unnamed timeseries collapse into
one default window. Kept DB-free so the grouping and layout-reconciliation logic
can be unit-tested without a database (tests/unit/test_timeseries_windows.py).
"""

from collections.abc import Iterable

from src.utils import find_free_position_in_layout

# Every timeseries belongs to a named window; series with no explicit window land
# in this one. It's an ordinary window, not a special case - just the default the
# schema and migration fill in.
DEFAULT_TIMESERIES_WINDOW_NAME = "Time series"
TIMESERIES_WINDOW_KEY_PREFIX = "timeseries:"


def window_grid_key(window_name: str) -> str:
    """Grid key for the window a timeseries belongs to."""
    name = window_name.strip() or DEFAULT_TIMESERIES_WINDOW_NAME
    return f"{TIMESERIES_WINDOW_KEY_PREFIX}{name}"


def is_timeseries_window_key(key: str) -> bool:
    """Whether a grid key belongs to a timeseries window."""
    return key.startswith(TIMESERIES_WINDOW_KEY_PREFIX)


def distinct_window_keys(window_names: Iterable[str]) -> list[str]:
    """Ordered, de-duplicated grid keys for the given timeseries window names."""
    keys: list[str] = []
    for name in window_names:
        key = window_grid_key(name)
        if key not in keys:
            keys.append(key)
    return keys


def sync_timeseries_windows_in_layout(
    layout_data: list[dict],
    desired_keys: list[str],
    *,
    window_width: int = 10,
    window_height: int = 8,
    grid_width: int = 60,
) -> bool:
    """Reconcile a canvas layout's timeseries windows with ``desired_keys``.

    Adds a packed entry for each desired key that isn't placed yet and drops any
    timeseries window entry no longer wanted (its last timeseries was deleted or
    moved to another window). Non-timeseries entries are left untouched. Mutates
    ``layout_data`` in place; returns True if it changed anything.
    """
    desired = set(desired_keys)
    changed = False

    # Drop timeseries windows that are no longer wanted.
    kept: list[dict] = []
    for item in layout_data:
        key = item.get("i")
        if isinstance(key, str) and is_timeseries_window_key(key) and key not in desired:
            changed = True
            continue
        kept.append(item)
    if changed:
        layout_data[:] = kept

    # Add any desired window that isn't placed yet, packing around what exists.
    present = {item.get("i") for item in layout_data}
    for key in desired_keys:
        if key in present:
            continue
        x, y = find_free_position_in_layout(
            layout_data=layout_data,
            item_width=window_width,
            item_height=window_height,
            grid_width=grid_width,
        )
        layout_data.append({"i": key, "x": x, "y": y, "w": window_width, "h": window_height})
        present.add(key)
        changed = True

    return changed

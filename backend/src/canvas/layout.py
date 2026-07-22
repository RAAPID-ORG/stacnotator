"""Pure canvas-layout logic, DB-free for unit testing.

A layout is a list of react-grid-layout items ``{i, x, y, w, h}`` sharing one
grid. The main layout (page chrome, timeseries windows) and per-view layouts
(imagery windows) are stored as separate rows but merge into a single grid on
the client, which is why placement sometimes needs a ``min_y`` floor: items of
one layout must clear the items of another that the packer cannot see.
"""

from collections.abc import Callable, Collection, Sequence

GRID_WIDTH = 60

# Page chrome of the annotation canvas: main map, minimap, controls.
DEFAULT_MAIN_CANVAS_LAYOUT = [
    {"i": "main", "x": 0, "y": 0, "w": 43, "h": 25},
    {"i": "minimap", "x": 50, "y": 0, "w": 10, "h": 10},
    {"i": "controls", "x": 43, "y": 0, "w": 7, "h": 25},
]

# Imagery view windows arrange in rows below the main canvas.
VIEW_WINDOW_W = 10
VIEW_WINDOW_H = 9
VIEW_LAYOUT_START_Y = 25


def layout_bottom(layout_data: list[dict] | None) -> int:
    """Lowest occupied grid row (max y+h) across the items, 0 when empty."""
    return max(
        (int(it.get("y", 0)) + int(it.get("h", 0)) for it in (layout_data or [])),
        default=0,
    )


def find_free_position_in_layout(
    layout_data: list[dict],
    item_width: int,
    item_height: int,
    grid_width: int = GRID_WIDTH,
    min_y: int = 0,
) -> tuple[int, int]:
    """First (x, y) at or below ``min_y`` where an item of the given size fits.

    Scans top-to-bottom, left-to-right. The canvas scrolls vertically, so there
    is always a fit below the existing items.
    """
    occupied_spaces = [
        {
            "x": item.get("x", 0),
            "y": item.get("y", 0),
            "w": item.get("w", 0),
            "h": item.get("h", 0),
        }
        for item in layout_data
    ]

    def is_position_free(x: int, y: int) -> bool:
        for space in occupied_spaces:
            if not (
                x + item_width <= space["x"]
                or x >= space["x"] + space["w"]
                or y + item_height <= space["y"]
                or y >= space["y"] + space["h"]
            ):
                return False
        return True

    current_y = min_y
    while True:
        for x in range(0, grid_width - item_width + 1):
            if is_position_free(x, current_y):
                return (x, current_y)
        current_y += 1


def reconcile_layout(
    layout_data: list[dict],
    *,
    managed: Callable[[str], bool],
    keep: Collection[str],
    add: Sequence[str],
    item_width: int,
    item_height: int,
    grid_width: int = GRID_WIDTH,
    min_y: int = 0,
) -> bool:
    """Reconcile a layout's managed items against the desired window set.

    Drops items whose key is ``managed`` but not in ``keep``; packs an item for
    each key in ``add`` that isn't placed yet. Items outside ``managed`` (page
    chrome, other features' windows) and existing placements are never touched -
    sync adds and removes, it never repositions. ``keep`` and ``add`` are
    separate so a caller can retain windows without re-adding ones the user has
    hidden. Mutates ``layout_data`` in place; returns True if it changed
    anything.
    """
    changed = False

    kept: list[dict] = []
    for item in layout_data:
        key = item.get("i")
        if isinstance(key, str) and managed(key) and key not in keep:
            changed = True
            continue
        kept.append(item)
    if changed:
        layout_data[:] = kept

    present = {item.get("i") for item in layout_data}
    for key in add:
        if key in present:
            continue
        x, y = find_free_position_in_layout(
            layout_data,
            item_width=item_width,
            item_height=item_height,
            grid_width=grid_width,
            min_y=min_y,
        )
        layout_data.append({"i": key, "x": x, "y": y, "w": item_width, "h": item_height})
        present.add(key)
        changed = True

    return changed


def packed_layout(
    keys: Sequence[str],
    *,
    item_width: int,
    item_height: int,
    grid_width: int = GRID_WIDTH,
    min_y: int = 0,
) -> list[dict]:
    """A fresh layout with one packed item per key, filling rows from ``min_y``."""
    items: list[dict] = []
    reconcile_layout(
        items,
        managed=lambda _: True,
        keep=(),
        add=keys,
        item_width=item_width,
        item_height=item_height,
        grid_width=grid_width,
        min_y=min_y,
    )
    return items

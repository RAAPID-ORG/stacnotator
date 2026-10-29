"""What a canvas layout is, DB-free: react-grid-layout items ``{i, x, y, w, h}`` placed
by key, and the keys of the windows it hides.

The main layout (page chrome, time-series windows) and per-view layouts (imagery
windows) are separate rows that the client merges into one grid. Which windows exist
is not stored here: every time-series window of the campaign and every collection of
a view's sources is one. A layout only says where it puts them and which it hides;
one it does neither for is placed by the client wherever there is room.
"""

from src.timeseries.windows import TIMESERIES_WINDOW_KEY_PREFIX

# Page chrome of the annotation canvas: main map, minimap, controls.
DEFAULT_MAIN_CANVAS_LAYOUT = [
    {"i": "main", "x": 0, "y": 0, "w": 43, "h": 25, "slice_navigation": True},
    {"i": "minimap", "x": 50, "y": 0, "w": 10, "h": 10},
    {"i": "controls", "x": 43, "y": 0, "w": 7, "h": 25},
]


def is_window_key(key: str) -> bool:
    """An imagery window (a collection id) or a time-series window, as opposed to
    page chrome."""
    return key.isdigit() or key.startswith(TIMESERIES_WINDOW_KEY_PREFIX)


def remapped_layout(
    layout_data: list[dict], hidden: list[str], key_map: dict[str, str]
) -> tuple[list[dict], list[str]]:
    """The layout of a copy: window keys rewritten onto the copy's ids, windows that
    did not survive the copy dropped, chrome passed through. Inputs are not mutated."""
    items = []
    for item in layout_data:
        key = str(item.get("i", ""))
        if not is_window_key(key):
            items.append(dict(item))
        elif key in key_map:
            items.append({**item, "i": key_map[key]})
    return items, [key_map[key] for key in hidden if key in key_map]

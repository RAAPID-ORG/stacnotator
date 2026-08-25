from src.canvas.layout import (
    DEFAULT_MAIN_CANVAS_LAYOUT,
    VIEW_LAYOUT_START_Y,
    VIEW_WINDOW_H,
    VIEW_WINDOW_W,
    find_free_position_in_layout,
    layout_bottom,
    packed_layout,
    reconcile_layout,
)


class TestLayoutBottom:
    def test_empty(self):
        assert layout_bottom([]) == 0
        assert layout_bottom(None) == 0

    def test_max_of_y_plus_h(self):
        layout = [
            {"i": "a", "x": 0, "y": 0, "w": 10, "h": 10},
            {"i": "b", "x": 10, "y": 5, "w": 10, "h": 20},
        ]
        assert layout_bottom(layout) == 25


class TestFindFreePositionInLayout:
    def test_empty_layout(self):
        x, y = find_free_position_in_layout([], item_width=10, item_height=10)
        assert (x, y) == (0, 0)

    def test_places_next_to_existing(self):
        layout = [{"x": 0, "y": 0, "w": 10, "h": 10}]
        x, y = find_free_position_in_layout(layout, item_width=10, item_height=10)
        assert x == 10
        assert y == 0

    def test_wraps_to_next_row(self):
        layout = [{"x": 0, "y": 0, "w": 60, "h": 10}]
        x, y = find_free_position_in_layout(layout, item_width=10, item_height=10, grid_width=60)
        assert x == 0
        assert y >= 1

    def test_finds_gap(self):
        layout = [
            {"x": 0, "y": 0, "w": 10, "h": 10},
            {"x": 30, "y": 0, "w": 10, "h": 10},
        ]
        x, y = find_free_position_in_layout(layout, item_width=10, item_height=10)
        assert x == 10
        assert y == 0

    def test_multiple_items_tightly_packed(self):
        # Three 20-wide items in a 60-wide grid should fill row 0
        layout = [
            {"x": 0, "y": 0, "w": 20, "h": 10},
            {"x": 20, "y": 0, "w": 20, "h": 10},
            {"x": 40, "y": 0, "w": 20, "h": 10},
        ]
        x, y = find_free_position_in_layout(layout, item_width=20, item_height=10, grid_width=60)
        # First row is full, must go to the start of the row below
        assert (x, y) == (0, 10)

    def test_item_too_wide_for_gap(self):
        # 5-wide gap can't fit a 10-wide item
        layout = [
            {"x": 0, "y": 0, "w": 25, "h": 10},
            {"x": 30, "y": 0, "w": 30, "h": 10},
        ]
        x, y = find_free_position_in_layout(layout, item_width=10, item_height=10, grid_width=60)
        # Can't fit in the 5-wide gap, should go below
        assert y >= 1 or x >= 30 + 30

    def test_staggered_heights(self):
        # Short item on left, tall item on right - new item should fit
        # next to the short one if it starts below its bottom edge
        layout = [
            {"x": 0, "y": 0, "w": 30, "h": 5},
            {"x": 30, "y": 0, "w": 30, "h": 20},
        ]
        x, y = find_free_position_in_layout(layout, item_width=30, item_height=10, grid_width=60)
        # Should fit at (0, 5) - below the short item but overlapping
        # vertically with the tall item only on the right half
        assert x == 0
        assert y == 5

    def test_l_shaped_gap(self):
        # Top-left occupied, bottom-right occupied - gap at top-right
        layout = [
            {"x": 0, "y": 0, "w": 30, "h": 10},
            {"x": 0, "y": 10, "w": 60, "h": 10},
        ]
        x, y = find_free_position_in_layout(layout, item_width=20, item_height=10, grid_width=60)
        assert x == 30
        assert y == 0

    def test_real_default_layout(self):
        x, y = find_free_position_in_layout(
            DEFAULT_MAIN_CANVAS_LAYOUT,
            item_width=10,
            item_height=10,
            grid_width=60,
        )
        # Gap at (50, 10) is 10 wide and below the minimap
        assert x == 50
        assert y == 10

    def test_single_cell_items(self):
        # Grid of 1x1 items filling a small area
        layout = [{"x": i, "y": 0, "w": 1, "h": 1} for i in range(10)]
        x, y = find_free_position_in_layout(layout, item_width=1, item_height=1, grid_width=60)
        assert x == 10
        assert y == 0

    def test_item_exactly_fills_remaining_width(self):
        layout = [{"x": 0, "y": 0, "w": 50, "h": 10}]
        x, y = find_free_position_in_layout(layout, item_width=10, item_height=10, grid_width=60)
        assert x == 50
        assert y == 0

    def test_min_y_floor(self):
        # An empty grid with a floor: nothing may be placed above min_y.
        x, y = find_free_position_in_layout([], item_width=10, item_height=10, min_y=25)
        assert (x, y) == (0, 25)


class TestReconcileLayout:
    def test_unmanaged_items_never_dropped(self):
        layout = [
            {"i": "main", "x": 0, "y": 0, "w": 43, "h": 25},
            {"i": "ts:a", "x": 0, "y": 25, "w": 10, "h": 8},
        ]
        changed = reconcile_layout(
            layout,
            managed=lambda k: k.startswith("ts:"),
            keep=set(),
            add=[],
            item_width=10,
            item_height=8,
        )
        assert changed is True
        assert [it["i"] for it in layout] == ["main"]

    def test_add_skips_present_and_never_repositions(self):
        layout = [{"i": "ts:a", "x": 30, "y": 5, "w": 12, "h": 6}]
        changed = reconcile_layout(
            layout,
            managed=lambda k: k.startswith("ts:"),
            keep={"ts:a", "ts:b"},
            add=["ts:a", "ts:b"],
            item_width=10,
            item_height=8,
        )
        assert changed is True
        existing = next(it for it in layout if it["i"] == "ts:a")
        assert (existing["x"], existing["y"], existing["w"], existing["h"]) == (30, 5, 12, 6)
        assert any(it["i"] == "ts:b" for it in layout)

    def test_keep_without_add_leaves_hidden_windows_hidden(self):
        # "7" is in the view's window set (keep) but absent from this layout
        # because the user hid it; it must not reappear unless freshly added.
        layout = [{"i": "5", "x": 0, "y": 25, "w": 10, "h": 9}]
        changed = reconcile_layout(
            layout,
            managed=lambda _: True,
            keep={"5", "7"},
            add=[],
            item_width=10,
            item_height=9,
        )
        assert changed is False
        assert [it["i"] for it in layout] == ["5"]

    def test_no_change_is_reported(self):
        layout = [{"i": "ts:a", "x": 0, "y": 0, "w": 10, "h": 8}]
        changed = reconcile_layout(
            layout,
            managed=lambda k: k.startswith("ts:"),
            keep={"ts:a"},
            add=["ts:a"],
            item_width=10,
            item_height=8,
        )
        assert changed is False

    def test_added_items_respect_min_y(self):
        layout: list[dict] = []
        reconcile_layout(
            layout,
            managed=lambda _: True,
            keep=set(),
            add=["a", "b"],
            item_width=10,
            item_height=9,
            min_y=25,
        )
        assert all(it["y"] >= 25 for it in layout)


class TestPackedLayout:
    def test_view_windows_fill_rows_below_main_canvas(self):
        # Seven 10-wide windows on a 60-wide grid: six in the first row below
        # the chrome, the seventh wrapping to the next row.
        keys = [str(i) for i in range(7)]
        layout = packed_layout(
            keys,
            item_width=VIEW_WINDOW_W,
            item_height=VIEW_WINDOW_H,
            min_y=VIEW_LAYOUT_START_Y,
        )
        assert [it["i"] for it in layout] == keys
        assert [(it["x"], it["y"]) for it in layout[:6]] == [
            (i * VIEW_WINDOW_W, VIEW_LAYOUT_START_Y) for i in range(6)
        ]
        assert (layout[6]["x"], layout[6]["y"]) == (0, VIEW_LAYOUT_START_Y + VIEW_WINDOW_H)

    def test_empty_keys(self):
        assert packed_layout([], item_width=10, item_height=9) == []

    def test_windows_never_land_on_the_main_layout(self):
        """The regression: a first view packed blind put its windows straight
        on top of the timeseries windows stacked down the right."""
        main = [
            {"i": "main", "x": 0, "y": 0, "w": 43, "h": 25},
            {"i": "controls", "x": 43, "y": 0, "w": 7, "h": 25},
            {"i": "minimap", "x": 50, "y": 0, "w": 10, "h": 10},
            {"i": "timeseries:a", "x": 50, "y": 10, "w": 10, "h": 11},
            {"i": "timeseries:b", "x": 50, "y": 21, "w": 10, "h": 11},
        ]
        layout = packed_layout(
            [str(i) for i in range(12)],
            item_width=VIEW_WINDOW_W,
            item_height=VIEW_WINDOW_H,
            min_y=VIEW_LAYOUT_START_Y,
            obstacles=main,
        )

        def overlaps(a: dict, b: dict) -> bool:
            return not (
                a["x"] + a["w"] <= b["x"]
                or b["x"] + b["w"] <= a["x"]
                or a["y"] + a["h"] <= b["y"]
                or b["y"] + b["h"] <= a["y"]
            )

        assert len(layout) == 12
        assert not any(overlaps(window, chrome) for window in layout for chrome in main)

    def test_windows_fill_the_row_beside_the_timeseries_column(self):
        """With timeseries down the right, the free width beside them is the
        first thing filled - not the row underneath everything."""
        main = [
            {"i": "main", "x": 0, "y": 0, "w": 43, "h": 25},
            {"i": "controls", "x": 43, "y": 0, "w": 7, "h": 25},
            {"i": "minimap", "x": 50, "y": 0, "w": 10, "h": 10},
            {"i": "timeseries:a", "x": 50, "y": 10, "w": 10, "h": 11},
            {"i": "timeseries:b", "x": 50, "y": 21, "w": 10, "h": 11},
        ]
        layout = packed_layout(
            [str(i) for i in range(5)],
            item_width=VIEW_WINDOW_W,
            item_height=VIEW_WINDOW_H,
            min_y=VIEW_LAYOUT_START_Y,
            obstacles=main,
        )
        assert [(it["x"], it["y"]) for it in layout] == [
            (i * VIEW_WINDOW_W, VIEW_LAYOUT_START_Y) for i in range(5)
        ]

    def test_obstacles_are_not_part_of_the_packed_layout(self):
        main = [{"i": "main", "x": 0, "y": 0, "w": 43, "h": 25}]
        layout = packed_layout(["7"], item_width=10, item_height=9, min_y=25, obstacles=main)
        assert [it["i"] for it in layout] == ["7"]

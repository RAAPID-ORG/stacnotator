from src.canvas.layout import remapped_layout
from src.canvas.schemas import CanvasLayoutCreate


def test_navigation_panel_preferences_survive_layout_serialization():
    items = [
        {"i": "main", "x": 0, "y": 0, "w": 40, "h": 25, "slice_navigation": True},
        {"i": "timeline", "x": 0, "y": 25, "w": 40, "h": 5, "orientation": "horizontal"},
        {
            "i": "imagery",
            "x": 40,
            "y": 0,
            "w": 12,
            "h": 25,
            "orientation": "vertical",
            "expanded_sections": ["sources", "slices"],
        },
    ]
    layout = CanvasLayoutCreate(main_layout_data=items)
    stored = [item.model_dump(exclude_none=True) for item in layout.main_layout_data]
    assert stored == items
    assert CanvasLayoutCreate(main_layout_data=stored) == layout


class TestRemappedLayout:
    KEYS = {"10": "110", "20": "220", "timeseries:3": "timeseries:33"}

    def test_window_keys_follow_the_copy_and_keep_their_place(self):
        items, hidden = remapped_layout(
            [
                {"i": "10", "x": 0, "y": 40, "w": 10, "h": 11},
                {"i": "timeseries:3", "x": 10, "y": 40, "w": 10, "h": 11},
            ],
            ["20"],
            self.KEYS,
        )
        assert [(item["i"], item["x"]) for item in items] == [("110", 0), ("timeseries:33", 10)]
        assert hidden == ["220"]

    def test_chrome_passes_through_and_lost_windows_are_dropped(self):
        layout = [
            {"i": "main", "x": 0, "y": 0, "w": 44, "h": 26},
            {"i": "99", "x": 0, "y": 40, "w": 10, "h": 11},
            {"i": "timeseries:9", "x": 0, "y": 50, "w": 10, "h": 11},
        ]
        items, hidden = remapped_layout(layout, ["99"], self.KEYS)
        assert items == [layout[0]]
        assert hidden == []
        assert layout[1]["i"] == "99"

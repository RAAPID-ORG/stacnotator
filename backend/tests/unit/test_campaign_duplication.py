"""DB-free tests for the pure pieces of campaign duplication."""

from src.campaigns.duplication import clone_row, remapped_layout_data
from src.campaigns.models import TaskSet
from src.imagery.models import ImagerySlice


class TestRemappedLayoutData:
    def test_numeric_keys_follow_the_collection_map(self):
        layout = [
            {"i": "10", "x": 0, "y": 40, "w": 10, "h": 11},
            {"i": "20", "x": 10, "y": 40, "w": 10, "h": 11},
        ]
        result = remapped_layout_data(layout, {10: 110, 20: 220})
        assert [item["i"] for item in result] == ["110", "220"]
        assert result[0]["x"] == 0 and result[1]["x"] == 10

    def test_chrome_and_timeseries_keys_pass_through(self):
        layout = [
            {"i": "main", "x": 0, "y": 0, "w": 44, "h": 26},
            {"i": "timeseries:NDVI", "x": 0, "y": 26, "w": 44, "h": 14},
        ]
        assert remapped_layout_data(layout, {}) == layout

    def test_unmapped_collection_windows_are_dropped(self):
        layout = [{"i": "10", "x": 0, "y": 40, "w": 10, "h": 11}]
        assert remapped_layout_data(layout, {99: 199}) == []

    def test_input_items_are_not_mutated(self):
        layout = [{"i": "10", "x": 0, "y": 40, "w": 10, "h": 11}]
        remapped_layout_data(layout, {10: 110})
        assert layout[0]["i"] == "10"


class TestCloneRow:
    def test_copies_columns_and_applies_overrides(self):
        original = ImagerySlice(
            id=5,
            collection_id=7,
            name="Week 1",
            start_date="2024-01-01",
            end_date="2024-01-07",
            display_order=3,
        )
        copy = clone_row(original, collection_id=70)
        assert copy.id is None
        assert copy.collection_id == 70
        assert (copy.name, copy.start_date, copy.end_date, copy.display_order) == (
            "Week 1",
            "2024-01-01",
            "2024-01-07",
            3,
        )

    def test_primary_key_never_carries_over(self):
        original = TaskSet(id=9, campaign_id=1, name="Round 1")
        copy = clone_row(original, campaign_id=2)
        assert copy.id is None
        assert copy.campaign_id == 2
        assert copy.name == "Round 1"

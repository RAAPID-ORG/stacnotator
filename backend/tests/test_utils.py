"""Tests for utility functions."""

from datetime import datetime

from src.campaigns.constants import DEFAULT_CAMPAIGN_MAIN_CANVAS_LAYOUT
from src.utils import (
    clean_filename,
    find_free_position_in_layout,
    format_date_to_yyyymmdd,
    parse_ym_to_date,
    snake_to_camel,
)


class TestCleanFilename:
    def test_basic(self):
        assert clean_filename("Hello World") == "hello_world"

    def test_special_characters(self):
        assert clean_filename("file@name#1!") == "file_name_1"

    def test_unicode(self):
        assert clean_filename("café résumé") == "cafe_resume"

    def test_truncation(self):
        result = clean_filename("a" * 100, max_length=10)
        assert len(result) == 10

    def test_empty_string(self):
        assert clean_filename("") == ""

    def test_none_passthrough(self):
        assert clean_filename(None) is None

    def test_leading_trailing_underscores_stripped(self):
        assert clean_filename("  hello  ") == "hello"


class TestSnakeToCamel:
    def test_basic(self):
        assert snake_to_camel("get_campaign_list") == "getCampaignList"

    def test_single_word(self):
        assert snake_to_camel("health") == "health"

    def test_two_words(self):
        assert snake_to_camel("create_campaign") == "createCampaign"

    def test_many_underscores(self):
        assert snake_to_camel("get_all_user_annotations") == "getAllUserAnnotations"


class TestParseYmToDate:
    def test_basic(self):
        assert parse_ym_to_date("202501") == datetime(2025, 1, 1)

    def test_december(self):
        assert parse_ym_to_date("202312") == datetime(2023, 12, 1)


class TestFormatDateToYyyymmdd:
    def test_basic(self):
        assert format_date_to_yyyymmdd(datetime(2025, 1, 15)) == "20250115"

    def test_single_digit_month_day(self):
        assert format_date_to_yyyymmdd(datetime(2025, 3, 5)) == "20250305"


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
        # First row is full, must go to row below
        assert y >= 1

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
            DEFAULT_CAMPAIGN_MAIN_CANVAS_LAYOUT,
            item_width=10,
            item_height=10,
            grid_width=60,
        )
        # Gap at (50, 14) is 10 wide and below the minimap
        assert x == 50
        assert y == 14

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

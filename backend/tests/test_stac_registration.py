"""Tests for STAC registration helpers (imagery/stac_registration.py)."""

import json

from src.imagery.stac_registration import (
    _fill_placeholders,
    resolve_tile_url,
)


class TestFillPlaceholders:
    def test_replaces_temporal_placeholders(self):
        search_body = json.dumps(
            {
                "datetime": "{startDatetimePlaceholder}/{endDatetimePlaceholder}",
            }
        )
        result = _fill_placeholders(
            search_body,
            start_date="2020-01-01T00:00:00Z",
            end_date="2020-12-31T23:59:59Z",
            bbox=[-10, -20, 10, 20],
        )
        assert result["datetime"] == "2020-01-01T00:00:00Z/2020-12-31T23:59:59Z"

    def test_replaces_bbox_placeholder(self):
        search_body = json.dumps(
            {
                "bbox": "{campaignBBoxPlaceholder}",
            }
        )
        result = _fill_placeholders(
            search_body,
            start_date="2020-01-01",
            end_date="2020-12-31",
            bbox=[-10, -20, 10, 20],
        )
        assert result["bbox"] == [-10, -20, 10, 20]

    def test_preserves_other_fields(self):
        search_body = json.dumps(
            {
                "collections": ["sentinel-2"],
                "limit": 100,
                "datetime": "{startDatetimePlaceholder}/{endDatetimePlaceholder}",
            }
        )
        result = _fill_placeholders(
            search_body,
            start_date="2020-01-01",
            end_date="2020-12-31",
            bbox=[0, 0, 1, 1],
        )
        assert result["collections"] == ["sentinel-2"]
        assert result["limit"] == 100

    def test_bbox_overrides_existing(self):
        search_body = json.dumps(
            {
                "bbox": [0, 0, 0, 0],
            }
        )
        result = _fill_placeholders(
            search_body,
            start_date="2020-01-01",
            end_date="2020-12-31",
            bbox=[-10, -20, 10, 20],
        )
        assert result["bbox"] == [-10, -20, 10, 20]


class TestResolveTileUrl:
    def test_replaces_search_id(self):
        template = "https://tiles.example.com/{searchId}/tiles/{z}/{x}/{y}"
        result = resolve_tile_url(template, "abc123")
        assert result == "https://tiles.example.com/abc123/tiles/{z}/{x}/{y}"

    def test_no_placeholder_unchanged(self):
        template = "https://tiles.example.com/static/tiles"
        result = resolve_tile_url(template, "abc123")
        assert result == template

from datetime import UTC, datetime

from src.tiling.stac_client import (
    bbox_intersects,
    datetime_in_range,
    parse_datetime_range,
)


class TestParseDatetimeRange:
    def test_none_and_empty(self):
        assert parse_datetime_range(None) == (None, None)
        assert parse_datetime_range("") == (None, None)

    def test_start_end(self):
        start, end = parse_datetime_range("2020-01-01T00:00:00Z/2020-12-31T23:59:59Z")
        assert start == datetime(2020, 1, 1, tzinfo=UTC)
        assert end == datetime(2020, 12, 31, 23, 59, 59, tzinfo=UTC)

    def test_open_sides(self):
        assert parse_datetime_range("../2020-12-31T00:00:00Z")[0] is None
        assert parse_datetime_range("2020-01-01T00:00:00Z/..")[1] is None

    def test_single_value_is_start_only(self):
        start, end = parse_datetime_range("2020-06-01T00:00:00Z")
        assert start == datetime(2020, 6, 1, tzinfo=UTC)
        assert end is None

    def test_bad_value_is_ignored(self):
        assert parse_datetime_range("not-a-date/also-bad") == (None, None)


class TestBboxIntersects:
    def test_overlapping(self):
        assert bbox_intersects([0, 0, 10, 10], [5, 5, 15, 15]) is True

    def test_disjoint(self):
        assert bbox_intersects([0, 0, 1, 1], [5, 5, 6, 6]) is False

    def test_missing_boxes_never_exclude(self):
        assert bbox_intersects(None, [0, 0, 1, 1]) is True
        assert bbox_intersects([0, 0, 1, 1], None) is True

    def test_handles_3d_bbox(self):
        # 6-length item bbox (has z) still intersects a 2D query box.
        assert bbox_intersects([0, 0, 100, 10, 10, 500], [5, 5, 15, 15]) is True
        assert bbox_intersects([0, 0, 100, 1, 1, 500], [5, 5, 6, 6]) is False


class TestDatetimeInRange:
    def test_within(self):
        dt = datetime(2020, 6, 1, tzinfo=UTC)
        assert datetime_in_range(
            dt, datetime(2020, 1, 1, tzinfo=UTC), datetime(2020, 12, 31, tzinfo=UTC)
        )

    def test_before_start(self):
        dt = datetime(2019, 1, 1, tzinfo=UTC)
        assert datetime_in_range(dt, datetime(2020, 1, 1, tzinfo=UTC), None) is False

    def test_after_end(self):
        dt = datetime(2021, 1, 1, tzinfo=UTC)
        assert datetime_in_range(dt, None, datetime(2020, 12, 31, tzinfo=UTC)) is False

    def test_undated_item_is_kept(self):
        assert datetime_in_range(None, datetime(2020, 1, 1, tzinfo=UTC), None) is True

    def test_naive_item_datetime_is_coerced(self):
        # A naive datetime must not raise when compared against aware bounds.
        naive = datetime(2020, 6, 1)
        assert datetime_in_range(naive, datetime(2020, 1, 1, tzinfo=UTC), None) is True

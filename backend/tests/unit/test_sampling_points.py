"""Unit tests for generate_random_points (sampling_design/service.py) -- pure, DB-free."""

import pytest
from shapely.geometry import MultiPolygon, Point, box

from src.sampling_design.service import generate_random_points


class TestGenerateRandomPoints:
    def test_correct_count(self):
        polygon = box(-10, -20, 10, 20)
        points = generate_random_points(polygon, 50, seed=42)
        assert len(points) == 50

    def test_all_within_boundary(self):
        polygon = box(-10, -20, 10, 20)
        points = generate_random_points(polygon, 100, seed=42)
        for pt in points:
            assert isinstance(pt, Point)
            assert polygon.contains(pt) or polygon.touches(pt)

    def test_deterministic_with_seed(self):
        polygon = box(0, 0, 1, 1)
        points_a = generate_random_points(polygon, 20, seed=123)
        points_b = generate_random_points(polygon, 20, seed=123)
        for a, b in zip(points_a, points_b, strict=True):
            assert a.x == pytest.approx(b.x)
            assert a.y == pytest.approx(b.y)

    def test_different_seeds_give_different_points(self):
        polygon = box(0, 0, 1, 1)
        points_a = generate_random_points(polygon, 20, seed=1)
        points_b = generate_random_points(polygon, 20, seed=2)
        coords_a = [(p.x, p.y) for p in points_a]
        coords_b = [(p.x, p.y) for p in points_b]
        assert coords_a != coords_b

    def test_multipolygon_boundary(self):
        multi = MultiPolygon([box(0, 0, 1, 1), box(10, 10, 11, 11)])
        points = generate_random_points(multi, 30, seed=42)
        assert len(points) == 30
        for pt in points:
            assert multi.contains(pt) or multi.touches(pt)

    def test_single_point(self):
        polygon = box(0, 0, 1, 1)
        points = generate_random_points(polygon, 1, seed=42)
        assert len(points) == 1

    def test_no_seed_still_returns_requested_count(self):
        polygon = box(0, 0, 1, 1)
        points = generate_random_points(polygon, 10, seed=None)
        assert len(points) == 10

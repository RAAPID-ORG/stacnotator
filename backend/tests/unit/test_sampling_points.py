"""Unit tests for the sampling strategies and their config schemas -- pure, DB-free."""

import numpy as np
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from pyproj import Geod
from shapely.geometry import MultiPolygon, Point, Polygon, box

from src.sampling_design.schemas import parse_sampling_strategy
from src.sampling_design.service import generate_grid_points, generate_random_points

GEOD = Geod(ellps="WGS84")


def rng(seed: int | None = 42) -> np.random.Generator:
    return np.random.default_rng(seed)


class TestGenerateRandomPoints:
    def test_correct_count(self):
        polygon = box(-10, -20, 10, 20)
        points = generate_random_points(polygon, 50, rng())
        assert len(points) == 50

    def test_all_within_boundary(self):
        polygon = box(-10, -20, 10, 20)
        points = generate_random_points(polygon, 100, rng())
        for pt in points:
            assert isinstance(pt, Point)
            assert polygon.contains(pt) or polygon.touches(pt)

    def test_deterministic_with_seed(self):
        polygon = box(0, 0, 1, 1)
        points_a = generate_random_points(polygon, 20, rng(123))
        points_b = generate_random_points(polygon, 20, rng(123))
        for a, b in zip(points_a, points_b, strict=True):
            assert a.x == pytest.approx(b.x)
            assert a.y == pytest.approx(b.y)

    def test_different_seeds_give_different_points(self):
        polygon = box(0, 0, 1, 1)
        coords_a = [(p.x, p.y) for p in generate_random_points(polygon, 20, rng(1))]
        coords_b = [(p.x, p.y) for p in generate_random_points(polygon, 20, rng(2))]
        assert coords_a != coords_b

    def test_multipolygon_boundary(self):
        multi = MultiPolygon([box(0, 0, 1, 1), box(10, 10, 11, 11)])
        points = generate_random_points(multi, 30, rng())
        assert len(points) == 30
        for pt in points:
            assert multi.contains(pt) or multi.touches(pt)

    def test_single_point(self):
        polygon = box(0, 0, 1, 1)
        assert len(generate_random_points(polygon, 1, rng())) == 1

    def test_unseeded_rng_still_returns_requested_count(self):
        polygon = box(0, 0, 1, 1)
        assert len(generate_random_points(polygon, 10, rng(None))) == 10


class TestGenerateGridPoints:
    def test_neighbours_sit_one_spacing_apart(self):
        points = generate_grid_points(box(0, 0, 1, 1), spacing_km=10, rng=rng())
        assert len(points) > 4

        nearest = []
        for a in points:
            distances = [GEOD.inv(a.x, a.y, b.x, b.y)[2] / 1000 for b in points if b is not a]
            nearest.append(min(distances))
        assert min(nearest) == pytest.approx(10, rel=0.03)
        assert max(nearest) == pytest.approx(10, rel=0.03)

    def test_count_follows_region_area(self):
        points = generate_grid_points(box(0, 0, 1, 1), spacing_km=10, rng=rng())
        assert 100 < len(points) < 150

    def test_all_within_boundary_with_hole(self):
        region = Polygon(
            [(0, 0), (1, 0), (1, 1), (0, 1)],
            holes=[[(0.4, 0.4), (0.6, 0.4), (0.6, 0.6), (0.4, 0.6)]],
        )
        points = generate_grid_points(region, spacing_km=5, rng=rng())
        assert points
        for pt in points:
            assert region.contains(pt)

    def test_multipolygon_boundary(self):
        multi = MultiPolygon([box(0, 0, 0.5, 0.5), box(3, 3, 3.5, 3.5)])
        points = generate_grid_points(multi, spacing_km=10, rng=rng())
        assert points
        for pt in points:
            assert multi.contains(pt)

    def test_deterministic_with_same_rng_seed(self):
        region = box(0, 0, 1, 1)
        coords_a = [(p.x, p.y) for p in generate_grid_points(region, 10, rng(7))]
        coords_b = [(p.x, p.y) for p in generate_grid_points(region, 10, rng(7))]
        assert coords_a == coords_b

    def test_different_seeds_shift_the_grid(self):
        region = box(0, 0, 1, 1)
        coords_a = [(p.x, p.y) for p in generate_grid_points(region, 10, rng(1))]
        coords_b = [(p.x, p.y) for p in generate_grid_points(region, 10, rng(2))]
        assert coords_a != coords_b

    def test_points_come_back_shuffled(self):
        # Handed out in lattice order, consecutive tasks would sit one spacing
        # apart, so a half-finished campaign would cover only one corner.
        points = generate_grid_points(box(0, 0, 1, 1), spacing_km=10, rng=rng())
        steps = [
            GEOD.inv(a.x, a.y, b.x, b.y)[2] / 1000 for a, b in zip(points, points[1:], strict=False)
        ]
        assert np.median(steps) > 30

    def test_spacing_finer_than_the_task_cap_is_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            generate_grid_points(box(-1, -1, 1, 1), spacing_km=1, rng=rng())
        assert exc_info.value.status_code == 400
        assert "10000" in str(exc_info.value.detail).replace(",", "")

    def test_spacing_larger_than_region_is_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            generate_grid_points(box(0, 0, 0.01, 0.01), spacing_km=50, rng=rng())
        assert exc_info.value.status_code == 400


class TestParseSamplingStrategy:
    def test_parses_random(self):
        strategy = parse_sampling_strategy('{"strategy_type":"random","num_samples":10,"seed":3}')
        assert strategy.num_samples == 10
        assert strategy.seed == 3

    def test_parses_grid(self):
        strategy = parse_sampling_strategy('{"strategy_type":"grid","spacing_km":2.5}')
        assert strategy.spacing_km == 2.5
        assert strategy.seed is None

    def test_unknown_strategy_type_is_rejected(self):
        with pytest.raises(ValidationError):
            parse_sampling_strategy('{"strategy_type":"kriging","num_samples":10}')

    def test_grid_without_spacing_is_rejected(self):
        with pytest.raises(ValidationError):
            parse_sampling_strategy('{"strategy_type":"grid"}')

    def test_random_without_samples_is_rejected(self):
        with pytest.raises(ValidationError):
            parse_sampling_strategy('{"strategy_type":"random"}')

"""Unit tests for the task density grid (annotation/spatial.py) -- pure, DB-free."""

import pytest

from src.annotation.spatial import bin_density_cells, density_grid

AOI = (0.0, 0.0, 10.0, 5.0)


class TestDensityGrid:
    def test_sized_from_the_wider_span_of_the_area_of_interest(self):
        assert density_grid(AOI, target_cells=10) == pytest.approx(1.0)

    def test_a_viewport_sizes_the_grid_instead(self):
        assert density_grid(AOI, target_cells=10, bbox=(0.0, 0.0, 2.0, 1.0)) == pytest.approx(0.2)

    def test_falls_back_when_there_is_no_extent(self):
        assert density_grid(None, target_cells=10) == pytest.approx(0.01)

    def test_a_zero_span_falls_back(self):
        assert density_grid((3.0, 3.0, 3.0, 3.0), target_cells=10) == pytest.approx(0.01)


class TestBinDensityCells:
    def test_groups_points_that_share_a_cell(self):
        cells = bin_density_cells([(0.1, 0.1, "pending"), (0.2, 0.2, "pending")], grid=1.0)
        assert len(cells) == 1
        assert cells[0]["count"] == 2

    def test_reports_the_mean_position_not_the_cell_centre(self):
        cells = bin_density_cells([(0.1, 0.1, "pending"), (0.3, 0.3, "pending")], grid=1.0)
        assert cells[0]["lon"] == pytest.approx(0.2)
        assert cells[0]["lat"] == pytest.approx(0.2)

    def test_a_lone_point_is_reported_at_its_own_position(self):
        cells = bin_density_cells([(4.317, 2.916, "done")], grid=1.0)
        assert cells[0]["lon"] == pytest.approx(4.317)
        assert cells[0]["lat"] == pytest.approx(2.916)

    def test_splits_a_shared_cell_by_key(self):
        cells = bin_density_cells(
            [(0.1, 0.1, "pending"), (0.2, 0.2, "done"), (0.3, 0.3, "done")], grid=1.0
        )
        by_key = {cell["key"]: cell["count"] for cell in cells}
        assert by_key == {"pending": 1, "done": 2}

    def test_separates_neighbouring_cells(self):
        cells = bin_density_cells([(0.5, 0.5, "x"), (1.5, 0.5, "x")], grid=1.0)
        assert len(cells) == 2

    def test_handles_negative_coordinates(self):
        cells = bin_density_cells([(-0.5, -0.5, "x"), (-1.5, -0.5, "x")], grid=1.0)
        assert len(cells) == 2

    def test_no_points_is_no_cells(self):
        assert bin_density_cells([], grid=1.0) == []

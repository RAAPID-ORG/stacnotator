from src.visualizers.timeline import SliceInput, flatten, interval_label


def slice_input(slice_id, start, end, *, name="", cover=False):
    return SliceInput(
        slice_id=slice_id,
        name=name,
        start_date=start,
        end_date=end,
        is_dedicated_cover=cover,
    )


def test_flatten_orders_by_date_across_collections():
    steps = flatten(
        [
            slice_input(3, "2024-02-01", "2024-02-07"),
            slice_input(1, "2024-01-01", "2024-01-07"),
            slice_input(2, "2024-01-08", "2024-01-14"),
        ]
    )
    assert [s.slice_id for s in steps] == [1, 2, 3]


def test_flatten_drops_dedicated_covers():
    steps = flatten(
        [
            slice_input(1, "2024-01-01", "2024-01-31", cover=True),
            slice_input(2, "2024-01-01", "2024-01-07"),
        ]
    )
    assert [s.slice_id for s in steps] == [2]


def test_flatten_collapses_repeated_intervals():
    steps = flatten(
        [
            slice_input(1, "2024-01-01", "2024-01-07"),
            slice_input(2, "2024-01-01", "2024-01-07"),
        ]
    )
    assert [s.slice_id for s in steps] == [1]


def test_slice_name_wins_over_the_generated_label():
    steps = flatten([slice_input(1, "2024-01-01", "2024-01-07", name="Harvest week")])
    assert steps[0].label == "Harvest week"


def test_interval_labels():
    assert interval_label("2024-03-05", "2024-03-05") == "5 Mar 2024"
    assert interval_label("2024-03-01", "2024-03-31") == "Mar 2024"
    assert interval_label("2024-03-01", "2024-03-07") == "1 Mar 2024 - 7 Mar 2024"

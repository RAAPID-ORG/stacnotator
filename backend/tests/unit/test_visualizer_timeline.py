from src.visualizers.timeline import SliceInput, cadence, flatten, interval_label, timelines


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


def test_flatten_keeps_one_kind_at_a_time():
    given = [
        slice_input(1, "2024-01-01", "2024-01-31", cover=True),
        slice_input(2, "2024-01-01", "2024-01-07"),
    ]
    assert [s.slice_id for s in flatten(given)] == [2]
    assert [s.slice_id for s in flatten(given, covers=True)] == [1]


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


def monthly_with_weekly_slices():
    """Two months, each a monthly cover over four weekly slices."""
    out = []
    for month, (start, end) in enumerate(
        [("2024-01-01", "2024-01-31"), ("2024-02-01", "2024-02-29")], start=1
    ):
        out.append(slice_input(month * 100, start, end, cover=True))
        day = 1
        for week in range(4):
            first = f"2024-{month:02d}-{day:02d}"
            last = f"2024-{month:02d}-{day + 6:02d}"
            out.append(slice_input(month * 100 + week + 1, first, last))
            day += 7
    return out


class TestTimelines:
    def test_a_coarser_cover_record_is_offered_alongside_the_slices(self):
        records = timelines(monthly_with_weekly_slices())
        assert [r.cadence for r in records] == ["monthly", "weekly"]
        assert len(records[0].steps) == 2
        assert len(records[1].steps) == 8

    def test_covers_at_the_same_cadence_are_not_a_second_record(self):
        records = timelines(
            [
                slice_input(1, "2024-01-01", "2024-01-31", cover=True),
                slice_input(2, "2024-01-01", "2024-01-31"),
                slice_input(3, "2024-02-01", "2024-02-29", cover=True),
                slice_input(4, "2024-02-01", "2024-02-29"),
            ]
        )
        assert [r.cadence for r in records] == ["monthly"]
        assert [s.slice_id for s in records[0].steps] == [2, 4]

    def test_a_source_without_covers_is_one_record(self):
        records = timelines([slice_input(1, "2024-01-01", "2024-01-07")])
        assert [r.cadence for r in records] == ["weekly"]

    def test_covers_alone_still_make_a_record(self):
        records = timelines([slice_input(1, "2024-01-01", "2024-01-31", cover=True)])
        assert [r.cadence for r in records] == ["monthly"]
        assert [s.slice_id for s in records[0].steps] == [1]


class TestCadence:
    def test_names_the_periods_worth_naming(self):
        assert cadence([step_over("2024-01-01", "2024-01-01")]) == "daily"
        assert cadence([step_over("2024-01-01", "2024-01-07")]) == "weekly"
        assert cadence([step_over("2024-01-01", "2024-01-14")]) == "fortnightly"
        assert cadence([step_over("2024-01-01", "2024-01-31")]) == "monthly"
        assert cadence([step_over("2024-01-01", "2024-03-31")]) == "quarterly"
        assert cadence([step_over("2024-01-01", "2024-12-31")]) == "yearly"

    def test_reports_an_unnamed_period_as_the_length_it_has(self):
        assert cadence([step_over("2024-01-01", "2024-01-05")]) == "5-day"

    def test_one_odd_trailing_period_does_not_rename_the_record(self):
        weekly = [
            step_over("2024-01-01", "2024-01-07"),
            step_over("2024-01-08", "2024-01-14"),
            step_over("2024-01-15", "2024-01-16"),
        ]
        assert cadence(weekly) == "weekly"


def step_over(start, end):
    return flatten([slice_input(1, start, end)])[0]

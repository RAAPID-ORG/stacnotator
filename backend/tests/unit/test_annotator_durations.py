from uuid import uuid4

from src.campaigns.statistics import summarize_annotator_durations


class TestSummarizeAnnotatorDurations:
    def test_groups_per_user(self):
        alice, bob = uuid4(), uuid4()

        result = summarize_annotator_durations([(alice, 10), (bob, 60), (alice, 30), (bob, 20)])

        assert result[alice].timed_tasks == 2
        assert result[alice].total_active_seconds == 40
        assert result[bob].total_active_seconds == 80

    def test_unmeasured_rows_are_dropped_not_counted_as_zero(self):
        """A NULL means the assignment predates the measurement. Counting it as
        zero would halve the annotator's median for no reason."""
        alice = uuid4()

        result = summarize_annotator_durations([(alice, 40), (alice, None), (alice, 60)])

        assert result[alice].timed_tasks == 2
        assert result[alice].median_seconds_per_task == 50

    def test_user_with_no_measurements_is_absent(self):
        alice = uuid4()

        result = summarize_annotator_durations([(alice, None)])

        assert alice not in result

    def test_median_ignores_a_single_runaway_task(self):
        """The reason we report median rather than mean: one tab left open on
        one task must not define the annotator's figure."""
        alice = uuid4()

        result = summarize_annotator_durations(
            [(alice, 30), (alice, 35), (alice, 40), (alice, 3600)]
        )

        assert result[alice].median_seconds_per_task == 38
        assert result[alice].total_active_seconds == 3705

    def test_even_count_median_is_rounded_to_whole_seconds(self):
        alice = uuid4()

        result = summarize_annotator_durations([(alice, 10), (alice, 15)])

        assert result[alice].median_seconds_per_task == 12

    def test_empty_input(self):
        assert summarize_annotator_durations([]) == {}

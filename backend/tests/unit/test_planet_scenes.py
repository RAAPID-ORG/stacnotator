from datetime import date

import pytest

from src.imagery import service as imagery_service
from src.planet import client as planet_client
from src.planet import scenes
from src.planet.schemas import PlanetScenesGenerationConfigV1

AOI = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}


def feature(scene_id: str, acquired: str, **properties):
    return {
        "id": scene_id,
        "properties": {"item_type": "PSScene", "acquired": acquired, **properties},
    }


def config(**overrides) -> PlanetScenesGenerationConfigV1:
    defaults = dict(
        kind="planet_scenes",
        aoi=AOI,
        start_date="2024-01-01",
        end_date="2024-02-29",
        collection_period_interval=1,
        collection_period_unit="months",
        slice_period_interval=1,
        slice_period_unit="days",
        whole_window_cover=True,
    )
    return PlanetScenesGenerationConfigV1(**{**defaults, **overrides})


class TestQuality:
    def test_clear_percent_is_used_when_planet_reports_it(self):
        assert scenes.quality({"clear_percent": 82, "cloud_cover": 0.9}) == 82

    def test_cloud_cover_stands_in_but_is_weighted_lower(self):
        assert scenes.quality({"cloud_cover": 0.0}) == 50

    def test_a_scene_with_no_cloud_metadata_scores_zero_rather_than_vanishing(self):
        assert scenes.quality({}) == 0


class TestScene:
    def test_the_id_is_the_form_the_layers_endpoint_takes(self):
        parsed = scenes.scene(feature("2024011", "2024-01-15T08:12:00Z"))
        assert parsed is not None
        assert parsed.id == "PSScene:2024011"
        assert parsed.acquired == date(2024, 1, 15)

    @pytest.mark.parametrize(
        "broken",
        [
            {"id": "x", "properties": {"item_type": "PSScene"}},
            {"id": "x", "properties": {"acquired": "2024-01-15T08:12:00Z"}},
            {"properties": {"item_type": "PSScene", "acquired": "2024-01-15T08:12:00Z"}},
            {"id": "x", "properties": {"item_type": "PSScene", "acquired": "not a date"}},
        ],
    )
    def test_a_feature_missing_what_grouping_needs_is_skipped(self, broken):
        assert scenes.scenes([broken]) == []


class TestPeriods:
    def test_months_are_whole_calendar_months_when_started_on_the_first(self):
        got = scenes.periods(date(2024, 1, 1), date(2024, 3, 31), 1, "months")
        assert [(p.start, p.end) for p in got] == [
            (date(2024, 1, 1), date(2024, 1, 31)),
            (date(2024, 2, 1), date(2024, 2, 29)),
            (date(2024, 3, 1), date(2024, 3, 31)),
        ]

    def test_the_last_period_is_clipped_to_the_range(self):
        got = scenes.periods(date(2024, 1, 1), date(2024, 1, 10), 1, "weeks")
        assert got[-1].end == date(2024, 1, 10)

    def test_days_give_one_period_each(self):
        got = scenes.periods(date(2024, 1, 1), date(2024, 1, 3), 1, "days")
        assert [p.start for p in got] == [date(2024, 1, 1), date(2024, 1, 2), date(2024, 1, 3)]
        assert all(p.start == p.end for p in got)


class TestLayerIds:
    def make(self, *quality_by_id):
        return [
            scenes.Scene(id=scene_id, acquired=date(2024, 1, 1), quality=q)
            for scene_id, q in quality_by_id
        ]

    def test_the_clearest_scene_is_emitted_last_so_it_draws_on_top(self):
        found = self.make(("a", 10), ("b", 90), ("c", 50))
        assert scenes.layer_ids(found) == ("a", "c", "b")

    def test_the_cap_keeps_the_clearest_scenes_not_the_first_ones(self, monkeypatch):
        monkeypatch.setattr(scenes, "MAX_SCENES_PER_LAYER", 2)
        found = self.make(("a", 10), ("b", 90), ("c", 50))
        assert scenes.layer_ids(found) == ("c", "b")

    def test_equal_quality_orders_by_id_so_the_same_search_mints_the_same_layer(self):
        found = self.make(("b", 50), ("a", 50))
        assert scenes.layer_ids(found) == ("a", "b")


class TestGroup:
    def test_windows_come_from_the_config_not_from_the_scenes(self):
        found = [
            feature("1", "2024-01-05T00:00:00Z", clear_percent=80),
            feature("2", "2024-02-05T00:00:00Z", clear_percent=80),
        ]
        windows = scenes.group(found, config())
        assert [w.period.start for w in windows] == [date(2024, 1, 1), date(2024, 2, 1)]

    def test_a_daily_slice_period_gives_one_slice_per_day_with_imagery(self):
        found = [
            feature("1", "2024-01-05T00:00:00Z", clear_percent=80),
            feature("2", "2024-01-05T09:00:00Z", clear_percent=40),
            feature("3", "2024-01-07T00:00:00Z", clear_percent=80),
        ]
        january = scenes.group(found, config(end_date="2024-01-31"))[0]
        assert [s.period.start for s in january.slices] == [date(2024, 1, 5), date(2024, 1, 7)]
        assert january.slices[0].scene_ids == ("PSScene:2", "PSScene:1")

    def test_a_weekly_slice_period_stacks_the_week_into_one_layer(self):
        found = [
            feature("1", "2024-01-02T00:00:00Z", clear_percent=80),
            feature("2", "2024-01-05T00:00:00Z", clear_percent=90),
        ]
        january = scenes.group(found, config(end_date="2024-01-31", slice_period_unit="weeks"))[0]
        assert january.slices[0].scene_ids == ("PSScene:1", "PSScene:2")

    def test_the_window_cover_stacks_everything_in_the_window(self):
        found = [
            feature("1", "2024-01-05T00:00:00Z", clear_percent=80),
            feature("2", "2024-01-20T00:00:00Z", clear_percent=90),
        ]
        january = scenes.group(found, config(end_date="2024-01-31"))[0]
        assert january.cover is not None
        assert january.cover.scene_ids == ("PSScene:1", "PSScene:2")
        assert january.cover.period == january.period

    def test_without_a_window_cover_the_window_opens_on_a_slice(self):
        found = [feature("1", "2024-01-05T00:00:00Z", clear_percent=80)]
        january = scenes.group(found, config(end_date="2024-01-31", whole_window_cover=False))[0]
        assert january.cover is None
        assert len(january.slices) == 1

    def test_a_window_with_no_usable_imagery_is_not_offered(self):
        found = [feature("1", "2024-01-05T00:00:00Z", clear_percent=80)]
        windows = scenes.group(found, config())
        assert [w.period.start for w in windows] == [date(2024, 1, 1)]

    def test_scenes_outside_the_configured_range_are_left_out(self):
        found = [feature("1", "2023-12-31T00:00:00Z", clear_percent=80)]
        assert scenes.group(found, config()) == []


class TestConfig:
    def test_an_end_before_the_start_is_rejected(self):
        with pytest.raises(ValueError, match="end_date"):
            config(start_date="2024-02-01", end_date="2024-01-01")

    def test_unknown_fields_are_rejected_so_a_stored_config_cannot_drift(self):
        with pytest.raises(ValueError):
            config(cadence="daily")


class TestMintingOneSliceInView:
    """The step a viewport search parallelizes: one slice's ids become one layer."""

    def group(self):
        return scenes.SliceGroup(
            period=scenes.Period(date(2024, 1, 5), date(2024, 1, 5)),
            scene_ids=("PSScene:a", "PSScene:b"),
        )

    def test_a_minted_layer_comes_back_against_its_slice(self, monkeypatch):
        monkeypatch.setattr(planet_client, "create_layer", lambda key, ids: "layer-1")

        minted = imagery_service._mint_view_layer("KEY", 42, self.group())

        assert (minted.slice_id, minted.layer_id, minted.scene_count) == (42, "layer-1", 2)

    def test_a_failed_mint_becomes_a_message_the_annotator_can_read(self, monkeypatch):
        def boom(key, ids):
            raise planet_client.PlanetError("Planet returned 429")

        monkeypatch.setattr(planet_client, "create_layer", boom)

        assert imagery_service._mint_view_layer("KEY", 42, self.group()) == "Planet returned 429"


class TestSearchingWhatIsOnScreen:
    """The whole point of moving the search to annotation time: it is bounded by the
    viewport, and it answers which dates are worth stepping to from where you stand."""

    def series(self):
        return [
            imagery_service.PlanetSceneSeries(
                config=config(),
                slice_ids={
                    ("2024-01-05", "2024-01-05"): 42,
                    ("2024-01-06", "2024-01-06"): 43,
                },
            )
        ]

    def test_the_search_is_bounded_by_the_extent_not_the_campaign_area(self, monkeypatch):
        seen: list[dict] = []

        def search_config(_key, _config, geometry):
            seen.append(geometry)
            return []

        monkeypatch.setattr(planet_client, "search_config", search_config)

        imagery_service.search_planet_scenes_in_view("KEY", self.series(), [10.0, 20.0, 11.0, 21.0])

        assert seen[0]["coordinates"][0][0] == [10.0, 20.0]
        assert seen[0]["coordinates"][0][2] == [11.0, 21.0]

    def test_only_the_dates_with_scenes_over_you_come_back(self, monkeypatch):
        monkeypatch.setattr(
            planet_client,
            "search_config",
            lambda *_a: [feature("a", "2024-01-05T00:00:00Z", clear_percent=90)],
        )
        monkeypatch.setattr(planet_client, "create_layer", lambda _key, ids: "layer-1")

        found = imagery_service.search_planet_scenes_in_view("KEY", self.series(), [0, 0, 1, 1])

        assert [(s.slice_id, s.layer_id, s.scene_count) for s in found.slices] == [
            (42, "layer-1", 1)
        ]
        assert found.errors == []

    def test_a_refused_search_is_reported_rather_than_raised(self, monkeypatch):
        def boom(*_a):
            raise planet_client.PlanetError("Planet is rate limiting this API key")

        monkeypatch.setattr(planet_client, "search_config", boom)

        found = imagery_service.search_planet_scenes_in_view("KEY", self.series(), [0, 0, 1, 1])

        assert found.slices == []
        assert found.errors == ["Planet is rate limiting this API key"]


class TestTheExtentAsGeometry:
    """A viewport is not a valid geometry: Planet answers coordinates outside the world
    with a 400, and a map hands them over routinely."""

    def test_an_ordinary_view_passes_through(self):
        polygon = scenes.bbox_polygon([10.0, 20.0, 11.0, 21.0])

        assert polygon["coordinates"][0][0] == [10.0, 20.0]
        assert polygon["coordinates"][0][2] == [11.0, 21.0]

    def test_a_view_wider_than_the_world_becomes_the_world(self):
        polygon = scenes.bbox_polygon([-400.0, -90.0, 400.0, 90.0])

        corners = polygon["coordinates"][0]
        assert corners[0] == [-180.0, -85.0]
        assert corners[2] == [180.0, 85.0]

    def test_panning_past_the_antimeridian_is_wrapped_back(self):
        # OpenLayers keeps counting: two turns west of Greenwich reads -710, not 10.
        polygon = scenes.bbox_polygon([-710.0, 0.0, -709.0, 1.0])

        assert polygon["coordinates"][0][0] == [10.0, 0.0]
        assert polygon["coordinates"][0][2] == [11.0, 1.0]

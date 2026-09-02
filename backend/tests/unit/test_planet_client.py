import base64
import json
from datetime import date, timedelta

import httpx
import pytest

from src.planet import client
from src.planet.schemas import PlanetScenesGenerationConfigV1


def _mock(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture(autouse=True)
def instant_sleep(monkeypatch):
    """Pacing and backoff are real waits; the tests want the decisions, not the delay.

    The pacer is module state, and with the sleeps skipped its schedule runs away from
    the clock - so each test gets a fresh one rather than the last test's backlog.
    """
    slept: list[float] = []
    monkeypatch.setattr(client.time, "sleep", slept.append)
    monkeypatch.setattr(
        client,
        "_pacers",
        {
            client.API_HOST: client._Pacer(client.REQUESTS_PER_SECOND),
            client.tiles.TILE_HOST: client._Pacer(client.MINT_REQUESTS_PER_SECOND),
        },
    )
    return slept


@pytest.fixture
def planet(monkeypatch):
    """Swap the guarded client for a scripted one; returns the requests made."""
    seen: list[httpx.Request] = []

    def install(handler):
        def record(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return handler(request)

        monkeypatch.setattr(client, "_http", _mock(record))
        return seen

    return install


def test_list_series_follows_planets_paging(planet):
    pages = {
        "/basemaps/v1/series": {
            "series": [{"id": "a"}],
            "_links": {"_next": "https://api.planet.com/basemaps/v1/series?_page=2"},
        },
        "/basemaps/v1/series?_page=2": {"series": [{"id": "b"}], "_links": {}},
    }

    def handler(request):
        key = (
            request.url.path if "_page=2" not in str(request.url) else f"{request.url.path}?_page=2"
        )
        return httpx.Response(200, json=pages[key])

    planet(handler)

    assert [s["id"] for s in client.list_series("KEY")] == ["a", "b"]


def test_the_key_travels_as_basic_auth_not_a_query_param(planet):
    seen = planet(lambda request: httpx.Response(200, json={"series": []}))

    client.list_series("KEY")

    request = seen[0]
    assert "KEY" not in str(request.url)
    expected = base64.b64encode(b"KEY:").decode()
    assert request.headers["authorization"] == f"Basic {expected}"


def test_mosaics_come_back_in_acquisition_order(planet):
    mosaics = [
        {"id": "2", "first_acquired": "2024-02-01T00:00:00Z"},
        {"id": "1", "first_acquired": "2024-01-01T00:00:00Z"},
    ]
    planet(lambda request: httpx.Response(200, json={"mosaics": mosaics, "_links": {}}))

    assert [m["id"] for m in client.list_mosaics("series-1", "KEY")] == ["1", "2"]


def test_a_rejected_key_is_reported_as_such(planet):
    planet(lambda request: httpx.Response(401, json={}))

    with pytest.raises(client.PlanetError, match="rejected the API key"):
        client.list_series("KEY")


def test_paging_never_leaves_planets_host(planet):
    planet(
        lambda request: httpx.Response(
            200, json={"series": [], "_links": {"_next": "https://evil.example.com/steal"}}
        )
    )

    with pytest.raises(client.PlanetError, match="refusing to send Planet credentials"):
        client.list_series("KEY")


def test_paging_stops_at_the_page_cap(planet):
    seen = planet(
        lambda request: httpx.Response(
            200,
            json={"series": [{"id": "x"}], "_links": {"_next": "https://api.planet.com/loop"}},
        )
    )

    assert len(client.list_series("KEY")) == client.MAX_PAGES
    assert len(seen) == client.MAX_PAGES


AOI = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}


def _search(**overrides):
    return {
        "geometry": AOI,
        "start": "2024-01-01",
        "end": "2024-01-31",
        "item_types": ["PSScene"],
        **overrides,
    }


def test_scene_search_follows_paging_from_the_first_post(planet):
    pages = iter(
        [
            {
                "features": [{"id": "a"}],
                "_links": {"_next": "https://api.planet.com/data/v1/searches/x?_page=2"},
            },
            {"features": [{"id": "b"}], "_links": {}},
        ]
    )
    planet(lambda request: httpx.Response(200, json=next(pages)))

    found = client.search_scenes("KEY", **_search())

    assert [f["id"] for f in found] == ["a", "b"]


def test_the_search_filter_carries_the_geometry_and_the_dates(planet):
    seen = planet(lambda request: httpx.Response(200, json={"features": [], "_links": {}}))

    client.search_scenes("KEY", **_search())

    body = json.loads(seen[0].content)
    kinds = {f["type"]: f for f in body["filter"]["config"]}
    assert kinds["GeometryFilter"]["config"] == AOI
    assert kinds["DateRangeFilter"]["config"]["gte"].startswith("2024-01-01")
    assert body["item_types"] == ["PSScene"]


def test_a_permissive_cloud_setting_sends_no_cloud_filter_at_all(planet):
    seen = planet(lambda request: httpx.Response(200, json={"features": [], "_links": {}}))

    client.search_scenes("KEY", **_search(max_cloud_cover=100))

    kinds = {f["type"] for f in json.loads(seen[0].content)["filter"]["config"]}
    assert "RangeFilter" not in kinds


def test_a_cloud_limit_is_sent_as_planets_zero_to_one_fraction(planet):
    seen = planet(lambda request: httpx.Response(200, json={"features": [], "_links": {}}))

    client.search_scenes("KEY", **_search(max_cloud_cover=20))

    cloud = next(
        f for f in json.loads(seen[0].content)["filter"]["config"] if f["type"] == "RangeFilter"
    )
    assert cloud["config"] == {"lte": 0.2}


def test_minting_a_layer_posts_the_ids_in_the_order_given(planet):
    seen = planet(lambda request: httpx.Response(200, json={"name": "abc123"}))

    assert client.create_layer("KEY", ["PSScene:a", "PSScene:b"]) == "abc123"
    assert seen[0].content == b"ids=PSScene%3Aa%2CPSScene%3Ab"


def test_an_empty_layer_is_refused_rather_than_posted(planet):
    seen = planet(lambda request: httpx.Response(200, json={"name": "abc123"}))

    with pytest.raises(client.PlanetError, match="empty scene layer"):
        client.create_layer("KEY", [])
    assert seen == []


def scene_config(**overrides) -> PlanetScenesGenerationConfigV1:
    defaults = dict(
        kind="planet_scenes",
        aoi=AOI,
        start_date="2026-08-01",
        end_date="2026-08-29",
        collection_period_interval=1,
        collection_period_unit="months",
        slice_period_interval=3,
        slice_period_unit="days",
        whole_window_cover=True,
    )
    return PlanetScenesGenerationConfigV1(**{**defaults, **overrides})


def _ranges(requests: list[httpx.Request]) -> list[tuple[str, str]]:
    """The date ranges the searches actually asked Planet for, in order."""
    return sorted(
        (f["config"]["gte"][:10], f["config"]["lte"][:10])
        for body in (json.loads(r.content) for r in requests if r.method == "POST")
        for f in body["filter"]["config"]
        if f["type"] == "DateRangeFilter"
    )


class TestRunningOutOfPages:
    """Planet returns results in an order we do not control, so a truncated search
    loses an arbitrary end of the range rather than the least interesting scenes."""

    def test_a_search_that_runs_out_of_pages_raises_instead_of_truncating(self, planet):
        planet(
            lambda request: httpx.Response(
                200,
                json={
                    "features": [{"id": "a"}],
                    "_links": {"_next": "https://api.planet.com/data/v1/searches/x?_page=2"},
                },
            )
        )

        with pytest.raises(client.PlanetError, match="Narrow the area"):
            client.search_scenes("KEY", **_search())


class TestSearchingAConfig:
    """One search per slice would be 183 requests for a year of two-day slices. The
    range is chunked instead, and a chunk splits only when it says it had to."""

    def test_a_short_config_is_covered_by_one_search(self, planet):
        seen = planet(lambda request: httpx.Response(200, json={"features": [], "_links": {}}))

        client.search_config("KEY", scene_config(), AOI)

        assert len(seen) == 1
        assert _ranges(seen) == [("2026-08-01", "2026-08-29")]

    def test_a_long_config_is_cut_into_chunks_that_cover_it_end_to_end(self, planet):
        seen = planet(lambda request: httpx.Response(200, json={"features": [], "_links": {}}))

        client.search_config(
            "KEY", scene_config(start_date="2024-01-01", end_date="2024-12-31"), AOI
        )

        ranges = _ranges(seen)
        assert len(ranges) == 4
        assert ranges[0][0] == "2024-01-01"
        assert ranges[-1][1] == "2024-12-31"
        # Contiguous: a gap between chunks is a date nobody searched.
        for earlier, later in zip(ranges, ranges[1:], strict=False):
            assert date.fromisoformat(later[0]) - date.fromisoformat(earlier[1]) == timedelta(
                days=1
            )

    def test_a_chunk_with_more_scenes_than_it_can_page_splits_itself(self, planet):
        """The one thing a search cannot do is come back short without saying so, so a
        chunk that runs out of pages is halved until each half fits."""
        overflowing = {"features": [{"id": "a"}], "_links": {"_next": "https://api.planet.com/x"}}
        answered: list[tuple[date, date]] = []

        def handler(request):
            if request.method == "GET":
                return httpx.Response(200, json=overflowing)
            body = json.loads(request.content)
            span = next(
                f["config"] for f in body["filter"]["config"] if f["type"] == "DateRangeFilter"
            )
            start = date.fromisoformat(span["gte"][:10])
            end = date.fromisoformat(span["lte"][:10])
            if end - start > timedelta(days=8):
                return httpx.Response(200, json=overflowing)
            answered.append((start, end))
            return httpx.Response(200, json={"features": [{"id": "b"}], "_links": {}})

        seen = planet(handler)

        found = client.search_config("KEY", scene_config(), AOI)

        # Nothing from a truncated page is kept, and the halves that did fit tile the
        # whole range end to end - a gap between them would be a date nobody searched.
        assert {f["id"] for f in found} == {"b"}
        answered.sort()
        assert (answered[0][0], answered[-1][1]) == (date(2026, 8, 1), date(2026, 8, 29))
        for earlier, later in zip(answered, answered[1:], strict=False):
            assert later[0] - earlier[1] == timedelta(days=1)
        assert ("2026-08-01", "2026-08-29") in _ranges(seen)

    def test_every_chunk_contributes_its_scenes(self, planet):
        counter = iter(range(100))
        planet(
            lambda request: httpx.Response(
                200, json={"features": [{"id": str(next(counter))}], "_links": {}}
            )
        )

        found = client.search_config(
            "KEY", scene_config(start_date="2024-01-01", end_date="2024-12-31"), AOI
        )

        assert len({f["id"] for f in found}) == 4

    def test_a_view_that_keeps_overflowing_is_refused_rather_than_split_forever(self, planet):
        """Splitting stops at a single day: a day that still overflows is a view too
        wide to search, not a range to cut smaller."""
        seen = planet(
            lambda request: httpx.Response(
                200,
                json={"features": [{"id": "a"}], "_links": {"_next": "https://api.planet.com/x"}},
            )
        )

        with pytest.raises(client.PlanetError, match="Narrow the area"):
            client.search_config(
                "KEY", scene_config(start_date="2024-01-01", end_date="2026-12-31"), AOI
            )

        assert len([r for r in seen if r.method == "POST"]) <= client.MAX_SEARCHES


class TestRateLimiting:
    """A config with many slices is a burst of searches against a key an organization
    shares, which is exactly what Planet answers with 429."""

    def test_a_rate_limited_search_is_waited_out_rather_than_failed(self, planet, instant_sleep):
        replies = iter(
            [
                httpx.Response(429, headers={"Retry-After": "2"}),
                httpx.Response(200, json={"features": [{"id": "a"}], "_links": {}}),
            ]
        )
        planet(lambda request: next(replies))

        found = client.search_scenes("KEY", **_search())

        assert [f["id"] for f in found] == ["a"]
        assert 2.0 in instant_sleep

    def test_planets_own_retry_after_never_shortens_the_backoff(self, planet, instant_sleep):
        """Planet answers 429 with ``Retry-After: 0``, which is not a licence to go
        straight back at it."""
        replies = iter(
            [
                httpx.Response(429, headers={"Retry-After": "0"}),
                httpx.Response(200, json={"features": [], "_links": {}}),
            ]
        )
        planet(lambda request: next(replies))

        client.search_scenes("KEY", **_search())

        # Pacing sleeps are a fifth of a second, so a whole second is the backoff.
        assert max(instant_sleep) >= 1.0

    def test_a_key_that_stays_rate_limited_says_what_to_do_about_it(self, planet):
        seen = planet(lambda request: httpx.Response(429, json={}))

        with pytest.raises(client.PlanetError, match="rate limiting"):
            client.search_scenes("KEY", **_search())

        assert len(seen) == client.RETRY_ATTEMPTS

    def test_pacing_widens_after_a_refusal(self, instant_sleep):
        pacer = client._Pacer(5.0)
        pacer.wait()
        pacer.wait()
        before = instant_sleep[-1]

        pacer.refused()
        pacer.wait()
        pacer.wait()

        assert instant_sleep[-1] > before

    def test_a_burst_of_searches_is_paced(self, planet, instant_sleep):
        planet(lambda request: httpx.Response(200, json={"features": [], "_links": {}}))

        client.search_config(
            "KEY", scene_config(start_date="2024-01-01", end_date="2024-12-31"), AOI
        )

        # Four chunk searches: the first can go at once, the rest wait their turn.
        assert len([delay for delay in instant_sleep if delay > 0]) >= 3

    def test_minting_does_not_spend_the_search_budget(self, planet, instant_sleep):
        """The tile host is a different service with its own limit, so a slowed-down
        search is no reason to slow a mint."""
        planet(lambda request: httpx.Response(200, json={"name": "layer-1"}))
        client._pacers[client.API_HOST].refused()
        before = client._pacers[client.API_HOST]._interval

        client.create_layer("KEY", ["PSScene:a"])

        assert client._pacers[client.tiles.TILE_HOST]._interval < before


def test_a_refusal_carries_what_planet_said_was_wrong(planet):
    planet(
        lambda request: httpx.Response(
            400,
            json={
                "general": [{"message": "Unable to parse the geometry"}],
                "field": {"filter": [{"message": "config is not valid"}]},
            },
        )
    )

    with pytest.raises(client.PlanetError, match="Unable to parse the geometry"):
        client.search_scenes("KEY", **_search())


def test_a_search_page_stays_inside_planets_maximum(planet):
    seen = planet(lambda request: httpx.Response(200, json={"features": [], "_links": {}}))

    client.search_scenes("KEY", **_search())

    # Asking for more is a 400 rather than a clamp, which is how a working search
    # turned into "Planet returned 400" the moment the page size was raised.
    assert seen[0].url.params["_page_size"] == str(client.SEARCH_PAGE_SIZE)
    assert client.SEARCH_PAGE_SIZE <= 250

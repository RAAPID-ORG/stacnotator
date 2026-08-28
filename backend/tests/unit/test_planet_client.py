import base64
import json

import httpx
import pytest

from src.planet import client


def _mock(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


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

import pytest

from src.planet import tiles

LINK = (
    "https://tiles.planet.com/basemaps/v1/planet-tiles/"
    "global_monthly_2024_01_mosaic/gmap/{z}/{x}/{y}.png?api_key=SECRET"
)


def test_to_template_replaces_the_live_key_with_the_proxy_placeholder():
    template = tiles.to_template(LINK)

    assert "SECRET" not in template
    assert template.endswith("api_key={api_key}")
    assert "/gmap/{z}/{x}/{y}.png" in template


def test_to_template_keeps_planets_other_query_params():
    template = tiles.to_template(f"{LINK}&format=png32")

    assert "format=png32" in template
    assert template.endswith("api_key={api_key}")


@pytest.mark.parametrize(
    "link",
    [
        "http://tiles.planet.com/x/{z}/{x}/{y}.png?api_key=SECRET",
        "https://evil.example.com/x/{z}/{x}/{y}.png?api_key=SECRET",
        "https://tiles.planet.com/basemaps/v1/mosaics/abc",
    ],
)
def test_to_template_refuses_links_it_cannot_vouch_for(link):
    with pytest.raises(tiles.UnexpectedTileLink):
        tiles.to_template(link)


def test_analytic_series_offer_derived_renderings():
    assert [r.name for r in tiles.renderings_for("uint16")] == ["Visual", "False Color", "NDVI"]
    assert [r.name for r in tiles.renderings_for("uint8")] == ["Visual"]
    assert [r.name for r in tiles.renderings_for(None)] == ["Visual"]


def test_tile_urls_stamp_proc_per_rendering():
    urls = tiles.tile_urls(LINK, tiles.ANALYTIC_RENDERINGS)

    assert urls["Visual"].endswith("api_key={api_key}&proc=rgb")
    assert urls["NDVI"].endswith("api_key={api_key}&proc=ndvi")


def test_visual_tile_urls_carry_no_proc():
    urls = tiles.tile_urls(LINK, tiles.VISUAL_RENDERINGS)

    assert "proc=" not in urls["Visual"]


@pytest.mark.parametrize(
    ("resolution", "expected"),
    [(4.777, 15), (3.0, 16), (None, None), (0, None)],
)
def test_native_zoom_stops_where_planet_stops(resolution, expected):
    assert tiles.native_zoom(resolution) == expected


def _mosaic(name: str, link: str | None = LINK, **extra):
    mosaic = {
        "id": f"id-{name}",
        "name": name,
        "first_acquired": "2024-01-01T00:00:00.000Z",
        "last_acquired": "2024-01-31T00:00:00.000Z",
        "datatype": "uint16",
        "grid": {"resolution": 4.777},
        **extra,
    }
    if link:
        mosaic["_links"] = {"tiles": link}
    return mosaic


def test_describe_series_maps_mosaics_onto_slice_ready_tiles():
    described = tiles.describe_series("series-1", [_mosaic("global_monthly_2024_01_mosaic")])

    assert described.renderings == ["Visual", "False Color", "NDVI"]
    assert described.max_native_zoom == 15
    mosaic = described.mosaics[0]
    assert mosaic.first_acquired == "2024-01-01"
    assert mosaic.last_acquired == "2024-01-31"
    assert mosaic.unavailable_reason is None
    assert set(mosaic.tile_urls) == {"Visual", "False Color", "NDVI"}


def test_describe_series_keeps_unusable_mosaics_with_a_reason():
    described = tiles.describe_series(
        "series-1",
        [_mosaic("good"), _mosaic("no_link", link=None), _mosaic("bad_link", link="ftp://x/y")],
    )

    reasons = [m.unavailable_reason for m in described.mosaics]
    assert reasons[0] is None
    assert reasons[1] and reasons[2]
    assert [m.name for m in described.mosaics] == ["good", "no_link", "bad_link"]
    assert described.mosaics[1].tile_urls == {}


class TestLayerTemplate:
    def test_the_key_is_a_placeholder_the_proxy_fills_in(self):
        url = tiles.layer_template("abc123")

        assert url.endswith("?api_key={api_key}")
        assert "/data/v1/layers/abc123/{z}/{x}/{y}.png" in url

    @pytest.mark.parametrize("layer_id", ["../evil", "a/b", "a?x=1", "a b"])
    def test_a_layer_id_that_would_escape_the_path_is_refused(self, layer_id):
        with pytest.raises(tiles.UnexpectedTileLink):
            tiles.layer_template(layer_id)

"""Pure tile-proxy URL building. No DB / network."""

from src.imagery.proxy import build_upstream_tile_url, quadkey


def test_substitutes_coords_and_key():
    template = "https://p.example/{z}/{x}/{y}.png?api_key={api_key}"
    url = build_upstream_tile_url(template, z=5, x=10, y=20, api_key="SECRET")
    assert url == "https://p.example/5/10/20.png?api_key=SECRET"


def test_key_is_not_leaked_when_absent_from_template():
    template = "https://p.example/{z}/{x}/{y}.png"
    url = build_upstream_tile_url(template, z=1, x=0, y=0, api_key="SECRET")
    assert "SECRET" not in url


def test_quadkey_corners_at_zoom_1():
    assert quadkey(0, 0, 1) == "0"
    assert quadkey(1, 0, 1) == "1"
    assert quadkey(0, 1, 1) == "2"
    assert quadkey(1, 1, 1) == "3"


def test_quadkey_template_substituted():
    template = "https://p.example/quad/{q}?api_key={api_key}"
    url = build_upstream_tile_url(template, z=1, x=1, y=1, api_key="K")
    assert url == "https://p.example/quad/3?api_key=K"


def test_subdomain_range_resolves_to_first():
    template = "https://{a-c}.example/{z}/{x}/{y}.png?api_key={api_key}"
    url = build_upstream_tile_url(template, z=2, x=1, y=1, api_key="K")
    assert url == "https://a.example/2/1/1.png?api_key=K"


def test_unknown_placeholder_left_intact():
    template = "https://p.example/{z}/{x}/{y}?style={style}&api_key={api_key}"
    url = build_upstream_tile_url(template, z=1, x=0, y=0, api_key="K")
    assert "{style}" in url

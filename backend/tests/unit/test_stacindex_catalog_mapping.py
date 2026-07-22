from src.stac_browser.router import _map_stacindex_catalog


def test_uses_slug_as_id_not_numeric_id():
    # StacIndex now returns a numeric `id`; the output id must be the string slug.
    out = _map_stacindex_catalog(
        {
            "isApi": True,
            "id": 16,
            "slug": "astraea-earth-ondemand",
            "title": "Astraea",
            "url": "https://a",
        }
    )
    assert out is not None
    assert out["id"] == "astraea-earth-ondemand"
    assert isinstance(out["id"], str)


def test_auth_required_matches_on_slug():
    out = _map_stacindex_catalog(
        {"isApi": True, "id": 99, "slug": "maxar", "title": "Maxar", "url": "https://m"}
    )
    assert out is not None
    assert out["auth_required"] is True


def test_falls_back_to_stringified_id_when_no_slug():
    out = _map_stacindex_catalog({"isApi": True, "id": 42, "title": "x", "url": "https://x"})
    assert out is not None
    assert out["id"] == "42"


def test_skips_non_api_catalogs():
    assert _map_stacindex_catalog({"isApi": False, "slug": "static-thing"}) is None


def test_skips_planetary_computer():
    assert (
        _map_stacindex_catalog(
            {"isApi": True, "slug": "mpc", "url": "https://planetarycomputer.microsoft.com/api"}
        )
        is None
    )

from urllib.parse import parse_qs, urlparse

from src.imagery.tile_urls import rebake_mpc_url


class TestRebakeMpcUrl:
    def test_preserves_collection_and_pixel_selection(self):
        url = (
            "https://planetarycomputer.microsoft.com/api/data/v1/mosaic/abc123/tiles/"
            "WebMercatorQuad/{z}/{x}/{y}?collection=sentinel-2-l2a&pixel_selection=first"
        )
        result = rebake_mpc_url(url, {"assets": ["visual"]})
        query = parse_qs(urlparse(result).query)
        assert query["collection"] == ["sentinel-2-l2a"]
        assert query["pixel_selection"] == ["first"]

    def test_drops_other_existing_params_not_in_allowlist(self):
        url = "https://example.com/tiles?collection=x&pixel_selection=first&assets=old&rescale=0,1"
        result = rebake_mpc_url(url, {"assets": ["new_asset"]})
        query = parse_qs(urlparse(result).query)
        assert query["assets"] == ["new_asset"]
        assert "rescale" not in query

    def test_replaces_viz_params(self):
        url = "https://example.com/tiles?collection=x&pixel_selection=first&assets=old"
        result = rebake_mpc_url(url, {"assets": ["visual"], "colormap_name": "viridis"})
        query = parse_qs(urlparse(result).query)
        assert query["assets"] == ["visual"]
        assert query["colormap_name"] == ["viridis"]

    def test_handles_url_without_query_string(self):
        url = "https://example.com/tiles/WebMercatorQuad/{z}/{x}/{y}"
        result = rebake_mpc_url(url, {"assets": ["visual"]})
        parsed = urlparse(result)
        assert parsed.path == "/tiles/WebMercatorQuad/{z}/{x}/{y}"
        query = parse_qs(parsed.query)
        assert query["assets"] == ["visual"]

    def test_empty_viz_params_yields_only_kept_params(self):
        url = "https://example.com/tiles?collection=x&pixel_selection=first"
        result = rebake_mpc_url(url, {})
        query = parse_qs(urlparse(result).query)
        assert query == {"collection": ["x"], "pixel_selection": ["first"]}

    def test_no_kept_params_and_no_viz_params_yields_empty_query(self):
        url = "https://example.com/tiles"
        result = rebake_mpc_url(url, {})
        assert urlparse(result).query == ""

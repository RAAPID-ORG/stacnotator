"""DB-free characterization tests for three pure helpers used by mosaic registration:

- `_inject_datetime_into_query` (`src.imagery.registration`): placeholder substitution
  vs top-level datetime injection into a CQL2-JSON search body.
- `_sanitize_stac_error` (`src.imagery.registration`): turns a registration exception
  into a user-facing message without leaking internal paths.
- `_stac_config_changed` (`src.imagery.service`): decides whether a collection's STAC
  config edit requires mosaic re-registration.

`_stac_config_changed` is typed against the `CollectionStacConfig` ORM model, but only
duck-types a handful of attributes off it and its `.collection.viz_configs`. Rather than
build real SQLAlchemy rows, `existing` is a `SimpleNamespace` stand-in - no DB, no session.
`incoming` is the real Pydantic `CollectionStacConfigCreate` schema the router receives.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi import HTTPException

from src.imagery.registration import (
    _inject_datetime_into_query,
    _sanitize_stac_error,
    load_refreshable_collection,
)
from src.imagery.schemas import CollectionStacConfigCreate, NamedVizParamsCreate, VizParamsCreate
from src.imagery.service import _stac_config_changed

# ============================================================================
# _inject_datetime_into_query
# ============================================================================


def test_inject_datetime_replaces_both_placeholders():
    body = {
        "filter": {
            "op": "and",
            "args": [
                {"op": ">=", "args": [{"property": "datetime"}, "{sliceStart}"]},
                {"op": "<=", "args": [{"property": "datetime"}, "{sliceEnd}"]},
            ],
        }
    }

    _inject_datetime_into_query(body, "2024-01-01T00:00:00Z", "2024-01-31T23:59:59Z")

    args = body["filter"]["args"]
    assert args[0]["args"][1] == "2024-01-01T00:00:00Z"
    assert args[1]["args"][1] == "2024-01-31T23:59:59Z"
    assert "datetime" not in body


def test_inject_datetime_replaces_only_the_placeholder_present():
    body = {"filter": {"op": ">=", "args": [{"property": "datetime"}, "{sliceStart}"]}}

    _inject_datetime_into_query(body, "2024-01-01T00:00:00Z", "2024-01-31T23:59:59Z")

    assert body["filter"]["args"][1] == "2024-01-01T00:00:00Z"


def test_inject_datetime_placeholder_branch_mutates_dict_in_place():
    body = {"filter": {"args": ["{sliceStart}"]}}
    original_id = id(body)

    result = _inject_datetime_into_query(body, "start", "end")

    assert id(body) == original_id
    assert body["filter"]["args"][0] == "start"
    assert result is None


def test_inject_datetime_sets_top_level_range_when_no_placeholder_and_no_existing_key():
    body = {"bbox": [0, 0, 1, 1]}

    _inject_datetime_into_query(body, "2024-01-01T00:00:00Z", "2024-01-31T23:59:59Z")

    assert body["datetime"] == "2024-01-01T00:00:00Z/2024-01-31T23:59:59Z"


def test_inject_datetime_leaves_existing_top_level_datetime_untouched():
    body = {"datetime": "2020-01-01T00:00:00Z/2020-01-02T00:00:00Z"}

    _inject_datetime_into_query(body, "2024-01-01T00:00:00Z", "2024-01-31T23:59:59Z")

    assert body["datetime"] == "2020-01-01T00:00:00Z/2020-01-02T00:00:00Z"


# ============================================================================
# _sanitize_stac_error - HTTPException branch
# ============================================================================


def test_sanitize_error_http_exception_returns_detail_verbatim():
    exc = HTTPException(status_code=404, detail="Collection not found: sentinel-2")

    assert _sanitize_stac_error(exc) == "Collection not found: sentinel-2"


def test_sanitize_error_http_exception_stringifies_non_string_detail():
    exc = HTTPException(status_code=422, detail={"msg": "bad request"})

    assert _sanitize_stac_error(exc) == str({"msg": "bad request"})


# ============================================================================
# _sanitize_stac_error - httpx.HTTPStatusError branch
# ============================================================================


def _status_error(status_code: int, *, json_body: dict | None = None, content: bytes = b""):
    request = httpx.Request("GET", "https://example.com/search")
    if json_body is not None:
        response = httpx.Response(status_code, json=json_body, request=request)
    else:
        response = httpx.Response(status_code, content=content, request=request)
    return httpx.HTTPStatusError("boom", request=request, response=response)


def test_sanitize_error_status_error_uses_detail_field():
    exc = _status_error(404, json_body={"detail": "collection not found"})

    assert _sanitize_stac_error(exc) == "HTTP 404: collection not found"


def test_sanitize_error_status_error_falls_back_to_message_field():
    exc = _status_error(500, json_body={"message": "internal error"})

    assert _sanitize_stac_error(exc) == "HTTP 500: internal error"


def test_sanitize_error_status_error_falls_back_to_description_field():
    exc = _status_error(400, json_body={"description": "bad query"})

    assert _sanitize_stac_error(exc) == "HTTP 400: bad query"


def test_sanitize_error_status_error_generic_message_when_body_has_no_known_keys():
    exc = _status_error(500, json_body={"other": "irrelevant"})

    assert _sanitize_stac_error(exc) == "HTTP 500 from tile server"


def test_sanitize_error_status_error_generic_message_when_body_is_not_json():
    exc = _status_error(502, content=b"<html>Bad Gateway</html>")

    assert _sanitize_stac_error(exc) == "HTTP 502 from tile server"


# ============================================================================
# _sanitize_stac_error - generic exception branch, incl. path-stripping
# ============================================================================


def test_sanitize_error_generic_returns_first_line_only():
    exc = ValueError("first line\nsecond line")

    assert _sanitize_stac_error(exc) == "first line"


def test_sanitize_error_generic_returns_message_when_no_slash_present():
    exc = ValueError("Unknown tiler 'bogus'")

    assert _sanitize_stac_error(exc) == "Unknown tiler 'bogus'"


def test_sanitize_error_generic_strips_site_packages_path():
    exc = RuntimeError("boom at /home/x/venv/lib/site-packages/httpx/_client.py:42")

    assert _sanitize_stac_error(exc) == "Registration failed (RuntimeError)"


def test_sanitize_error_generic_strips_app_path():
    exc = RuntimeError("boom at /app/src/imagery/registration.py:99")

    assert _sanitize_stac_error(exc) == "Registration failed (RuntimeError)"


def test_sanitize_error_generic_does_not_strip_unrelated_slash_content():
    # Pins current behavior: the path-stripping check only fires for
    # site-packages/`/app/` substrings, so a plain URL passes through untouched.
    exc = ValueError("fetch failed for https://example.com/search")

    assert _sanitize_stac_error(exc) == "fetch failed for https://example.com/search"


def test_sanitize_error_generic_truncates_to_200_chars():
    exc = ValueError("x" * 250)

    result = _sanitize_stac_error(exc)

    assert result == "x" * 200
    assert len(result) == 200


def test_sanitize_error_generic_empty_message_falls_back_to_type_name():
    assert _sanitize_stac_error(Exception()) == "Registration failed (Exception)"


# ============================================================================
# load_refreshable_collection - query scoping
# ============================================================================


def test_load_refreshable_collection_scopes_query_to_campaign():
    """C2 regression: the query must join through ImagerySource and filter on
    campaign_id, so a collection_id belonging to a different campaign can never
    match - a cross-campaign refresh must 404 rather than reach the collection."""
    db = MagicMock()
    db.execute.return_value.scalar_one_or_none.return_value = None

    with pytest.raises(HTTPException) as exc_info:
        load_refreshable_collection(db, collection_id=42, campaign_id=99)

    assert exc_info.value.status_code == 404
    stmt = db.execute.call_args[0][0]
    compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "imagery_sources" in compiled
    assert "campaign_id" in compiled
    assert "42" in compiled
    assert "99" in compiled


# ============================================================================
# _stac_config_changed
# ============================================================================

_RENDER_PARAMS = VizParamsCreate(assets=["B04"]).model_dump(exclude_none=True)


def _existing_viz(name="true_color", render_params=None, cover_render_params=None):
    return SimpleNamespace(
        name=name,
        render_params=_RENDER_PARAMS if render_params is None else render_params,
        cover_render_params=cover_render_params,
    )


def _existing_config(
    *,
    viz_configs=(),
    max_cloud_cover=20.0,
    search_query=None,
    cover_search_query=None,
    tile_provider=None,
    internal_storage=False,
):
    return SimpleNamespace(
        collection=SimpleNamespace(viz_configs=list(viz_configs)),
        max_cloud_cover=max_cloud_cover,
        search_query=search_query,
        cover_search_query=cover_search_query,
        tile_provider=tile_provider,
        internal_storage=internal_storage,
    )


def _incoming_viz(name="true_color", viz_params=None, cover_viz_params=None):
    return NamedVizParamsCreate(
        name=name,
        viz_params=viz_params or VizParamsCreate(assets=["B04"]),
        cover_viz_params=cover_viz_params,
    )


def _incoming_config(
    *,
    visualizations=(),
    max_cloud_cover=20.0,
    search_query=None,
    cover_search_query=None,
    tiler=None,
    internal_storage=False,
):
    return CollectionStacConfigCreate(
        visualizations=list(visualizations),
        max_cloud_cover=max_cloud_cover,
        search_query=search_query,
        cover_search_query=cover_search_query,
        tiler=tiler,
        internal_storage=internal_storage,
    )


def test_stac_config_changed_no_existing_config_always_changed():
    assert _stac_config_changed(None, _incoming_config()) is True


def test_stac_config_changed_identical_config_is_unchanged():
    existing = _existing_config(viz_configs=[_existing_viz()], tile_provider="mpc")
    incoming = _incoming_config(visualizations=[_incoming_viz()], tiler="mpc")

    assert _stac_config_changed(existing, incoming) is False


def test_stac_config_changed_existing_with_no_collection_treats_viz_set_as_empty():
    existing = _existing_config(viz_configs=[])
    existing.collection = None
    incoming = _incoming_config(visualizations=[_incoming_viz()])

    assert _stac_config_changed(existing, incoming) is True


def test_stac_config_changed_viz_render_params_change_is_detected():
    existing = _existing_config(viz_configs=[_existing_viz()])
    incoming = _incoming_config(
        visualizations=[_incoming_viz(viz_params=VizParamsCreate(assets=["B08"]))]
    )

    assert _stac_config_changed(existing, incoming) is True


def test_stac_config_changed_viz_added_is_detected():
    existing = _existing_config(viz_configs=[_existing_viz()])
    incoming = _incoming_config(visualizations=[_incoming_viz(), _incoming_viz(name="false_color")])

    assert _stac_config_changed(existing, incoming) is True


def test_stac_config_changed_cover_render_params_change_is_detected():
    existing = _existing_config(viz_configs=[_existing_viz(cover_render_params=None)])
    incoming = _incoming_config(
        visualizations=[_incoming_viz(cover_viz_params=VizParamsCreate(assets=["B04"]))]
    )

    assert _stac_config_changed(existing, incoming) is True


def test_stac_config_changed_cloud_cover_change_is_detected():
    existing = _existing_config(viz_configs=[_existing_viz()], max_cloud_cover=20.0)
    incoming = _incoming_config(visualizations=[_incoming_viz()], max_cloud_cover=50.0)

    assert _stac_config_changed(existing, incoming) is True


def test_stac_config_changed_search_query_change_is_detected():
    existing = _existing_config(viz_configs=[_existing_viz()], search_query={"a": 1})
    incoming = _incoming_config(visualizations=[_incoming_viz()], search_query={"a": 2})

    assert _stac_config_changed(existing, incoming) is True


def test_stac_config_changed_cover_search_query_change_is_detected():
    existing = _existing_config(viz_configs=[_existing_viz()], cover_search_query={"a": 1})
    incoming = _incoming_config(visualizations=[_incoming_viz()], cover_search_query={"a": 2})

    assert _stac_config_changed(existing, incoming) is True


def test_stac_config_changed_tiler_change_is_detected():
    existing = _existing_config(viz_configs=[_existing_viz()], tile_provider="mpc")
    incoming = _incoming_config(visualizations=[_incoming_viz()], tiler="planetary-tiler")

    assert _stac_config_changed(existing, incoming) is True


def test_stac_config_changed_internal_storage_change_is_detected():
    existing = _existing_config(viz_configs=[_existing_viz()], internal_storage=False)
    incoming = _incoming_config(visualizations=[_incoming_viz()], internal_storage=True)

    assert _stac_config_changed(existing, incoming) is True

"""DB-free characterization tests for two pure helpers used by mosaic registration:

- `_inject_datetime_into_query`: placeholder substitution vs top-level datetime
  injection into a CQL2-JSON search body.
- `_sanitize_stac_error`: turns a registration exception into a user-facing message
  without leaking internal paths.
"""

import httpx
from fastapi import HTTPException

from src.imagery.registration import _inject_datetime_into_query, _sanitize_stac_error

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

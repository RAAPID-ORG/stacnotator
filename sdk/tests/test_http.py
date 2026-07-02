import pytest
import responses

from stacnotator._auth import NoneTokenProvider
from stacnotator._http import Http
from stacnotator.errors import ApiError, AuthenticationError

BASE = "https://app.example.org"


class StubTokenProvider:
    def __init__(self, tokens):
        self.tokens = list(tokens)
        self.invalidated = 0

    def id_token(self):
        return self.tokens[0]

    def invalidate(self):
        self.invalidated += 1
        if len(self.tokens) > 1:
            self.tokens.pop(0)


@responses.activate
def test_get_attaches_bearer_and_prefixes_api():
    responses.get(f"{BASE}/api/auth/me", json={"email": "a@b.c"})
    http = Http(BASE, StubTokenProvider(["tok-1"]))

    assert http.get("/auth/me") == {"email": "a@b.c"}
    assert responses.calls[0].request.headers["Authorization"] == "Bearer tok-1"


@responses.activate
def test_trailing_slash_base_url_tolerated():
    responses.get(f"{BASE}/api/auth/me", json={})
    http = Http(BASE + "/", NoneTokenProvider())

    http.get("/auth/me")
    assert responses.calls[0].request.url == f"{BASE}/api/auth/me"


@responses.activate
def test_none_provider_sends_no_auth_header():
    responses.get(f"{BASE}/api/auth/me", json={})
    http = Http(BASE, NoneTokenProvider())

    http.get("/auth/me")
    assert "Authorization" not in responses.calls[0].request.headers


@responses.activate
def test_401_refreshes_token_and_retries_once():
    responses.get(f"{BASE}/api/auth/me", json={"detail": "expired"}, status=401)
    responses.get(f"{BASE}/api/auth/me", json={"email": "a@b.c"})
    provider = StubTokenProvider(["stale", "fresh"])
    http = Http(BASE, provider)

    assert http.get("/auth/me") == {"email": "a@b.c"}
    assert provider.invalidated == 1
    assert responses.calls[1].request.headers["Authorization"] == "Bearer fresh"


@responses.activate
def test_persistent_401_raises_authentication_error():
    responses.get(f"{BASE}/api/auth/me", json={"detail": "nope"}, status=401)
    responses.get(f"{BASE}/api/auth/me", json={"detail": "nope"}, status=401)
    http = Http(BASE, StubTokenProvider(["stale"]))

    with pytest.raises(AuthenticationError):
        http.get("/auth/me")


@responses.activate
def test_error_maps_to_api_error_with_detail():
    responses.get(f"{BASE}/api/campaigns/9", json={"detail": "Campaign not found"}, status=404)
    http = Http(BASE, NoneTokenProvider())

    with pytest.raises(ApiError) as exc:
        http.get("/campaigns/9")
    assert exc.value.status == 404
    assert exc.value.detail == "Campaign not found"


@responses.activate
def test_error_without_json_body_uses_text():
    responses.get(f"{BASE}/api/campaigns/9", body="boom", status=500)
    http = Http(BASE, NoneTokenProvider())

    with pytest.raises(ApiError) as exc:
        http.get("/campaigns/9")
    assert exc.value.detail == "boom"


@responses.activate
def test_post_sends_json_body():
    responses.post(f"{BASE}/api/campaigns/1/custom-maps", json={"id": 5}, status=201)
    http = Http(BASE, NoneTokenProvider())

    assert http.post("/campaigns/1/custom-maps", json={"name": "x"}) == {"id": 5}
    assert responses.calls[0].request.body == b'{"name": "x"}'


@responses.activate
def test_get_passes_query_params():
    responses.get(f"{BASE}/api/campaigns/1/export-annotations-geojson", json={"features": []})
    http = Http(BASE, NoneTokenProvider())

    http.get("/campaigns/1/export-annotations-geojson", params={"merge_on_agreement": "false"})
    assert responses.calls[0].request.url.endswith("?merge_on_agreement=false")

import threading
import urllib.parse
import urllib.request

import pytest
import responses

from stacnotator._auth import SECURETOKEN_URL, login_via_browser
from stacnotator._credentials import Credentials
from stacnotator.errors import AuthenticationError

BASE = "https://app.example.org"
API = "https://api.example.org"


@responses.activate
def test_backend_url_with_local_auth_skips_browser():
    responses.get(f"{BASE}/api/auth/me", json={"email": "local@localhost"})
    opened = []

    creds = login_via_browser(BASE, open_browser=opened.append)

    assert creds == Credentials(url=BASE, auth={"mode": "none"}, api_url=BASE)
    assert opened == []


@responses.activate
def test_spa_html_response_is_not_mistaken_for_open_backend():
    """A frontend dev server answers every path with index.html and status 200.

    That must not be read as "no auth needed" - the browser flow has to run.
    """
    responses.get(f"{BASE}/api/auth/me", body="<!doctype html><html></html>", status=200)
    open_browser = browser_that_submits({"mode": "local", "api_url": API})

    creds = login_via_browser(BASE, open_browser=open_browser, timeout=10)

    assert creds == Credentials(url=BASE, auth={"mode": "none"}, api_url=API)


def browser_that_submits(fields):
    """Simulates the /sdk-auth page: form-POSTs credentials to the callback URL."""

    def open_browser(sdk_auth_url):
        query = urllib.parse.urlparse(sdk_auth_url).query
        callback = urllib.parse.parse_qs(query)["callback"][0]
        body = urllib.parse.urlencode(fields).encode()

        def post():
            with urllib.request.urlopen(callback, data=body, timeout=5) as response:
                assert response.status == 200

        threading.Thread(target=post, daemon=True).start()

    return open_browser


@responses.activate
def test_firebase_flow_returns_credentials_validated_against_api_url():
    responses.get(f"{BASE}/api/auth/me", json={"detail": "Authentication required"}, status=401)
    responses.post(
        SECURETOKEN_URL,
        json={"id_token": "id-1", "refresh_token": "r-token", "expires_in": "3600"},
    )
    responses.get(f"{API}/api/auth/me", json={"email": "a@b.c"})
    open_browser = browser_that_submits(
        {"mode": "firebase", "api_key": "AIzaKey", "refresh_token": "r-token", "api_url": API}
    )

    creds = login_via_browser(BASE, open_browser=open_browser, timeout=10)

    assert creds == Credentials(
        url=BASE,
        auth={"mode": "firebase", "api_key": "AIzaKey", "refresh_token": "r-token"},
        api_url=API,
    )
    authorized_call = responses.calls[-1]
    assert authorized_call.request.url.startswith(API)
    assert authorized_call.request.headers["Authorization"] == "Bearer id-1"


@responses.activate
def test_handoff_without_api_url_falls_back_to_app_url():
    responses.get(f"{BASE}/api/auth/me", json={"detail": "nope"}, status=401)
    open_browser = browser_that_submits({"mode": "local"})

    creds = login_via_browser(BASE, open_browser=open_browser, timeout=10)

    assert creds.api_url == BASE


@responses.activate
def test_sdk_auth_url_carries_loopback_callback():
    responses.get(f"{BASE}/api/auth/me", json={"detail": "nope"}, status=401)
    seen = []

    def open_browser(sdk_auth_url):
        seen.append(sdk_auth_url)
        browser_that_submits({"mode": "local"})(sdk_auth_url)

    login_via_browser(BASE, open_browser=open_browser, timeout=10)

    assert seen[0].startswith(f"{BASE}/sdk-auth?callback=http%3A%2F%2F127.0.0.1%3A") or seen[
        0
    ].startswith(f"{BASE}/sdk-auth?callback=http://127.0.0.1:")


@responses.activate
def test_timeout_without_browser_response_raises():
    responses.get(f"{BASE}/api/auth/me", json={"detail": "nope"}, status=401)

    with pytest.raises(AuthenticationError, match="[Tt]imed out"):
        login_via_browser(BASE, open_browser=lambda url: None, timeout=0.3)


@responses.activate
def test_firebase_response_missing_fields_raises():
    responses.get(f"{BASE}/api/auth/me", json={"detail": "nope"}, status=401)
    open_browser = browser_that_submits({"mode": "firebase"})

    with pytest.raises(AuthenticationError, match="incomplete"):
        login_via_browser(BASE, open_browser=open_browser, timeout=10)

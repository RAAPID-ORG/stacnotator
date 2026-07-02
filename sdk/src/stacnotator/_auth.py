import time
import urllib.parse
import webbrowser
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, HTTPServer

import requests

from stacnotator._credentials import Credentials
from stacnotator.errors import AuthenticationError

SECURETOKEN_URL = "https://securetoken.googleapis.com/v1/token"

_EXPIRY_MARGIN_SECONDS = 60

_LOGIN_DONE_PAGE = b"""<!doctype html>
<html><body style="font-family: sans-serif; text-align: center; padding-top: 4rem">
<h2>Login complete</h2><p>You can close this tab and return to your terminal.</p>
</body></html>"""


class NoneTokenProvider:
    """No-auth deployments (AUTH_PROVIDER=local): requests carry no bearer token."""

    def id_token(self) -> str | None:
        return None

    def invalidate(self) -> None:
        pass


class FirebaseTokenProvider:
    """Mints short-lived Firebase ID tokens from a long-lived refresh token."""

    def __init__(
        self,
        api_key: str,
        refresh_token: str,
        on_rotate: Callable[[str], None] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._api_key = api_key
        self._refresh_token = refresh_token
        self._on_rotate = on_rotate
        self._clock = clock
        self._id_token: str | None = None
        self._expires_at = 0.0

    def id_token(self) -> str | None:
        if self._id_token is None or self._clock() >= self._expires_at:
            self._mint()
        return self._id_token

    def invalidate(self) -> None:
        self._id_token = None

    def _mint(self) -> None:
        response = requests.post(
            SECURETOKEN_URL,
            params={"key": self._api_key},
            data={"grant_type": "refresh_token", "refresh_token": self._refresh_token},
            timeout=30,
        )
        if not response.ok:
            raise AuthenticationError(
                "Your saved login is no longer valid - please log in again "
                "(`stacnotator login <url>`)."
            )
        payload = response.json()
        self._id_token = payload["id_token"]
        self._expires_at = self._clock() + float(payload["expires_in"]) - _EXPIRY_MARGIN_SECONDS
        new_refresh_token = payload.get("refresh_token")
        if new_refresh_token and new_refresh_token != self._refresh_token:
            self._refresh_token = new_refresh_token
            if self._on_rotate:
                self._on_rotate(new_refresh_token)


class _CallbackServer(HTTPServer):
    fields: dict[str, str] | None = None


class _CallbackHandler(BaseHTTPRequestHandler):
    server: _CallbackServer

    def do_POST(self) -> None:  # noqa: N802 (http.server API)
        if urllib.parse.urlparse(self.path).path != "/callback":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        parsed = urllib.parse.parse_qs(self.rfile.read(length).decode())
        self.server.fields = {key: values[0] for key, values in parsed.items()}
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(_LOGIN_DONE_PAGE)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass


def _backend_accepts_unauthenticated(url: str) -> bool:
    try:
        return requests.get(f"{url}/api/auth/me", timeout=10).ok
    except requests.RequestException as exc:
        raise AuthenticationError(f"Could not reach {url}: {exc}") from exc


def _wait_for_browser_handoff(server: _CallbackServer, timeout: float) -> dict[str, str]:
    deadline = time.monotonic() + timeout
    server.timeout = 0.1
    try:
        while server.fields is None and time.monotonic() < deadline:
            server.handle_request()
    finally:
        server.server_close()
    if server.fields is None:
        raise AuthenticationError("Timed out waiting for the browser login to complete.")
    return server.fields


def _credentials_from_handoff(url: str, fields: dict[str, str]) -> Credentials:
    if fields.get("mode") == "firebase":
        api_key, refresh_token = fields.get("api_key"), fields.get("refresh_token")
        if not api_key or not refresh_token:
            raise AuthenticationError("Browser login returned an incomplete credential handoff.")
        creds = Credentials(
            url=url,
            auth={"mode": "firebase", "api_key": api_key, "refresh_token": refresh_token},
        )
        _validate(creds)
        return creds
    return Credentials(url=url, auth={"mode": "none"})


def _validate(creds: Credentials) -> None:
    provider = FirebaseTokenProvider(creds.auth["api_key"], creds.auth["refresh_token"])
    token = provider.id_token()
    response = requests.get(
        f"{creds.url}/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if not response.ok:
        raise AuthenticationError(
            f"Browser login succeeded but the API rejected the session ({response.status_code})."
        )


def login_via_browser(
    url: str,
    open_browser: Callable[[str], object] = webbrowser.open,
    timeout: float = 300,
) -> Credentials:
    """Log in without ever handling a password: the browser hands us a refresh token.

    Local-auth backends need no credentials at all, so we probe first and skip
    the browser entirely when the API already accepts us.
    """
    url = url.rstrip("/")
    if _backend_accepts_unauthenticated(url):
        return Credentials(url=url, auth={"mode": "none"})

    server = _CallbackServer(("127.0.0.1", 0), _CallbackHandler)
    port = server.server_address[1]
    callback = f"http://127.0.0.1:{port}/callback"
    query = urllib.parse.urlencode({"callback": callback})
    open_browser(f"{url}/sdk-auth?{query}")

    fields = _wait_for_browser_handoff(server, timeout)
    return _credentials_from_handoff(url, fields)

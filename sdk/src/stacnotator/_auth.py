import time
from collections.abc import Callable

import requests

from stacnotator.errors import AuthenticationError

SECURETOKEN_URL = "https://securetoken.googleapis.com/v1/token"

_EXPIRY_MARGIN_SECONDS = 60


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

from typing import Any, Protocol

import requests

from stacnotator.errors import ApiError, AuthenticationError


class TokenProvider(Protocol):
    def id_token(self) -> str | None: ...

    def invalidate(self) -> None: ...


class Http:
    """Authenticated JSON transport for the STACNotator API."""

    def __init__(self, base_url: str, token_provider: TokenProvider):
        self._base_url = base_url.rstrip("/")
        self._tokens = token_provider
        self._session = requests.Session()

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        return self._request("GET", path, params=params)

    def post(self, path: str, json: Any = None) -> Any:
        return self._request("POST", path, json=json)

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self._send(method, path, **kwargs)
        if response.status_code == 401:
            self._tokens.invalidate()
            response = self._send(method, path, **kwargs)
            if response.status_code == 401:
                raise AuthenticationError(
                    "Authentication failed - please log in again (`stacnotator.login(url)`)."
                )
        if not response.ok:
            raise ApiError(response.status_code, _error_detail(response))
        return response.json()

    def _send(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        headers = {}
        token = self._tokens.id_token()
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        return self._session.request(
            method, f"{self._base_url}/api{path}", headers=headers, timeout=120, **kwargs
        )


def _error_detail(response: requests.Response) -> str:
    try:
        detail = response.json().get("detail")
    except ValueError:
        detail = None
    if isinstance(detail, str):
        return detail
    return response.text

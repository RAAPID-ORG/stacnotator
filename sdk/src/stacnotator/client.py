from typing import Any

import pandas as pd

from stacnotator import _credentials
from stacnotator._auth import FirebaseTokenProvider, NoneTokenProvider, login_via_browser
from stacnotator._http import Http, TokenProvider
from stacnotator.campaign import Campaign
from stacnotator.errors import NotLoggedInError

_CAMPAIGN_LIST_COLUMNS = ["id", "name", "created_at", "is_admin", "is_member", "is_public"]


def _token_provider(creds: _credentials.Credentials) -> TokenProvider:
    if creds.auth.get("mode") == "firebase":

        def persist_rotation(new_refresh_token: str) -> None:
            creds.auth["refresh_token"] = new_refresh_token
            _credentials.save(creds)

        return FirebaseTokenProvider(
            creds.auth["api_key"], creds.auth["refresh_token"], on_rotate=persist_rotation
        )
    return NoneTokenProvider()


class Client:
    def __init__(self, url: str | None = None):
        creds = _credentials.load()
        if url is not None:
            url = url.rstrip("/")
            if creds is None or creds.url != url:
                creds = _credentials.Credentials(url=url, auth={"mode": "none"})
        if creds is None:
            raise NotLoggedInError()
        self._http = Http(creds.url, _token_provider(creds))

    def whoami(self) -> dict[str, Any]:
        result: dict[str, Any] = self._http.get("/auth/me")
        return result

    def campaigns(self) -> pd.DataFrame:
        items = self._http.get("/campaigns/")["items"]
        return pd.DataFrame(items, columns=_CAMPAIGN_LIST_COLUMNS)

    def campaign(self, campaign_id: int) -> Campaign:
        if not isinstance(campaign_id, int) or isinstance(campaign_id, bool):
            raise ValueError(
                f"campaign_id must be an integer, got {campaign_id!r}. "
                "List your campaigns with snt.campaigns()."
            )
        return Campaign(self._http, self._http.get(f"/campaigns/{campaign_id}"))


_default_client: Client | None = None


def _client() -> Client:
    global _default_client
    if _default_client is None:
        _default_client = Client()
    return _default_client


def login(url: str) -> dict[str, Any]:
    """Log in via the browser (or none-auth probe) and cache credentials on disk."""
    global _default_client
    creds = login_via_browser(url)
    _credentials.save(creds)
    _default_client = None
    return _client().whoami()


def logout() -> None:
    global _default_client
    _credentials.clear()
    _default_client = None


def whoami() -> dict[str, Any]:
    return _client().whoami()


def campaigns() -> pd.DataFrame:
    return _client().campaigns()


def campaign(campaign_id: int) -> Campaign:
    return _client().campaign(campaign_id)

from typing import Any

from stacnotator._http import Http


class Campaign:
    """A STACNotator campaign the logged-in user has access to."""

    def __init__(self, http: Http, data: dict[str, Any]):
        self._http = http
        self._data = data

    @property
    def id(self) -> int:
        return int(self._data["id"])

    @property
    def name(self) -> str:
        return str(self._data["name"])

    @property
    def mode(self) -> str:
        return str(self._data["mode"])

    @property
    def labels(self) -> dict[int, str]:
        settings = self._data.get("settings") or {}
        return {int(label["id"]): label["name"] for label in settings.get("labels") or []}

    def __repr__(self) -> str:
        return f"Campaign(id={self.id}, name={self.name!r}, mode={self.mode!r})"

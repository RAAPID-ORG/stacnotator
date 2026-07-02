from typing import Any

import pandas as pd

from stacnotator._http import Http
from stacnotator._samples import samples_frame


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

    def get_samples(self, merge_on_agreement: bool = False) -> pd.DataFrame:
        """All labeled samples of this campaign as lat/lon/label rows."""
        feature_collection = self._http.get(
            f"/campaigns/{self.id}/export-annotations-geojson",
            params={"merge_on_agreement": "true" if merge_on_agreement else "false"},
        )
        return samples_frame(feature_collection)

    def __repr__(self) -> str:
        return f"Campaign(id={self.id}, name={self.name!r}, mode={self.mode!r})"

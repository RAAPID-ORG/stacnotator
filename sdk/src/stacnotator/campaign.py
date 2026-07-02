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

    def update_samples(self, training_set: pd.DataFrame) -> pd.DataFrame:
        """Return ``training_set`` extended with samples annotated since it was fetched.

        Rows are matched by ``annotation_id``; columns you added to the training
        set (features, embeddings, ...) are preserved.
        """
        if not training_set.empty and "annotation_id" not in training_set.columns:
            raise ValueError(
                "training_set has no 'annotation_id' column - update_samples only works "
                "with frames produced by get_samples() (merged exports are not supported)."
            )
        fetched = self.get_samples()
        if training_set.empty:
            return fetched
        new_rows = fetched[~fetched["annotation_id"].isin(training_set["annotation_id"])]
        if new_rows.empty:
            return training_set.copy()
        return pd.concat([training_set, new_rows], ignore_index=True)

    def register_pred_layer(
        self,
        cog_url: str,
        name: str | None = None,
        mlops_link: str | None = None,
        rescale: tuple[float, float] = (0.0, 1.0),
        colormap: str = "viridis",
    ) -> dict[str, Any]:
        """Register a prediction COG as a map overlay on this campaign.

        Registration continues asynchronously on the server; the returned layer
        starts in status "registering".
        """
        existing = self._list_pred_layers()
        result: dict[str, Any] = self._http.post(
            f"/campaigns/{self.id}/custom-maps",
            json={
                "name": name or f"prediction-{len(existing) + 1}",
                "cog_url": cog_url,
                "mlops_url": mlops_link,
                "render_config": {
                    "mode": "continuous",
                    "band": 1,
                    "colormap_name": colormap,
                    "rescale": list(rescale),
                },
            },
        )
        return result

    def pred_layers(self) -> pd.DataFrame:
        columns = ["id", "name", "cog_url", "status", "mlops_url", "tile_url"]
        return pd.DataFrame(self._list_pred_layers(), columns=columns)

    def _list_pred_layers(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = self._http.get(f"/campaigns/{self.id}/custom-maps")
        return result

    def __repr__(self) -> str:
        return f"Campaign(id={self.id}, name={self.name!r}, mode={self.mode!r})"

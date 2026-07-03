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

    @property
    def extent(self) -> tuple[float, float, float, float]:
        """Campaign bounding box as (west, south, east, north)."""
        settings = self._data["settings"]
        return (
            float(settings["bbox_west"]),
            float(settings["bbox_south"]),
            float(settings["bbox_east"]),
            float(settings["bbox_north"]),
        )

    def get_samples(self, merge_on_agreement: bool = False) -> pd.DataFrame:
        """All labeled samples of this campaign as lat/lon/label rows."""
        feature_collection = self._http.get(
            f"/campaigns/{self.id}/export-annotations-geojson",
            params={"merge_on_agreement": "true" if merge_on_agreement else "false"},
        )
        return samples_frame(feature_collection)

    def update_samples(
        self, training_set: pd.DataFrame, exclude: pd.DataFrame | None = None
    ) -> pd.DataFrame:
        """Return ``training_set`` extended with samples annotated since it was fetched.

        Rows are matched by ``annotation_id``; columns you added to the training
        set (features, embeddings, ...) are preserved. Rows whose ids appear in
        ``exclude`` (e.g. a held-out test set) are never appended.
        """
        known_ids = pd.concat(
            [
                _annotation_ids(training_set, "training_set"),
                _annotation_ids(exclude, "exclude"),
            ]
        )
        fetched = self.get_samples()
        new_rows = fetched[~fetched["annotation_id"].isin(known_ids)]
        if training_set.empty:
            return new_rows.reset_index(drop=True)
        if new_rows.empty:
            return training_set.copy()
        return pd.concat([training_set, new_rows], ignore_index=True)

    def register_overlay(
        self,
        cog_url: str,
        name: str | None = None,
        mlops_link: str | None = None,
        rescale: tuple[float, float] = (0.0, 1.0),
        colormap: str = "viridis",
        classes: dict[int, str | tuple[str, str]] | None = None,
    ) -> dict[str, Any]:
        """Register a COG (e.g. model predictions) as an overlay layer on this campaign.

        Pass ``classes`` for categorical rasters: ``{value: label}`` (colors
        auto-assigned, shown as a legend to annotators) or ``{value: (label,
        "#rrggbb")}``. Without it the overlay renders continuously with ``rescale``
        and ``colormap``. Overlay names are unique per campaign; registration
        continues asynchronously on the server and the returned overlay starts in
        status "registering".
        """
        if not cog_url.startswith(("http://", "https://")):
            raise ValueError(
                f"cog_url must be an http(s) URL the tile server can fetch, got a local "
                f"path: {cog_url!r}. Upload the COG (or serve it, e.g. `python -m "
                "http.server`) and pass its URL."
            )
        existing_names = {layer["name"] for layer in self._list_overlays()}
        render_config = (
            _categorical_render_config(classes)
            if classes
            else {
                "mode": "continuous",
                "band": 1,
                "colormap_name": colormap,
                "rescale": list(rescale),
            }
        )
        result: dict[str, Any] = self._http.post(
            f"/campaigns/{self.id}/custom-maps",
            json={
                "name": name or _next_overlay_name(existing_names),
                "cog_url": cog_url,
                "mlops_url": mlops_link,
                "render_config": render_config,
            },
        )
        return result

    def overlays(self) -> pd.DataFrame:
        columns = ["id", "name", "cog_url", "status", "mlops_url", "tile_url"]
        return pd.DataFrame(self._list_overlays(), columns=columns)

    def _list_overlays(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = self._http.get(f"/campaigns/{self.id}/custom-maps")
        return result

    def __repr__(self) -> str:
        return f"Campaign(id={self.id}, name={self.name!r}, mode={self.mode!r})"


_CLASS_COLORS = (
    "#1b9e77",
    "#d95f02",
    "#7570b3",
    "#e7298a",
    "#66a61e",
    "#e6ab02",
    "#a6761d",
    "#666666",
)


def _next_overlay_name(existing_names: set[str]) -> str:
    n = len(existing_names) + 1
    while f"overlay-{n}" in existing_names:
        n += 1
    return f"overlay-{n}"


def _categorical_render_config(classes: dict[int, str | tuple[str, str]]) -> dict[str, Any]:
    entries = []
    for i, (value, spec) in enumerate(sorted(classes.items())):
        if isinstance(spec, tuple):
            label, color = spec
        else:
            label, color = spec, _CLASS_COLORS[i % len(_CLASS_COLORS)]
        entries.append({"value": int(value), "label": label, "color": color})
    return {"mode": "categorical", "band": 1, "entries": entries}


def _annotation_ids(frame: pd.DataFrame | None, name: str) -> pd.Series:
    if frame is None or frame.empty:
        return pd.Series(dtype="Int64")
    if "annotation_id" not in frame.columns:
        raise ValueError(
            f"{name} has no 'annotation_id' column - update_samples only works "
            "with frames produced by get_samples() (merged exports are not supported)."
        )
    return frame["annotation_id"]

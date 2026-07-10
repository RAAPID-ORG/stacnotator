import colorsys
import json
from math import ceil
from typing import Any, Literal

import pandas as pd

from stacnotator._http import Http
from stacnotator._samples import samples_frame

# Class rasters are typically uint8; this also bounds the colormap baked into tile URLs.
MAX_CLASSES = 256

# Colormaps the whole system supports: the tiler renders them AND the in-app
# legend can draw their gradient. Mirrors the backend's ColormapName literal.
COLORMAPS = ("viridis", "plasma", "magma", "inferno", "cividis", "turbo", "rdylgn", "rdbu")
Colormap = Literal["viridis", "plasma", "magma", "inferno", "cividis", "turbo", "rdylgn", "rdbu"]


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

    def task_sets(self) -> pd.DataFrame:
        """Task sets of this campaign with per-set task counts."""
        columns = ["id", "name", "num_tasks", "num_labeled"]
        return pd.DataFrame(self._list_task_sets(), columns=columns)

    def upload_tasks(
        self,
        data: "pd.DataFrame | dict[str, Any]",
        task_set: str,
        create_missing: bool = False,
    ) -> int:
        """Upload annotation tasks into the named task set of this campaign.

        ``data`` is either a DataFrame with ``lat``/``lon`` columns (extra
        columns are preserved on each task) or a GeoJSON FeatureCollection
        dict for polygon tasks. Unknown set names fail with the existing set
        names listed; pass ``create_missing=True`` to create the set instead.
        Returns the number of tasks created.
        """
        feature_collection = _as_feature_collection(data)
        sets = {s["name"]: s["id"] for s in self._list_task_sets()}
        if task_set not in sets:
            if not create_missing:
                raise ValueError(
                    f"task set {task_set!r} does not exist in campaign {self.id}; "
                    f"existing sets: {sorted(sets)}. Pass create_missing=True to create it."
                )
            created = self._http.post(f"/campaigns/{self.id}/task-sets", json={"name": task_set})
            sets[task_set] = created["id"]
        result = self._http.post(
            f"/campaigns/{self.id}/ingest-annotation-task-geojson",
            data={"task_set_id": str(sets[task_set])},
            files={
                "file": ("tasks.geojson", json.dumps(feature_collection), "application/geo+json")
            },
        )
        return int(result["num_tasks_created"])

    def _list_task_sets(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = self._http.get(f"/campaigns/{self.id}/task-sets")
        return result

    def register_overlay(
        self,
        cog_url: str,
        name: str | None = None,
        mlops_link: str | None = None,
        rescale: tuple[float, float] = (0.0, 1.0),
        colormap: Colormap = "viridis",
        classes: dict[int, str | tuple[str, str]] | None = None,
    ) -> dict[str, Any]:
        """Register a COG (e.g. model predictions) as an overlay layer on this campaign.

        Pass ``classes`` for categorical rasters: ``{value: label}`` (colors
        auto-assigned, shown as a legend to annotators) or ``{value: (label,
        "#rrggbb")}``. Without it the overlay renders continuously: values in the
        ``rescale`` range map onto ``colormap``, and annotators see that gradient
        with min/mid/max ticks as the legend. Overlay names are unique per
        campaign; registration continues asynchronously on the server and the
        returned overlay starts in status "registering".
        """
        _require_http_url(cog_url, "cog_url")
        if colormap not in COLORMAPS:
            raise ValueError(
                f"colormap {colormap!r} is not supported; the legend can render: "
                f"{', '.join(COLORMAPS)}"
            )
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
        existing_names = {layer["name"] for layer in self._list_overlays()}
        result: dict[str, Any] = self._http.post(
            f"/campaigns/{self.id}/custom-maps",
            json={
                "name": name or _next_name(existing_names, "overlay"),
                "cog_url": cog_url,
                "mlops_url": mlops_link,
                "render_config": render_config,
            },
        )
        return result

    def overlays(self) -> pd.DataFrame:
        columns = ["id", "name", "cog_url", "status", "mlops_url", "tile_url"]
        return pd.DataFrame(self._list_overlays(), columns=columns)

    def register_vector_overlay(
        self,
        pmtiles_url: str,
        name: str | None = None,
        source_layer: str | None = None,
        color: str = "#3b82f6",
    ) -> dict[str, Any]:
        """Register a PMTiles vector file as an overlay layer on this campaign."""
        _require_http_url(pmtiles_url, "pmtiles_url")
        existing_names = {layer["name"] for layer in self._list_vector_overlays()}
        result: dict[str, Any] = self._http.post(
            f"/campaigns/{self.id}/vector-layers",
            json={
                "name": name or _next_name(existing_names, "vector-overlay"),
                "pmtiles_url": pmtiles_url,
                "source_layer": source_layer,
                "color": color,
            },
        )
        return result

    def vector_overlays(self) -> pd.DataFrame:
        columns = ["id", "name", "pmtiles_url", "source_layer", "color"]
        return pd.DataFrame(self._list_vector_overlays(), columns=columns)

    def _list_overlays(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = self._http.get(f"/campaigns/{self.id}/custom-maps")
        return result

    def _list_vector_overlays(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = self._http.get(f"/campaigns/{self.id}/vector-layers")
        return result

    def __repr__(self) -> str:
        return f"Campaign(id={self.id}, name={self.name!r}, mode={self.mode!r})"


# Colorblind-friendly qualitative palette (ColorBrewer Dark2) for small class counts.
_CURATED_COLORS = (
    "#1b9e77",
    "#d95f02",
    "#7570b3",
    "#e7298a",
    "#66a61e",
    "#e6ab02",
    "#a6761d",
    "#666666",
)


def _class_colors(n: int) -> list[str]:
    """``n`` distinguishable hex colors: curated for small n, generated beyond.

    Generation spaces hues evenly and interleaves saturation/value bands so
    hue-neighbors also differ in tone. Colors stay unique up to ``MAX_CLASSES``;
    past ~40 classes true distinguishability is bounded by human vision, which
    is what the legend labels are for.
    """
    if n <= len(_CURATED_COLORS):
        return list(_CURATED_COLORS[:n])
    bands = ((0.9, 0.85), (0.55, 0.95), (0.85, 0.55), (0.65, 0.7))
    per_band = ceil(n / len(bands))
    colors = []
    for i in range(n):
        band = i % len(bands)
        hue = ((i // len(bands) + band / len(bands)) * (360 / per_band)) % 360 / 360
        saturation, value = bands[band]
        r, g, b = colorsys.hsv_to_rgb(hue, saturation, value)
        colors.append(f"#{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}")
    return colors


def _as_feature_collection(data: "pd.DataFrame | dict[str, Any]") -> dict[str, Any]:
    if isinstance(data, pd.DataFrame):
        if not {"lat", "lon"}.issubset(data.columns):
            raise ValueError("data needs 'lat' and 'lon' columns (WGS84 degrees)")
        records = json.loads(data.to_json(orient="records"))
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [rec.pop("lon"), rec.pop("lat")],
                    },
                    "properties": rec,
                }
                for rec in records
            ],
        }
    if isinstance(data, dict) and data.get("type") == "FeatureCollection":
        return data
    raise ValueError(
        "data must be a DataFrame with lat/lon columns or a GeoJSON FeatureCollection dict"
    )


def _require_http_url(url: str, param: str) -> None:
    if not url.startswith(("http://", "https://")):
        raise ValueError(
            f"{param} must be an http(s) URL, got a local path: {url!r}. Upload the "
            "file (or serve it, e.g. `python -m http.server`) and pass its URL."
        )


def _next_name(existing_names: set[str], prefix: str) -> str:
    n = len(existing_names) + 1
    while f"{prefix}-{n}" in existing_names:
        n += 1
    return f"{prefix}-{n}"


def _categorical_render_config(classes: dict[int, str | tuple[str, str]]) -> dict[str, Any]:
    if len(classes) > MAX_CLASSES:
        raise ValueError(
            f"classes has {len(classes)} entries; at most {MAX_CLASSES} are supported "
            "(class rasters are typically uint8)."
        )
    auto_colors = _class_colors(len(classes))
    entries = []
    for i, (value, spec) in enumerate(sorted(classes.items())):
        if isinstance(spec, tuple):
            label, color = spec
        else:
            label, color = spec, auto_colors[i]
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

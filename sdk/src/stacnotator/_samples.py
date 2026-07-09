from typing import Any

import pandas as pd

SAMPLE_COLUMNS = [
    "annotation_id",
    "task_id",
    "lat",
    "lon",
    "label_id",
    "label",
    "confidence",
    "annotator",
    "created_at",
    "geometry",
]

_INT_COLUMNS = ("annotation_id", "task_id", "label_id", "confidence")


def samples_frame(feature_collection: dict[str, Any]) -> pd.DataFrame:
    """Flatten an annotations GeoJSON export into one labeled sample per row.

    Geometries are kept unchanged in the ``geometry`` column; ``lat``/``lon``
    are only filled for point samples - how to reduce polygons/boxes is the
    consumer's call. Features without a label are skip-markers, and features
    without geometry cannot be trained on - both are dropped.
    """
    rows = []
    for feature in feature_collection.get("features", []):
        geometry = feature.get("geometry")
        properties = feature.get("properties", {})
        if geometry is None or properties.get("stacnotator_label_id") is None:
            continue
        lon, lat = _point_coordinates(geometry)
        rows.append(
            {
                "annotation_id": properties.get("stacnotator_annotation_id"),
                "task_id": properties.get("stacnotator_task_id"),
                "lat": lat,
                "lon": lon,
                "label_id": properties.get("stacnotator_label_id"),
                "label": properties.get("stacnotator_label_name"),
                "confidence": properties.get("stacnotator_confidence"),
                "annotator": properties.get("stacnotator_created_by_user_email"),
                "created_at": properties.get("stacnotator_created_at"),
                "geometry": geometry,
            }
        )

    df = pd.DataFrame(rows, columns=SAMPLE_COLUMNS)
    for column in _INT_COLUMNS:
        df[column] = df[column].astype("Int64")
    for column in ("lat", "lon"):
        df[column] = df[column].astype("float64")
    df["created_at"] = pd.to_datetime(df["created_at"], utc=True, format="ISO8601")
    return df


def _point_coordinates(geometry: dict[str, Any]) -> tuple[float | None, float | None]:
    if geometry["type"] != "Point":
        return None, None
    lon, lat = geometry["coordinates"][:2]
    return float(lon), float(lat)

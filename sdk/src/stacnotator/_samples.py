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

    Features without a label are skip-markers, and features without geometry
    cannot be trained on - both are dropped.
    """
    rows = []
    for feature in feature_collection.get("features", []):
        geometry = feature.get("geometry")
        properties = feature.get("properties", {})
        if geometry is None or properties.get("stacnotator_label_id") is None:
            continue
        lon, lat = _representative_point(geometry)
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
    df["created_at"] = pd.to_datetime(df["created_at"], utc=True, format="ISO8601")
    return df


def _representative_point(geometry: dict[str, Any]) -> tuple[float, float]:
    kind = geometry["type"]
    coordinates = geometry["coordinates"]
    if kind == "Point":
        return float(coordinates[0]), float(coordinates[1])
    if kind == "Polygon":
        return _centroid(coordinates[0])
    if kind == "MultiPolygon":
        largest = max(coordinates, key=lambda polygon: abs(_signed_area(polygon[0])))
        return _centroid(largest[0])
    raise ValueError(f"Unsupported geometry type: {kind}")


def _signed_area(ring: list[list[float]]) -> float:
    area = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:], strict=False):
        area += x1 * y2 - x2 * y1
    return area / 2.0


def _centroid(ring: list[list[float]]) -> tuple[float, float]:
    area = _signed_area(ring)
    if area == 0.0:
        vertices = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
        lon = sum(x for x, _ in vertices) / len(vertices)
        lat = sum(y for _, y in vertices) / len(vertices)
        return lon, lat
    cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:], strict=False):
        cross = x1 * y2 - x2 * y1
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    return cx / (6.0 * area), cy / (6.0 * area)

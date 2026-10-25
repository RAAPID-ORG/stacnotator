"""Importing tasks from a CSV of points or a GeoJSON file, and inserting tasks in bulk
for the generators."""

import io
import json
import logging
import re
from collections import Counter

import numpy as np
import pandas as pd
from fastapi import HTTPException
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from sqlalchemy import func, insert, select
from sqlalchemy.orm import Session

from src.campaigns.models import Campaign
from src.geometry import ewkt
from src.tasks.embeddings import start_embedding_run
from src.tasks.models import Task

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB


REQUIRED_COLUMNS = {"id", "lat", "lon"}


def validated_task_numbers(ids: list[str]) -> list[int]:
    """The task numbers an import's ids stand for: non-empty, whole numbers, unique."""
    stripped = [str(raw).strip() for raw in ids]
    if any(not i for i in stripped):
        raise HTTPException(status_code=400, detail="All IDs must be non-empty")
    duplicates = [i for i, count in Counter(stripped).items() if count > 1]
    if duplicates:
        raise HTTPException(
            status_code=400, detail=f"Duplicate IDs found in file: {duplicates[:5]}"
        )
    non_numeric = [i for i in stripped if not re.fullmatch(r"-?\d+", i)]
    if non_numeric:
        raise HTTPException(
            status_code=400,
            detail=f"IDs must be integers. Invalid values: {non_numeric[:5]}",
        )
    return [int(i) for i in stripped]


def insert_tasks(
    db: Session,
    campaign: Campaign,
    task_set_id: int,
    geometry_wkts: list[str],
    raw_source_data: list[dict],
    numbers: list[int] | None = None,
) -> int:
    """Bulk-insert geometries and their tasks, commit, and start fetching their
    embeddings when the campaign uses them.

    Task numbers are `numbers` when given (an imported file's own ids), else
    contiguous after the campaign's current highest. Geometries are WGS84 WKT.
    """
    if numbers is not None:
        taken = db.scalars(
            select(Task.annotation_number).where(
                Task.campaign_id == campaign.id, Task.annotation_number.in_(numbers)
            )
        ).all()
        if taken:
            raise HTTPException(
                status_code=400,
                detail=f"Task IDs already used in this campaign: {sorted(taken)[:5]}",
            )
    else:
        highest = db.scalar(
            select(func.coalesce(func.max(Task.annotation_number), 0)).where(
                Task.campaign_id == campaign.id
            )
        )
        numbers = [(highest or 0) + i + 1 for i in range(len(geometry_wkts))]

    try:
        db.execute(
            insert(Task),
            [
                {
                    "annotation_number": number,
                    "campaign_id": campaign.id,
                    "geometry": ewkt(wkt),
                    "raw_source_data": source,
                    "task_set_id": task_set_id,
                }
                for number, wkt, source in zip(numbers, geometry_wkts, raw_source_data, strict=True)
            ],
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Task import failed for campaign %s", campaign.id)
        raise HTTPException(
            status_code=500,
            detail="Import failed. No tasks were created.",
        ) from None

    start_embedding_run(db, campaign)
    return len(geometry_wkts)


def create_tasks_from_csv(
    db: Session,
    campaign: Campaign,
    contents: bytes,
    task_set_id: int,
) -> int:
    """
    Create tasks from an uploaded CSV with columns id, lat, lon (WGS84). The id
    becomes the task number; every column is kept as the task's source data.
    """
    campaign_id = campaign.id
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size: {MAX_FILE_SIZE / 1024 / 1024:.0f}MB",
        )

    try:
        df = pd.read_csv(
            io.BytesIO(contents),
            encoding="utf-8",
            dtype={"id": str, "lon": float, "lat": float},
        )
    except UnicodeDecodeError:
        logger.warning("CSV import failed for campaign %s: not UTF-8", campaign_id)
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded") from None
    except pd.errors.EmptyDataError:
        logger.warning("CSV import failed for campaign %s: empty file", campaign_id)
        raise HTTPException(status_code=400, detail="CSV file is empty") from None
    except Exception:
        logger.exception("CSV import failed for campaign %s: parse error", campaign_id)
        raise HTTPException(
            status_code=400, detail="Invalid CSV format. Please verify the file structure."
        ) from None

    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV must contain columns: {sorted(REQUIRED_COLUMNS)}",
        )

    df["raw_source_data"] = df.apply(lambda r: r.to_dict(), axis=1)
    df = df[list(REQUIRED_COLUMNS) + ["raw_source_data"]]

    if df.empty:
        raise HTTPException(status_code=400, detail="CSV contains no rows")

    missing_mask = df[["id", "lat", "lon"]].isna().any(axis=1)
    if missing_mask.any():
        bad_rows = (df.index[missing_mask][:5] + 2).tolist()
        raise HTTPException(
            status_code=400,
            detail=f"Missing id/lat/lon in rows: {bad_rows}",
        )

    numbers = validated_task_numbers(df["id"].tolist())

    if not np.isfinite(df["lat"]).all() or not np.isfinite(df["lon"]).all():
        raise HTTPException(
            status_code=400,
            detail="lat/lon must be finite numbers",
        )

    if ((df["lon"] < -180) | (df["lon"] > 180)).any():
        raise HTTPException(
            status_code=400,
            detail="Longitude must be between -180 and 180",
        )

    if ((df["lat"] < -90) | (df["lat"] > 90)).any():
        raise HTTPException(
            status_code=400,
            detail="Latitude must be between -90 and 90",
        )

    return insert_tasks(
        db,
        campaign,
        task_set_id,
        [f"POINT({lon} {lat})" for lon, lat in zip(df["lon"], df["lat"], strict=True)],
        list(df["raw_source_data"]),
        numbers=numbers,
    )


class GeoJSONParseError(Exception):
    """Raised by `parse_geojson_features` on any structurally invalid input.

    `status_code` is the HTTP status the caller should map this to: 413 for
    an oversized upload, 400 for anything else.
    """

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


ALLOWED_GEOMETRY_TYPES = ("Point", "Polygon", "MultiPolygon")


def parse_geojson_features(contents: bytes, max_size: int) -> list[tuple[BaseGeometry, dict]]:
    """Parse and validate GeoJSON bytes into (geometry, properties) pairs.

    Accepts a FeatureCollection, a single Feature, or a bare geometry (one
    feature with no properties). Only Point / Polygon / MultiPolygon are
    allowed; each is repaired with `buffer(0)` if invalid and rejected if that
    leaves it empty.
    """
    if len(contents) > max_size:
        raise GeoJSONParseError(
            f"File too large. Maximum size: {max_size / 1024 / 1024:.0f}MB",
            status_code=413,
        )

    try:
        geojson = json.loads(contents.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise GeoJSONParseError("Invalid GeoJSON file") from exc

    if geojson.get("type") == "FeatureCollection":
        features = geojson.get("features", [])
    elif geojson.get("type") == "Feature":
        features = [geojson]
    elif geojson.get("type") in ALLOWED_GEOMETRY_TYPES:
        features = [{"type": "Feature", "geometry": geojson, "properties": {}}]
    else:
        raise GeoJSONParseError("Unsupported GeoJSON type")

    if not features:
        raise GeoJSONParseError("GeoJSON contains no features")

    parsed: list[tuple[BaseGeometry, dict]] = []

    for idx, feat in enumerate(features):
        geom_json = feat.get("geometry")
        if not geom_json:
            raise GeoJSONParseError(f"Feature {idx} has no geometry")
        geom_type = geom_json.get("type")
        if geom_type not in ALLOWED_GEOMETRY_TYPES:
            raise GeoJSONParseError(
                f"Feature {idx}: unsupported geometry type '{geom_type}'. "
                f"Allowed: {sorted(ALLOWED_GEOMETRY_TYPES)}"
            )

        try:
            geom = shape(geom_json)
            if not geom.is_valid:
                geom = geom.buffer(0)
            if geom.is_empty:
                raise ValueError("empty geometry")
        except Exception as exc:
            raise GeoJSONParseError(f"Feature {idx}: invalid geometry – {exc}") from exc

        properties = dict(feat.get("properties") or {})
        if "id" not in properties and feat.get("id") is not None:
            properties["id"] = feat["id"]
        parsed.append((geom, properties))

    return parsed


def create_tasks_from_geojson(
    db: Session,
    campaign: Campaign,
    contents: bytes,
    task_set_id: int,
) -> int:
    """
    Create tasks from an uploaded GeoJSON file, one per feature. Polygons are
    stored whole so they can serve as the sample extent during annotation.
    """
    try:
        features = parse_geojson_features(contents, MAX_FILE_SIZE)
    except GeoJSONParseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    geometry_wkts = [geom.wkt for geom, _ in features]
    raw_data = [properties for _, properties in features]

    given = [properties.get("id") for properties in raw_data]
    numbers = None
    if any(i is not None for i in given):
        if any(i is None for i in given):
            raise HTTPException(status_code=400, detail="Every feature needs an id, or none")
        numbers = validated_task_numbers([str(i) for i in given])

    return insert_tasks(db, campaign, task_set_id, geometry_wkts, raw_data, numbers=numbers)

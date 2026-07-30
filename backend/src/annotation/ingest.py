"""DB-bound import flows: CSV / GeoJSON uploads -> tasks and annotations.

Validates and bulk-inserts geometries plus their task/annotation rows in one
transaction, translating any failure into an HTTPException. Pure export logic
lives in export.py; this module is the write-side shell.
"""

import io
import json
import logging
from uuid import UUID

import numpy as np
import pandas as pd
from fastapi import HTTPException
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from sqlalchemy import func, insert, select
from sqlalchemy.orm import Session

from src.annotation.forms import (
    FormValidationError,
    campaign_form_fields,
    validate_form_values,
)
from src.annotation.models import (
    Annotation,
    AnnotationGeometry,
    AnnotationTask,
)
from src.annotation.service import validate_label_id
from src.campaigns.models import Campaign

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB
REQUIRED_COLUMNS = {"id", "lat", "lon"}


def insert_tasks(
    db: Session,
    campaign_id: int,
    task_set_id: int,
    geometry_wkts: list[str],
    raw_source_data: list[dict] | None,
) -> int:
    """
    Bulk-insert geometries and their annotation tasks for a campaign.

    Task numbers are assigned contiguously starting after the campaign's
    current max annotation_number, in geometry_wkts order. Geometries are
    stored as WGS84 (SRID=4326); pass plain WKT without the SRID prefix.

    Args:
        db: Database session
        campaign_id: ID of campaign to create tasks for
        task_set_id: ID of task set to assign created tasks to
        geometry_wkts: Plain WKT for each task's geometry
        raw_source_data: Per-task source data, aligned with geometry_wkts,
            or None if no source data applies to any task

    Returns:
        Number of tasks created

    Raises:
        HTTPException: On DB failure; commits on success
    """
    max_annotation_number = db.scalar(
        select(func.coalesce(func.max(AnnotationTask.annotation_number), 0)).where(
            AnnotationTask.campaign_id == campaign_id
        )
    )
    source_data: list[dict | None] = (
        list(raw_source_data) if raw_source_data is not None else [None] * len(geometry_wkts)
    )

    try:
        geometry_result = db.execute(
            insert(AnnotationGeometry).returning(AnnotationGeometry.id),
            [{"geometry": f"SRID=4326;{wkt}"} for wkt in geometry_wkts],
        )
        geometry_ids = [row.id for row in geometry_result]

        task_records = [
            {
                "annotation_number": max_annotation_number + i + 1,
                "campaign_id": campaign_id,
                "geometry_id": geometry_id,
                "raw_source_data": rd,
                "task_set_id": task_set_id,
            }
            for i, (geometry_id, rd) in enumerate(zip(geometry_ids, source_data, strict=True))
        ]

        db.execute(insert(AnnotationTask), task_records)
        db.commit()
        return len(task_records)

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Import failed. No geometries or task items were created.",
        ) from None


def create_annotation_tasks_from_csv(
    db: Session,
    campaign_id: int,
    contents: bytes,
    task_set_id: int,
) -> None:
    """
    Create annotation tasks from uploaded CSV file.

    Validates CSV structure, coordinates, and creates annotation tasks
    with associated geometry records.

    Expected CSV format:
    - Required columns: id, lat, lon
    - Additional columns preserved in raw_source_data
    - Coordinates in WGS84 (latitude/longitude)

    Args:
        db: Database session
        campaign_id: ID of campaign to create tasks for
        contents: CSV file contents as bytes
        task_set_id: ID of task set to assign created tasks to

    Raises:
        HTTPException: If file is too large, invalid format, or validation fails
    """
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

    df["id"] = df["id"].str.strip()

    if (df["id"] == "").any():
        raise HTTPException(status_code=400, detail="All IDs must be non-empty")

    if df["id"].duplicated().any():
        duplicates = df.loc[df["id"].duplicated(), "id"].head(5).tolist()
        raise HTTPException(
            status_code=400,
            detail=f"Duplicate IDs found in CSV: {duplicates}",
        )

    non_numeric = df.loc[~df["id"].str.fullmatch(r"-?\d+"), "id"].head(5).tolist()
    if non_numeric:
        raise HTTPException(
            status_code=400,
            detail=f"IDs must be integers. Invalid values: {non_numeric}",
        )

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

    geometry_records = [
        {"geometry": f"SRID=4326;POINT({lon} {lat})"}
        for lon, lat in zip(df["lon"].values, df["lat"].values, strict=True)
    ]

    try:
        geometry_result = db.execute(
            insert(AnnotationGeometry).returning(AnnotationGeometry.id),
            geometry_records,
        )
        geometry_ids = [row.id for row in geometry_result]

        task_records = [
            {
                "annotation_number": int(row["id"]),
                "campaign_id": campaign_id,
                "geometry_id": geometry_id,
                "raw_source_data": row["raw_source_data"],
                "task_set_id": task_set_id,
            }
            for geometry_id, (_, row) in zip(geometry_ids, df.iterrows(), strict=True)
        ]

        db.execute(insert(AnnotationTask), task_records)
        db.commit()

    except Exception as e:
        db.rollback()
        logger.exception(
            "CSV import failed for campaign %s during insert (%d rows): %s",
            campaign_id,
            len(df),
            e,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Import failed. No geometries or task items were created. ({type(e).__name__}: {e})",
        ) from None


class GeoJSONParseError(Exception):
    """Raised by `parse_geojson_features` on any structurally invalid input.

    `status_code` is the HTTP status the caller should map this to: 413 for
    an oversized upload, 400 for anything else.
    """

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def parse_geojson_features(
    contents: bytes, max_size: int, *, allow_bare_geometry: bool = True
) -> list[tuple[BaseGeometry, dict]]:
    """Parse and validate GeoJSON bytes into (geometry, properties) pairs.

    Accepts a FeatureCollection or a single Feature; when `allow_bare_geometry`
    is true (the task importer's original behavior) a bare geometry object is
    also accepted, wrapped as one feature with empty properties. Only Point /
    Polygon / MultiPolygon geometries are allowed; each is repaired with
    `buffer(0)` if invalid and rejected if that leaves it empty. Shared by
    both GeoJSON importers below so the size guard and parse/validate logic
    exist once - `allow_bare_geometry` keeps each importer's original
    top-level acceptance set intact.
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
    elif allow_bare_geometry and geojson.get("type") in (
        "Point",
        "Polygon",
        "MultiPolygon",
        "LineString",
    ):
        features = [{"type": "Feature", "geometry": geojson, "properties": {}}]
    else:
        raise GeoJSONParseError("Unsupported GeoJSON type")

    if not features:
        raise GeoJSONParseError("GeoJSON contains no features")

    allowed_types = {"Point", "Polygon", "MultiPolygon"}
    parsed: list[tuple[BaseGeometry, dict]] = []

    for idx, feat in enumerate(features):
        geom_json = feat.get("geometry")
        if not geom_json:
            raise GeoJSONParseError(f"Feature {idx} has no geometry")
        geom_type = geom_json.get("type")
        if geom_type not in allowed_types:
            raise GeoJSONParseError(
                f"Feature {idx}: unsupported geometry type '{geom_type}'. "
                f"Allowed: {sorted(allowed_types)}"
            )

        try:
            geom = shape(geom_json)
            if not geom.is_valid:
                geom = geom.buffer(0)
            if geom.is_empty:
                raise ValueError("empty geometry")
        except Exception as exc:
            raise GeoJSONParseError(f"Feature {idx}: invalid geometry – {exc}") from exc

        parsed.append((geom, feat.get("properties") or {}))

    return parsed


def create_annotation_tasks_from_geojson(
    db: Session,
    campaign_id: int,
    contents: bytes,
    task_set_id: int,
) -> int:
    """
    Create annotation tasks from an uploaded GeoJSON file.

    Each Feature becomes one task. Point features store a POINT geometry;
    Polygon / MultiPolygon features store the full polygon geometry so it
    can be used as sample extent during annotation.

    Args:
        db: Database session
        campaign_id: ID of campaign to create tasks for
        contents: GeoJSON file contents as bytes
        task_set_id: ID of task set to assign created tasks to

    Returns:
        Number of tasks created

    Raises:
        HTTPException: On invalid input or DB failure
    """
    try:
        features = parse_geojson_features(contents, MAX_FILE_SIZE)
    except GeoJSONParseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    geometry_wkts = [geom.wkt for geom, _ in features]
    raw_data = [properties for _, properties in features]

    return insert_tasks(db, campaign_id, task_set_id, geometry_wkts, raw_data)


def create_annotations_from_geojson(
    db: Session,
    campaign: Campaign,
    contents: bytes,
    user_id: UUID,
) -> int:
    """
    Bulk-import existing features as standalone annotations (no task).

    Each Feature becomes one annotation owned by the uploading admin. The
    label is read from the ``stacnotator_label_id`` property (round-trips with
    the GeoJSON export). Every feature must carry a label id that exists in the
    campaign's label set; otherwise the whole import is rejected and nothing is
    created. Form values are read from the ``stacnotator_form_values`` property
    (also round-trips with the export) and validated against the campaign's
    field definitions with ``enforce_required=False`` - lenient on presence,
    strict on shape. Any invalid feature (unknown field id, wrong value shape)
    rejects the whole import, matching the label-validation behavior above.

    Returns:
        Number of annotations created
    """

    try:
        features = parse_geojson_features(contents, MAX_FILE_SIZE, allow_bare_geometry=False)
    except GeoJSONParseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    fields = campaign_form_fields(campaign)
    geometry_records: list[dict] = []
    label_ids: list[int] = []
    source_ids: list[int | None] = []
    form_values_list: list[dict | None] = []
    seen_source_ids: set[int] = set()

    for idx, (geom, properties) in enumerate(features):
        raw_label = properties.get("stacnotator_label_id")
        if raw_label is None:
            raise HTTPException(
                status_code=400,
                detail=f"Feature {idx} is missing a 'stacnotator_label_id'",
            )
        try:
            label_id = int(raw_label)
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Feature {idx}: label id '{raw_label}' is not a valid integer",
            ) from exc
        try:
            validate_label_id(campaign, label_id)
        except HTTPException as exc:
            if exc.status_code != 400:
                raise
            raise HTTPException(
                status_code=400,
                detail=f"Feature {idx}: label id {label_id} is not a label of this campaign",
            ) from None

        raw_form_values = properties.get("stacnotator_form_values")
        try:
            form_values = validate_form_values(fields, raw_form_values, enforce_required=False)
        except FormValidationError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Feature {idx}: {exc.message}",
            ) from exc

        raw_source = properties.get("stacnotator_annotation_id")
        source_id: int | None = None
        if raw_source is not None:
            try:
                source_id = int(raw_source)
            except (TypeError, ValueError) as exc:
                raise HTTPException(
                    status_code=400,
                    detail=f"Feature {idx}: id '{raw_source}' is not a valid integer",
                ) from exc
            if source_id in seen_source_ids:
                raise HTTPException(
                    status_code=400,
                    detail=f"Feature {idx}: duplicate id {source_id} within the file",
                )
            seen_source_ids.add(source_id)

        geometry_records.append({"geometry": f"SRID=4326;{geom.wkt}"})
        label_ids.append(label_id)
        source_ids.append(source_id)
        form_values_list.append(form_values)

    if seen_source_ids:
        existing = db.scalars(
            select(Annotation.source_id).where(
                Annotation.campaign_id == campaign.id,
                Annotation.source_id.in_(seen_source_ids),
            )
        ).all()
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"id(s) already exist in this campaign: {sorted(set(existing))}",
            )

    try:
        geo_result = db.execute(
            insert(AnnotationGeometry).returning(AnnotationGeometry.id),
            geometry_records,
        )
        geometry_ids = [row.id for row in geo_result]

        annotation_records = [
            {
                "geometry_id": gid,
                "campaign_id": campaign.id,
                "created_by_user_id": user_id,
                "annotation_task_id": None,
                "label_id": label_id,
                "source_id": source_id,
                "form_values": form_values,
            }
            for gid, label_id, source_id, form_values in zip(
                geometry_ids, label_ids, source_ids, form_values_list, strict=True
            )
        ]

        db.execute(insert(Annotation), annotation_records)
        db.commit()
        return len(annotation_records)

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Import failed. No annotations were created.",
        ) from None

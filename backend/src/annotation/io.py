import io
import json
import logging
from uuid import UUID

import numpy as np
import pandas as pd
from fastapi import HTTPException
from geoalchemy2.shape import to_shape
from shapely.geometry import mapping, shape
from sqlalchemy import func, insert, select
from sqlalchemy.orm import Session, joinedload

from src.annotation.forms import FormValidationError, validate_form_values
from src.annotation.models import (
    Annotation,
    AnnotationGeometry,
    AnnotationTask,
)
from src.annotation.schemas import compute_task_status_value
from src.annotation.service import (
    attach_counts_toward_completion_flat,
    campaign_form_fields,
    validate_label_id,
)
from src.auth.models import User
from src.campaigns.form_fields import CategoryFormField, DateFormField, FormField, form_field_slug
from src.campaigns.models import Campaign

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB
REQUIRED_COLUMNS = {"id", "lat", "lon"}


# ============================================================================
# CSV Import & Task Creation
# ============================================================================


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
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size: {MAX_FILE_SIZE / 1024 / 1024:.0f}MB",
        )

    try:
        geojson = json.loads(contents.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid GeoJSON file") from exc

    if geojson.get("type") == "FeatureCollection":
        features = geojson.get("features", [])
    elif geojson.get("type") == "Feature":
        features = [geojson]
    elif geojson.get("type") in ("Point", "Polygon", "MultiPolygon", "LineString"):
        features = [{"type": "Feature", "geometry": geojson, "properties": {}}]
    else:
        raise HTTPException(status_code=400, detail="Unsupported GeoJSON type")

    if not features:
        raise HTTPException(status_code=400, detail="GeoJSON contains no features")

    allowed_types = {"Point", "Polygon", "MultiPolygon"}
    geometry_records: list[dict] = []
    raw_data: list[dict] = []

    for idx, feat in enumerate(features):
        geom_json = feat.get("geometry")
        if not geom_json:
            raise HTTPException(
                status_code=400,
                detail=f"Feature {idx} has no geometry",
            )
        geom_type = geom_json.get("type")
        if geom_type not in allowed_types:
            raise HTTPException(
                status_code=400,
                detail=f"Feature {idx}: unsupported geometry type '{geom_type}'. "
                f"Allowed: {sorted(allowed_types)}",
            )

        try:
            geom = shape(geom_json)
            if not geom.is_valid:
                geom = geom.buffer(0)
            if geom.is_empty:
                raise ValueError("empty geometry")
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Feature {idx}: invalid geometry – {exc}",
            ) from exc

        geometry_records.append({"geometry": f"SRID=4326;{geom.wkt}"})
        raw_data.append(feat.get("properties") or {})

    max_num = db.scalar(
        select(func.coalesce(func.max(AnnotationTask.annotation_number), 0)).where(
            AnnotationTask.campaign_id == campaign_id
        )
    )

    try:
        geo_result = db.execute(
            insert(AnnotationGeometry).returning(AnnotationGeometry.id),
            geometry_records,
        )
        geometry_ids = [row.id for row in geo_result]

        task_records = [
            {
                "annotation_number": max_num + i + 1,
                "campaign_id": campaign_id,
                "geometry_id": gid,
                "raw_source_data": rd,
                "task_set_id": task_set_id,
            }
            for i, (gid, rd) in enumerate(zip(geometry_ids, raw_data, strict=True))
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

    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size: {MAX_FILE_SIZE / 1024 / 1024:.0f}MB",
        )

    try:
        geojson = json.loads(contents.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid GeoJSON file") from exc

    if geojson.get("type") == "FeatureCollection":
        features = geojson.get("features", [])
    elif geojson.get("type") == "Feature":
        features = [geojson]
    else:
        raise HTTPException(status_code=400, detail="Unsupported GeoJSON type")

    if not features:
        raise HTTPException(status_code=400, detail="GeoJSON contains no features")

    fields = campaign_form_fields(campaign)
    allowed_types = {"Point", "Polygon", "MultiPolygon"}
    geometry_records: list[dict] = []
    label_ids: list[int] = []
    source_ids: list[int | None] = []
    form_values_list: list[dict | None] = []
    seen_source_ids: set[int] = set()

    for idx, feat in enumerate(features):
        properties = feat.get("properties") or {}
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

        geom_json = feat.get("geometry")
        if not geom_json:
            raise HTTPException(status_code=400, detail=f"Feature {idx} has no geometry")
        geom_type = geom_json.get("type")
        if geom_type not in allowed_types:
            raise HTTPException(
                status_code=400,
                detail=f"Feature {idx}: unsupported geometry type '{geom_type}'. "
                f"Allowed: {sorted(allowed_types)}",
            )

        try:
            geom = shape(geom_json)
            if not geom.is_valid:
                geom = geom.buffer(0)
            if geom.is_empty:
                raise ValueError("empty geometry")
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Feature {idx}: invalid geometry – {exc}",
            ) from exc

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


# ============================================================================
# Data Export
# ============================================================================


def _resolve_label_name(campaign: Campaign, label_id: int | None) -> str | None:
    """Resolve a label ID to its name from campaign settings."""
    if label_id is None:
        return None
    labels = campaign.settings.labels if campaign.settings else {}
    label_id_str = str(label_id)
    if label_id_str in labels:
        label_data = labels[label_id_str]
        return label_data.get("name") if isinstance(label_data, dict) else label_data
    return None


def form_export_columns(fields: list[FormField]) -> list[str]:
    """Export column name for each campaign form field, in field-definition order."""
    return [f"stacnotator_field_{form_field_slug(field.title)}" for field in fields]


def _option_names(field: FormField) -> dict[int, str]:
    if isinstance(field, CategoryFormField):
        return {option.id: option.name for option in field.options}
    return {}


def format_form_value(field: FormField, value: object) -> object | None:
    """Render one submitted form value for CSV/GeoJSON: option ids become
    their option names (multicategory joined with "; "), a daterange becomes
    "start/end", everything else (number/text/date) passes through as-is.

    Stored values may predate a field-definition change; any value whose
    shape no longer matches the field type degrades to str(value) so the
    export never crashes on drifted data.
    """
    return _format_form_value(field, value, _option_names(field))


def _format_form_value(field: FormField, value: object, names: dict[int, str]) -> object | None:
    if value is None:
        return None
    if isinstance(field, CategoryFormField):
        if field.type == "category":
            if isinstance(value, int):
                return names.get(value, str(value))
            return str(value)
        if isinstance(value, list) and all(isinstance(v, int) for v in value):
            return "; ".join(names.get(v, str(v)) for v in value)
        return str(value)
    if isinstance(field, DateFormField) and field.type == "daterange":
        if (
            isinstance(value, dict)
            and isinstance(value.get("start"), str)
            and isinstance(value.get("end"), str)
        ):
            return f"{value['start']}/{value['end']}"
        return str(value)
    return value


class FormExportSchema:
    """The campaign's form fields prepared for one export run.

    Column slugging and option-name lookups depend only on the field
    definitions, so they are resolved once here rather than re-derived for
    every exported row.
    """

    def __init__(self, fields: list[FormField]):
        self.columns = form_export_columns(fields)
        self._cells = [
            (column, field, str(field.id), _option_names(field))
            for column, field in zip(self.columns, fields, strict=True)
        ]

    def cells(self, form_values: dict | None) -> dict[str, object]:
        """One export cell per campaign form field, keyed by its export column
        name. Fields with no entry in ``form_values`` (unanswered) map to None.
        """
        values = form_values or {}
        return {
            column: _format_form_value(field, values.get(key), names)
            for column, field, key, names in self._cells
        }


def _fetch_annotations_with_context(
    db: Session, campaign: Campaign
) -> tuple[list[Annotation], dict[UUID, str]]:
    """Fetch all annotations for a campaign with user emails resolved."""
    annotations = (
        db.execute(
            select(Annotation)
            .where(Annotation.campaign_id == campaign.id)
            .options(
                joinedload(Annotation.geometry),
                joinedload(Annotation.annotation_task).selectinload(AnnotationTask.assignments),
            )
        )
        .unique()
        .scalars()
        .all()
    )
    user_ids = {ann.created_by_user_id for ann in annotations if ann.created_by_user_id}
    user_email_map: dict[UUID, str] = {}
    if user_ids:
        users = db.execute(select(User).where(User.id.in_(user_ids))).scalars().all()
        user_email_map = {user.id: user.email for user in users}
    attach_counts_toward_completion_flat(db, campaign, annotations)
    return annotations, user_email_map


def _geometry_to_wkt(geom) -> str | None:
    if geom is None:
        return None
    try:
        return to_shape(geom).wkt
    except Exception:
        return str(geom)


_STACNOTATOR_COLUMN_ORDER: tuple[str, ...] = (
    "stacnotator_annotation_number",
    "stacnotator_task_id",
    "stacnotator_task_status",
    "stacnotator_counts_toward_completion",
    "stacnotator_label_id",
    "stacnotator_label_name",
    "stacnotator_annotator_count",
    "stacnotator_annotation_id",
    "stacnotator_source_id",
    "stacnotator_comment",
    "stacnotator_confidence",
    "stacnotator_is_authoritative",
    "stacnotator_flagged_for_review",
    "stacnotator_flag_comment",
    "stacnotator_created_by_user_email",
    "stacnotator_created_at",
    "stacnotator_imagery_source_name",
    "stacnotator_imagery_start_date",
    "stacnotator_imagery_end_date",
    "stacnotator_geometry_wkt",
)


def _ordered_columns(records: list[dict], form_columns: list[str]) -> list[str]:
    """Compute the final column order for an export.

    Stacnotator-generated columns first (in ``_STACNOTATOR_COLUMN_ORDER``),
    with the campaign's per-field form columns spliced in right after
    ``stacnotator_label_name`` (they're campaign-specific, so not part of the
    static tuple), then any raw_source_data / user-provided columns in
    first-seen order. Only columns that actually appear in at least one
    record are included.
    """
    seen: set[str] = set()
    for record in records:
        seen.update(record.keys())

    splice_at = _STACNOTATOR_COLUMN_ORDER.index("stacnotator_label_name") + 1
    candidates = (
        *_STACNOTATOR_COLUMN_ORDER[:splice_at],
        *form_columns,
        *_STACNOTATOR_COLUMN_ORDER[splice_at:],
    )

    ordered: list[str] = []
    for col in candidates:
        if col in seen:
            ordered.append(col)
            seen.discard(col)
    for record in records:
        for key in record:
            if key in seen:
                ordered.append(key)
                seen.discard(key)
    return ordered


def _group_annotations_by_task(
    annotations: list[Annotation],
) -> tuple[dict[int, list[Annotation]], list[Annotation]]:
    """Split annotations into (task-grouped, standalone).

    Standalone = open-mode annotations with no task assignment.
    """
    grouped: dict[int, list[Annotation]] = {}
    standalone: list[Annotation] = []
    for ann in annotations:
        if ann.annotation_task_id:
            grouped.setdefault(ann.annotation_task_id, []).append(ann)
        else:
            standalone.append(ann)
    return grouped, standalone


def _conflicting_task_numbers(
    grouped: dict[int, list[Annotation]],
) -> list[int]:
    """Return human-readable annotation_numbers of any task whose labeled
    annotators disagree (>= 2 distinct label_ids among labeled annotations).

    Only annotations whose `counts_toward_completion` is not explicitly False
    are considered, mirroring `compute_task_status_value` - an extra label the
    labelling policy allows but doesn't count must not manufacture a conflict
    on its own.
    """
    conflicts: list[int] = []
    for task_id, task_anns in grouped.items():
        counting = [
            a for a in task_anns if getattr(a, "counts_toward_completion", None) is not False
        ]
        labeled = [a for a in counting if a.label_id is not None]
        if any(a.is_authoritative for a in labeled):
            continue
        if len(labeled) >= 2 and len({a.label_id for a in labeled}) > 1:
            task = task_anns[0].annotation_task
            conflicts.append(task.annotation_number if task else task_id)
    return sorted(conflicts)


def _compute_task_status_for_export(
    task: AnnotationTask | None, task_anns: list[Annotation]
) -> str | None:
    """Compute task status using the shared rule on already-loaded data.

    Calls the same logic as the API (``compute_task_status_value`` in schemas.py)
    but feeds it in-memory annotations and the eager-loaded assignments, avoiding
    ``AnnotationTaskOut.model_validate`` which would lazy-load creator/user/geometry
    relationships once per task and annotation (an N+1 storm during export).
    """
    if task is None:
        return None
    assignment_list = [
        {"user_id": a.user_id, "status": a.status, "is_review": a.is_review}
        for a in (task.assignments or [])
    ]
    annotation_list = [
        {
            "label_id": a.label_id,
            "created_by_user_id": a.created_by_user_id,
            "is_authoritative": a.is_authoritative,
            "counts_toward_completion": getattr(a, "counts_toward_completion", None),
        }
        for a in task_anns
    ]
    return compute_task_status_value(assignment_list, annotation_list)


def _build_export_record_for_annotation(
    annotation: Annotation,
    campaign: Campaign,
    user_email_map: dict[UUID, str],
    task_status: str | None,
    include_geometry_wkt: bool,
    form_schema: FormExportSchema,
    task_annotator_count: int = 1,
) -> dict:
    """Build one flat record for a single annotation (non-merged output).

    All stacnotator-generated keys are prefixed ``stacnotator_``. Keys from
    the task's ``raw_source_data`` (user-provided ingest columns) are kept
    un-prefixed so the downstream consumer can tell our IDs apart from theirs.

    ``task_annotator_count`` is the number of labeled annotations on the
    annotation's parent task (matches the merged-path definition). All rows
    for the same task carry the same value so downstream agreement analyses
    can be derived even when rows aren't collapsed. Standalone (open-mode)
    annotations have no task grouping and default to 1.
    """
    record: dict = {}

    task = annotation.annotation_task
    if task is not None:
        if task.raw_source_data:
            record.update(task.raw_source_data)
        record["stacnotator_task_id"] = task.id
        record["stacnotator_annotation_number"] = task.annotation_number
        record["stacnotator_task_status"] = task_status
        record["stacnotator_counts_toward_completion"] = getattr(
            annotation, "counts_toward_completion", None
        )

    record["stacnotator_annotation_id"] = annotation.id
    record["stacnotator_source_id"] = annotation.source_id
    record["stacnotator_label_id"] = annotation.label_id
    record["stacnotator_label_name"] = _resolve_label_name(campaign, annotation.label_id)
    record.update(form_schema.cells(annotation.form_values))
    record["stacnotator_comment"] = annotation.comment
    record["stacnotator_confidence"] = annotation.confidence
    record["stacnotator_is_authoritative"] = annotation.is_authoritative
    record["stacnotator_flagged_for_review"] = annotation.flagged_for_review
    record["stacnotator_flag_comment"] = annotation.flag_comment
    record["stacnotator_created_by_user_email"] = user_email_map.get(annotation.created_by_user_id)
    record["stacnotator_created_at"] = annotation.created_at
    record["stacnotator_annotator_count"] = task_annotator_count
    record["stacnotator_imagery_source_name"] = annotation.imagery_source_name
    record["stacnotator_imagery_start_date"] = annotation.imagery_start_date
    record["stacnotator_imagery_end_date"] = annotation.imagery_end_date
    if include_geometry_wkt:
        record["stacnotator_geometry_wkt"] = (
            _geometry_to_wkt(annotation.geometry.geometry) if annotation.geometry else None
        )
    return record


def _build_export_record_merged(
    anns: list[Annotation],
    campaign: Campaign,
    user_email_map: dict[UUID, str],
    task_status: str | None,
    include_geometry_wkt: bool,
    form_schema: FormExportSchema,
) -> dict:
    """Collapse multiple annotations of the same task into one record.

    Caller must have already ensured the labeled annotations agree (any
    conflict is rejected up-front by ``_guard_merge_on_agreement``). The row
    represents the task with the agreed label and aggregates per-annotator
    detail (emails, comments, confidences). The DB ``stacnotator_annotation_id``
    field is intentionally **omitted** here - the row no longer corresponds
    to a single annotation row, and ``stacnotator_task_id`` is the stable
    join key in merged mode.
    """
    labeled = [a for a in anns if a.label_id is not None]
    canonical = next((a for a in labeled if a.is_authoritative), labeled[0])
    agreed_label_id = canonical.label_id

    emails = sorted(
        {user_email_map.get(a.created_by_user_id, "") for a in labeled if a.created_by_user_id}
        - {""}
    )
    comments = [
        f"{user_email_map.get(a.created_by_user_id, 'unknown')}: {a.comment}"
        for a in labeled
        if a.comment and a.comment.strip()
    ]
    confidences = [a.confidence for a in labeled if a.confidence is not None]
    mean_confidence = round(sum(confidences) / len(confidences), 2) if confidences else None
    latest_created_at = max((a.created_at for a in labeled if a.created_at), default=None)

    record: dict = {}
    task = canonical.annotation_task
    if task is not None:
        if task.raw_source_data:
            record.update(task.raw_source_data)
        record["stacnotator_task_id"] = task.id
        record["stacnotator_annotation_number"] = task.annotation_number
        record["stacnotator_task_status"] = task_status
        # True if any contributing label counts toward completion - the merged
        # row represents the task's resolved label, so it counts if the
        # resolution itself was reachable by a counting contributor.
        record["stacnotator_counts_toward_completion"] = any(
            getattr(a, "counts_toward_completion", False) for a in labeled
        )

    record["stacnotator_label_id"] = agreed_label_id
    record["stacnotator_label_name"] = _resolve_label_name(campaign, agreed_label_id)
    record.update(form_schema.cells(canonical.form_values))
    record["stacnotator_comment"] = " | ".join(comments) if comments else None
    record["stacnotator_confidence"] = mean_confidence
    record["stacnotator_is_authoritative"] = any(a.is_authoritative for a in labeled)
    record["stacnotator_flagged_for_review"] = any(a.flagged_for_review for a in labeled)
    flag_comments = [
        f"{user_email_map.get(a.created_by_user_id, 'unknown')}: {a.flag_comment}"
        for a in labeled
        if a.flag_comment and a.flag_comment.strip()
    ]
    record["stacnotator_flag_comment"] = " | ".join(flag_comments) if flag_comments else None
    record["stacnotator_created_by_user_email"] = ", ".join(emails) if emails else None
    record["stacnotator_created_at"] = latest_created_at
    record["stacnotator_annotator_count"] = len(labeled)
    if include_geometry_wkt:
        geom = canonical.geometry.geometry if canonical.geometry else None
        record["stacnotator_geometry_wkt"] = _geometry_to_wkt(geom) if geom is not None else None
    return record


def _build_annotation_records(
    annotations: list[Annotation],
    campaign: Campaign,
    user_email_map: dict[UUID, str],
    merge_on_agreement: bool,
    include_geometry_wkt: bool,
    form_schema: FormExportSchema,
) -> tuple[list[dict], list[Annotation]]:
    """Core export loop. Returns (records, canonical_annotations).

    The canonical_annotations list is parallel to records and is used by the
    GeoJSON wrapper to pick the geometry per emitted row (merged rows use the
    canonical annotation's geometry).

    Assumes the caller has already validated that no task conflicts when
    ``merge_on_agreement`` is True (see ``_guard_merge_on_agreement``).
    """
    grouped, standalone = _group_annotations_by_task(annotations)

    records: list[dict] = []
    canonical_annotations: list[Annotation] = []

    for task_id in sorted(grouped.keys()):
        task_anns = grouped[task_id]
        task = task_anns[0].annotation_task
        task_status = _compute_task_status_for_export(task, task_anns)
        labeled = [a for a in task_anns if a.label_id is not None]

        if merge_on_agreement and len(labeled) >= 2:
            records.append(
                _build_export_record_merged(
                    task_anns,
                    campaign,
                    user_email_map,
                    task_status,
                    include_geometry_wkt,
                    form_schema,
                )
            )
            canonical_annotations.append(
                next((a for a in labeled if a.is_authoritative), labeled[0])
            )
        else:
            labeled_count = len(labeled)
            for ann in task_anns:
                records.append(
                    _build_export_record_for_annotation(
                        ann,
                        campaign,
                        user_email_map,
                        task_status,
                        include_geometry_wkt,
                        form_schema,
                        task_annotator_count=labeled_count,
                    )
                )
                canonical_annotations.append(ann)

    for ann in standalone:
        records.append(
            _build_export_record_for_annotation(
                ann, campaign, user_email_map, None, include_geometry_wkt, form_schema
            )
        )
        canonical_annotations.append(ann)

    return records, canonical_annotations


def _guard_merge_on_agreement(annotations: list[Annotation], merge_on_agreement: bool) -> None:
    """Reject a merge-on-agreement export if any task has conflicting labels.

    Raises HTTPException(400) listing up to 10 conflicting annotation_numbers
    in the detail. The frontend already disables the merge toggle when any
    task is in 'conflicting' status, so reaching this guard is the signal
    that something bypassed the UI - return a clear error.
    """
    if not merge_on_agreement:
        return
    grouped, _ = _group_annotations_by_task(annotations)
    conflicts = _conflicting_task_numbers(grouped)
    if conflicts:
        preview = ", ".join(f"#{n}" for n in conflicts[:10])
        more = f" and {len(conflicts) - 10} more" if len(conflicts) > 10 else ""
        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot merge annotations on agreement: "
                f"{len(conflicts)} task(s) have conflicting labels ({preview}{more}). "
                "Resolve the conflicts first, or export without merging."
            ),
        )


def build_annotations_export(
    db: Session,
    campaign: Campaign,
    merge_on_agreement: bool = False,
) -> pd.DataFrame:
    """Build CSV export of all annotations and tasks for a campaign.

    When ``merge_on_agreement`` is True, tasks labeled by multiple annotators
    whose labels unanimously agree are collapsed into a single row. If any
    task has disagreeing labels, the export is rejected with HTTP 400 - the
    frontend disables this option in that case, so reaching it here means
    something bypassed the UI. All stacnotator-generated columns carry the
    ``stacnotator_`` prefix; ``raw_source_data`` keys (user-provided ingest
    columns) stay un-prefixed so the consumer can tell their IDs apart from
    ours.
    """
    annotations, user_email_map = _fetch_annotations_with_context(db, campaign)
    _guard_merge_on_agreement(annotations, merge_on_agreement)
    form_schema = FormExportSchema(campaign_form_fields(campaign))

    records, _canonical = _build_annotation_records(
        annotations=annotations,
        campaign=campaign,
        user_email_map=user_email_map,
        merge_on_agreement=merge_on_agreement,
        include_geometry_wkt=True,
        form_schema=form_schema,
    )

    columns = _ordered_columns(records, form_schema.columns)
    for record in records:
        for col in columns:
            record.setdefault(col, np.nan)

    return pd.DataFrame(records, columns=list(columns))


def build_annotations_geojson_export(
    db: Session,
    campaign: Campaign,
    merge_on_agreement: bool = False,
) -> dict:
    """Build a GeoJSON FeatureCollection of all annotations for a campaign.

    See ``build_annotations_export`` for merge semantics (and the HTTP 400
    raised when a merge is requested but conflicts exist). GeoJSON features
    use the canonical annotation's geometry for merged rows.
    """
    annotations, user_email_map = _fetch_annotations_with_context(db, campaign)
    _guard_merge_on_agreement(annotations, merge_on_agreement)
    form_schema = FormExportSchema(campaign_form_fields(campaign))

    records, canonical_annotations = _build_annotation_records(
        annotations=annotations,
        campaign=campaign,
        user_email_map=user_email_map,
        merge_on_agreement=merge_on_agreement,
        include_geometry_wkt=False,
        form_schema=form_schema,
    )

    columns = _ordered_columns(records, form_schema.columns)

    features = []
    for record, canonical in zip(records, canonical_annotations, strict=True):
        geojson_geometry = None
        if canonical.geometry:
            try:
                geojson_geometry = mapping(to_shape(canonical.geometry.geometry))
            except Exception:
                geojson_geometry = None

        properties: dict = {}
        for col in columns:
            if col in record:
                value = record[col]
                properties[col] = value.isoformat() if hasattr(value, "isoformat") else value
        if form_schema.columns:
            properties["stacnotator_form_values"] = canonical.form_values

        features.append(
            {
                "type": "Feature",
                "geometry": geojson_geometry,
                "properties": properties,
            }
        )

    return {
        "type": "FeatureCollection",
        "features": features,
    }

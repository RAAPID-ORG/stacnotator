"""Annotation export: a pure record-building core plus a thin DB seam.

``build_export_records`` carries all the export logic over already-loaded
annotation objects (no DB session), so it can be unit-tested with in-memory
stubs. ``fetch_annotations_with_context`` is the single DB touch, and the
``build_annotations_*`` composers wire the two together for the router.

Never imports annotation/service.py: the shared helpers it needs live in
annotation/forms.py (form-field parsing) and annotation/completion.py
(counts-toward-completion attachment).
"""

from uuid import UUID

import numpy as np
import pandas as pd
from fastapi import HTTPException
from geoalchemy2.shape import to_shape
from shapely.geometry import mapping
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from src.annotation.completion import attach_counts_toward_completion_flat
from src.annotation.forms import campaign_form_fields
from src.annotation.models import (
    Annotation,
    AnnotationTask,
)
from src.annotation.schemas import compute_task_status_value
from src.auth.models import User
from src.campaigns.form_fields import CategoryFormField, DateFormField, FormField, form_field_slug
from src.campaigns.models import Campaign


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


def build_export_records(
    annotations: list[Annotation],
    campaign: Campaign,
    user_email_map: dict[UUID, str],
    merge_on_agreement: bool,
    include_geometry_wkt: bool,
) -> tuple[list[dict], list[Annotation], list[str]]:
    """Pure export core: turn already-loaded annotations into flat records.

    Returns ``(records, canonical_annotations, columns)`` where
    ``canonical_annotations`` is parallel to ``records`` (the annotation whose
    geometry the GeoJSON wrapper should use for each row) and ``columns`` is
    the final ordered column set. No DB access - callers prefetch annotations
    (with counts attached) via ``fetch_annotations_with_context``.

    Raises HTTPException(400) when ``merge_on_agreement`` is requested but some
    task has conflicting labels.
    """
    _guard_merge_on_agreement(annotations, merge_on_agreement)
    form_schema = FormExportSchema(campaign_form_fields(campaign))

    records, canonical_annotations = _build_annotation_records(
        annotations=annotations,
        campaign=campaign,
        user_email_map=user_email_map,
        merge_on_agreement=merge_on_agreement,
        include_geometry_wkt=include_geometry_wkt,
        form_schema=form_schema,
    )

    columns = _ordered_columns(records, form_schema.columns)
    return records, canonical_annotations, columns


def fetch_annotations_with_context(
    db: Session, campaign: Campaign
) -> tuple[list[Annotation], dict[UUID, str]]:
    """Fetch all annotations for a campaign with user emails resolved and
    ``counts_toward_completion`` attached (the one DB touch of the export)."""
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
    attach_counts_toward_completion_flat(db, campaign, list(annotations))
    return list(annotations), user_email_map


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
    annotations, user_email_map = fetch_annotations_with_context(db, campaign)
    records, _canonical, columns = build_export_records(
        annotations=annotations,
        campaign=campaign,
        user_email_map=user_email_map,
        merge_on_agreement=merge_on_agreement,
        include_geometry_wkt=True,
    )

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
    annotations, user_email_map = fetch_annotations_with_context(db, campaign)
    records, canonical_annotations, columns = build_export_records(
        annotations=annotations,
        campaign=campaign,
        user_email_map=user_email_map,
        merge_on_agreement=merge_on_agreement,
        include_geometry_wkt=False,
    )

    has_form_fields = bool(campaign_form_fields(campaign))

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
        if has_form_fields:
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

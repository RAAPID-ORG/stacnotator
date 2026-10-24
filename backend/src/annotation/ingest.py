"""DB-bound import flows: CSV / GeoJSON uploads -> tasks and annotations.

Validates and bulk-inserts geometries plus their task/annotation rows in one
transaction, translating any failure into an HTTPException. Pure export logic
lives in export.py; this module is the write-side shell.
"""

import logging
from uuid import UUID

from fastapi import HTTPException
from geoalchemy2.elements import WKTElement
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from src.annotation.forms import (
    FormValidationError,
    campaign_form_fields,
    validate_form_values,
)
from src.annotation.models import Annotation
from src.annotation.service import validate_label_id
from src.annotation.sync import bump_campaign_annotations_version
from src.campaigns.models import Campaign
from src.geometry import ewkt
from src.tasks.ingest import MAX_FILE_SIZE, GeoJSONParseError, parse_geojson_features

logger = logging.getLogger(__name__)


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
        features = parse_geojson_features(contents, MAX_FILE_SIZE)
    except GeoJSONParseError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    fields = campaign_form_fields(campaign)
    geometries: list[WKTElement] = []
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

        geometries.append(ewkt(geom.wkt))
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
                detail=(
                    "id(s) already exist in this campaign: "
                    f"{sorted({sid for sid in existing if sid is not None})}"
                ),
            )

    try:
        annotation_records = [
            {
                "geometry": geometry,
                "campaign_id": campaign.id,
                "created_by_user_id": user_id,
                "task_id": None,
                "label_id": label_id,
                "source_id": source_id,
                "form_values": form_values,
            }
            for geometry, label_id, source_id, form_values in zip(
                geometries, label_ids, source_ids, form_values_list, strict=True
            )
        ]

        db.execute(insert(Annotation), annotation_records)
        bump_campaign_annotations_version(db, campaign.id)
        db.commit()
        return len(annotation_records)

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Import failed. No annotations were created.",
        ) from None

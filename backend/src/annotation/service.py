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

from src.annotation.constants import (
    ANNOTATION_TASK_STATUS_DONE,
    ANNOTATION_TASK_STATUS_PENDING,
    ANNOTATION_TASK_STATUS_SKIPPED,
)
from src.annotation.models import (
    Annotation,
    AnnotationGeometry,
    AnnotationTask,
    AnnotationTaskAssignment,
    Embedding,
)
from src.annotation.schemas import (
    AnnotationCreate,
    AnnotationFromTaskCreate,
    AnnotationTaskOut,
    AnnotationUpdate,
)
from src.auth.models import User
from src.auth.service import is_admin as is_platform_admin
from src.campaigns.models import Campaign, CampaignUser
from src.campaigns.service import is_authoritative_reviewer

logger = logging.getLogger(__name__)

# CSV import configuration
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB
REQUIRED_COLUMNS = {"id", "lat", "lon"}


def get_user_assignment_status(task: AnnotationTask, user_id: UUID) -> str:
    """Get a user's assignment status for a task."""
    if task and task.assignments:
        for a in task.assignments:
            if a.user_id == user_id:
                return a.status
    return "pending"


def _is_campaign_admin(db: Session, user_id: UUID, campaign_id: int) -> bool:
    """Check if a user is an admin of the given campaign or a platform admin."""
    campaign_admin = db.execute(
        select(CampaignUser).where(
            CampaignUser.campaign_id == campaign_id,
            CampaignUser.user_id == user_id,
            CampaignUser.is_admin,
        )
    ).scalar_one_or_none()
    return campaign_admin is not None or is_platform_admin(db, user_id)


# ============================================================================
# Task Retrieval
# ============================================================================


def get_annotation_task_by_id(
    db: Session,
    task_id: int,
    campaign_id: int,
) -> AnnotationTask | None:
    """
    Retrieve a single annotation task by ID, ensuring it belongs to the campaign.

    Args:
        db: Database session
        task_id: ID of the task
        campaign_id: ID of the campaign (for validation)

    Returns:
        Annotation task item or None if not found
    """
    stmt = (
        select(AnnotationTask)
        .where(
            AnnotationTask.id == task_id,
            AnnotationTask.campaign_id == campaign_id,
        )
        .options(
            joinedload(AnnotationTask.geometry),
            joinedload(AnnotationTask.assignments).joinedload(AnnotationTaskAssignment.user),
            joinedload(AnnotationTask.annotations).joinedload(Annotation.creator),
        )
    )

    task = db.scalars(stmt).unique().first()
    if task is not None:
        _attach_has_embedding(db, [task])
    return task


def get_annotation_tasks_for_campaign(
    db: Session,
    campaign_id: int,
) -> list[AnnotationTask]:
    """
    Retrieve all annotation tasks for a campaign with eager loading
    to avoid N+1 query problem.

    This loads all related data (geometry, assignments, annotations)
    in a single optimized query.

    Args:
        db: Database session
        campaign_id: ID of the campaign

    Returns:
        List of annotation task items with all relationships loaded
    """
    stmt = (
        select(AnnotationTask)
        .where(AnnotationTask.campaign_id == campaign_id)
        .options(
            joinedload(AnnotationTask.geometry),
            joinedload(AnnotationTask.assignments).joinedload(AnnotationTaskAssignment.user),
            joinedload(AnnotationTask.annotations).joinedload(Annotation.creator),
        )
        .order_by(AnnotationTask.annotation_number)
    )

    tasks = db.scalars(stmt).unique().all()
    _attach_has_embedding(db, tasks)
    return tasks


def _attach_has_embedding(db: Session, tasks: list[AnnotationTask]) -> None:
    """Set `has_embedding` on each task via one lightweight indexed lookup.

    Kept out of the main joinedload chain so it does not multiply the result
    rows; Embedding has its own hnsw index and FK on annotation_task_id.
    """
    if not tasks:
        return
    task_ids = [t.id for t in tasks]
    embedded_ids = set(
        db.execute(
            select(Embedding.annotation_task_id).where(Embedding.annotation_task_id.in_(task_ids))
        ).scalars()
    )
    for task in tasks:
        task.has_embedding = task.id in embedded_ids


def get_annotation_task_id_for_annotation(
    db: Session,
    annotation_id: int,
    campaign_id: int,
) -> int | None:
    """Get the task_id linked to an annotation (if any), before deletion."""
    result = db.execute(
        select(Annotation.annotation_task_id).where(
            Annotation.id == annotation_id,
            Annotation.campaign_id == campaign_id,
        )
    ).scalar_one_or_none()
    return result


# ============================================================================
# CSV Import & Task Creation
# ============================================================================


def create_annotation_tasks_from_csv(
    db: Session,
    campaign_id: int,
    contents: bytes,
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

    Raises:
        HTTPException: If file is too large, invalid format, or validation fails
    """
    # Validate file size
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size: {MAX_FILE_SIZE / 1024 / 1024:.0f}MB",
        )

    # Parse CSV
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
    except Exception as e:
        logger.exception("CSV import failed for campaign %s: parse error", campaign_id)
        raise HTTPException(status_code=400, detail=f"Invalid CSV format: {e}") from None

    # Validate required columns
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV must contain columns: {sorted(REQUIRED_COLUMNS)}",
        )

    # Preserve all data in raw_source_data for export back to csv later
    df["raw_source_data"] = df.apply(lambda r: r.to_dict(), axis=1)
    df = df[list(REQUIRED_COLUMNS) + ["raw_source_data"]]

    if df.empty:
        raise HTTPException(status_code=400, detail="CSV contains no rows")

    missing_mask = df[["id", "lat", "lon"]].isna().any(axis=1)
    if missing_mask.any():
        bad_rows = (df.index[missing_mask][:5] + 2).tolist()  # +2: header + 1-indexed
        raise HTTPException(
            status_code=400,
            detail=f"Missing id/lat/lon in rows: {bad_rows}",
        )

    # Validate IDs
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

    # Validate coordinates
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

    # Create geometry records
    geometry_records = [
        {"geometry": f"SRID=4326;POINT({lon} {lat})"}
        for lon, lat in zip(df["lon"].values, df["lat"].values, strict=True)
    ]

    try:
        # Insert geometries and get IDs
        geometry_result = db.execute(
            insert(AnnotationGeometry).returning(AnnotationGeometry.id),
            geometry_records,
        )
        geometry_ids = [row.id for row in geometry_result]

        # Create task items
        task_records = [
            {
                "annotation_number": int(row["id"]),
                "campaign_id": campaign_id,
                "geometry_id": geometry_id,
                "status": "pending",
                "raw_source_data": row["raw_source_data"],
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

    # Normalise into a flat list of features
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

        # Validate with Shapely
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

    # Get the current max annotation_number for this campaign
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
                "status": "pending",
                "raw_source_data": rd,
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


# ============================================================================
# Annotation Creation
# ============================================================================


def add_annotation_for_task(
    db: Session,
    annotation_task: AnnotationTask,
    annotation_create: AnnotationFromTaskCreate,
    user_id: UUID,
) -> Annotation | None:
    """
    Create or update annotation for a task item and update task status.

    If annotation exists (same task, same user):
    - Delete it if no new label provided and mark assignment as skipped
    - Update it if new label/comment is provided

    If annotation doesn't exist:
    - Create annotation record if label or comment is provided
    - If from assignment: Update assignment status to 'done' (with label) or 'skipped' (without label)

    Args:
        db: Database session
        annotation_task: Task item being annotated
        annotation_create: Annotation data from user
        user_id: ID of user creating the annotation
    """

    if annotation_create.is_authoritative and not is_authoritative_reviewer(
        db, annotation_task.campaign_id, user_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Only campaign admins or authoritative reviewers can submit authoritative annotations",
        )

    # Check if annotation already exists for this task
    existing_annotation = db.execute(
        select(Annotation).where(
            Annotation.annotation_task_id == annotation_task.id,
            Annotation.created_by_user_id == user_id,
        )
    ).scalar_one_or_none()

    assignment = db.execute(
        select(AnnotationTaskAssignment).where(
            AnnotationTaskAssignment.task_id == annotation_task.id,
            AnnotationTaskAssignment.user_id == user_id,
        )
    ).scalar_one_or_none()

    annotation = None

    if existing_annotation:  # UPDATE
        # If no new label provided, delete existing annotation and mark as skipped
        if annotation_create.label_id is None:
            db.delete(existing_annotation)
            if assignment:
                assignment.status = ANNOTATION_TASK_STATUS_SKIPPED
        else:
            # Update existing annotation with new label/comment
            existing_annotation.label_id = annotation_create.label_id
            existing_annotation.comment = annotation_create.comment
            existing_annotation.created_by_user_id = user_id
            existing_annotation.confidence = annotation_create.confidence
            if annotation_create.is_authoritative is not None:
                existing_annotation.is_authoritative = annotation_create.is_authoritative
            existing_annotation.flagged_for_review = annotation_create.flagged_for_review or False
            existing_annotation.flag_comment = (
                annotation_create.flag_comment if annotation_create.flagged_for_review else None
            )
            if assignment:
                assignment.status = ANNOTATION_TASK_STATUS_DONE
                annotation = existing_annotation
    else:  # CREATE
        # Create new annotation if label or comment provided
        if annotation_create.label_id is not None or annotation_create.comment is not None:
            annotation = Annotation(
                geometry_id=annotation_task.geometry_id,
                label_id=annotation_create.label_id,
                comment=annotation_create.comment,
                annotation_task_id=annotation_task.id,
                campaign_id=annotation_task.campaign_id,
                created_by_user_id=user_id,
                confidence=annotation_create.confidence,
                is_authoritative=annotation_create.is_authoritative or False,
                flagged_for_review=annotation_create.flagged_for_review or False,
                flag_comment=(
                    annotation_create.flag_comment if annotation_create.flagged_for_review else None
                ),
            )
            db.add(annotation)

        # Update assigment status if from assignment
        if assignment:
            assignment.status = (
                ANNOTATION_TASK_STATUS_SKIPPED
                if annotation_create.label_id is None
                else ANNOTATION_TASK_STATUS_DONE
            )

    db.commit()

    if annotation:
        db.refresh(annotation)
        return annotation


def create_annotation(
    db: Session,
    campaign: Campaign,
    annotation_create: AnnotationCreate,
    user_id: UUID,
) -> Annotation:
    """
    Create a standalone annotation (not linked to a task).

    Creates a new geometry record and annotation for the given campaign.

    Args:
        db: Database session
        campaign: Campaign to create annotation for
        annotation_create: Annotation data including geometry
        user_id: ID of user creating the annotation

    Returns:
        Created annotation record

    Raises:
        HTTPException: If geometry is invalid or creation fails
    """
    try:
        # Create geometry from WKT
        geometry = AnnotationGeometry(geometry=f"SRID=4326;{annotation_create.geometry_wkt}")
        db.add(geometry)
        db.flush()  # Get geometry ID

        # Create annotation
        annotation = Annotation(
            geometry_id=geometry.id,
            label_id=annotation_create.label_id,
            comment=annotation_create.comment,
            campaign_id=campaign.id,
            created_by_user_id=user_id,
            confidence=annotation_create.confidence,
            annotation_task_id=None,  # Standalone annotation
            flagged_for_review=annotation_create.flagged_for_review or False,
            flag_comment=(
                annotation_create.flag_comment if annotation_create.flagged_for_review else None
            ),
        )
        db.add(annotation)
        db.commit()
        db.refresh(annotation)

        return annotation

    except Exception as e:
        db.rollback()
        logger.exception("Failed to create annotation")
        raise HTTPException(status_code=400, detail="Failed to create annotation") from e


def update_annotation(
    db: Session,
    annotation_id: int,
    annotation_update: AnnotationUpdate,
    user_id: UUID,
    campaign: Campaign | None = None,
) -> Annotation:
    """
    Update an existing annotation.

    Updates label, comment, and/or geometry. If geometry is updated,
    creates a new geometry record and updates the reference.

    In public campaigns, only the annotation creator can update their annotations.

    Args:
        db: Database session
        annotation_id: ID of annotation to update
        annotation_update: Updated annotation data
        user_id: ID of user updating the annotation
        campaign: Campaign object (used for public campaign ownership check)

    Returns:
        Updated annotation record

    Raises:
        HTTPException: If annotation not found, update fails, or ownership violated
    """
    # Get existing annotation
    annotation = db.execute(
        select(Annotation).where(Annotation.id == annotation_id)
    ).scalar_one_or_none()

    if annotation is None:
        raise HTTPException(status_code=404, detail="Annotation not found")

    # In public campaigns, only the creator or a campaign admin can update annotations
    if (
        campaign
        and campaign.is_public
        and annotation.created_by_user_id != user_id
        and not _is_campaign_admin(db, user_id, campaign.id)
    ):
        raise HTTPException(
            status_code=403,
            detail="You can only edit your own annotations",
        )

    try:
        # Update geometry if provided
        if annotation_update.geometry_wkt is not None:
            new_geometry = AnnotationGeometry(
                geometry=f"SRID=4326;{annotation_update.geometry_wkt}"
            )
            db.add(new_geometry)
            db.flush()  # Get new geometry ID
            annotation.geometry_id = new_geometry.id

        # Update label if provided
        if annotation_update.label_id is not None:
            annotation.label_id = annotation_update.label_id

        # Update comment if provided (allow empty string to clear)
        if annotation_update.comment is not None:
            annotation.comment = annotation_update.comment

        # Update confidence if provided
        if annotation_update.confidence is not None:
            annotation.confidence = annotation_update.confidence

        if annotation_update.flagged_for_review is not None:
            annotation.flagged_for_review = annotation_update.flagged_for_review
            if not annotation_update.flagged_for_review:
                annotation.flag_comment = None
        if annotation_update.flag_comment is not None and annotation.flagged_for_review:
            annotation.flag_comment = annotation_update.flag_comment

        db.commit()
        db.refresh(annotation)

        return annotation

    except Exception as e:
        db.rollback()
        logger.exception("Failed to update annotation")
        raise HTTPException(status_code=400, detail="Failed to update annotation") from e


# ============================================================================
# Annotation Retrieval
# ============================================================================


def get_annotations_for_campaign(
    db: Session,
    campaign_id: int,
) -> list[Annotation]:
    """
    Retrieve all annotations for a specific campaign with eager loading.

    Returns both task-based and standalone annotations for the given campaign.

    Args:
        db: Database session
        campaign_id: ID of campaign to retrieve annotations for

    Returns:
        List of all annotation records for the campaign
    """
    stmt = (
        select(Annotation)
        .where(Annotation.campaign_id == campaign_id)
        .options(
            joinedload(Annotation.geometry),
            joinedload(Annotation.creator),
        )
    )
    annotations = db.scalars(stmt).unique().all()

    return list(annotations)


def delete_annotation(
    db: Session,
    annotation_id: int,
    campaign_id: int,
    user_id: UUID | None = None,
    campaign: Campaign | None = None,
) -> None:
    """
    Delete a specific annotation from a campaign.

    If the annotation is linked to a task item, the task status is updated
    to 'pending' to allow re-annotation.

    In public campaigns, only the annotation creator can delete their annotations.

    Args:
        db: Database session
        annotation_id: ID of annotation to delete
        campaign_id: ID of campaign (used for validation)
        user_id: ID of user requesting deletion (for ownership check)
        campaign: Campaign object (for public campaign ownership check)

    Raises:
        HTTPException: If annotation not found, doesn't belong to campaign, or ownership violated
    """
    # Get annotation and verify it belongs to the campaign
    annotation = db.execute(
        select(Annotation).where(
            Annotation.id == annotation_id,
            Annotation.campaign_id == campaign_id,
        )
    ).scalar_one_or_none()

    if annotation is None:
        raise HTTPException(status_code=404, detail="Annotation not found in this campaign")

    # In public campaigns, only the creator or a campaign admin can delete annotations
    if (
        campaign
        and campaign.is_public
        and user_id
        and annotation.created_by_user_id != user_id
        and not _is_campaign_admin(db, user_id, campaign.id)
    ):
        raise HTTPException(
            status_code=403,
            detail="You can only delete your own annotations",
        )

    try:
        # If linked to a task, reset task status to pending
        if annotation.annotation_task_id is not None:
            assignment = db.execute(
                select(AnnotationTaskAssignment).where(
                    AnnotationTaskAssignment.task_id == annotation.annotation_task_id,
                    AnnotationTaskAssignment.user_id == annotation.created_by_user_id,
                )
            ).scalar_one_or_none()

            if assignment:
                assignment.status = ANNOTATION_TASK_STATUS_PENDING
                db.add(assignment)  # Explicitly add to session to ensure update is tracked

        # Delete the annotation
        db.delete(annotation)
        db.commit()

    except Exception as e:
        db.rollback()
        logger.exception("Failed to delete annotation")
        raise HTTPException(status_code=500, detail="Failed to delete annotation") from e


def delete_annotations_bulk(
    db: Session,
    annotation_ids: list[int],
    campaign: Campaign,
    user_id: UUID,
) -> int:
    """
    Delete multiple annotations from a campaign in one transaction.

    Mirrors `delete_annotation` semantics: in public campaigns, non-admins can
    only delete their own annotations. Task-linked annotations have their
    per-user assignment status reset to 'pending' so the task re-opens.

    Returns the number of annotations actually deleted.
    """
    if not annotation_ids:
        return 0

    annotations = db.scalars(
        select(Annotation).where(
            Annotation.id.in_(annotation_ids),
            Annotation.campaign_id == campaign.id,
        )
    ).all()

    found_ids = {a.id for a in annotations}
    missing = set(annotation_ids) - found_ids
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Annotations not found in campaign: {sorted(missing)}",
        )

    # Public-campaign ownership check applies whenever the requester isn't an admin
    if campaign.is_public and not _is_campaign_admin(db, user_id, campaign.id):
        not_owned = [a.id for a in annotations if a.created_by_user_id != user_id]
        if not_owned:
            raise HTTPException(
                status_code=403,
                detail=f"You can only delete your own annotations: {sorted(not_owned)}",
            )

    try:
        # Reset assignment.status -> pending for any task-linked deletions, in
        # one round trip rather than N.
        task_user_pairs = [
            (a.annotation_task_id, a.created_by_user_id)
            for a in annotations
            if a.annotation_task_id is not None
        ]
        if task_user_pairs:
            task_ids = {tid for tid, _ in task_user_pairs}
            user_ids = {uid for _, uid in task_user_pairs}
            pair_set = set(task_user_pairs)
            assignments = db.scalars(
                select(AnnotationTaskAssignment).where(
                    AnnotationTaskAssignment.task_id.in_(task_ids),
                    AnnotationTaskAssignment.user_id.in_(user_ids),
                )
            ).all()
            for assignment in assignments:
                if (assignment.task_id, assignment.user_id) in pair_set:
                    assignment.status = ANNOTATION_TASK_STATUS_PENDING

        for annotation in annotations:
            db.delete(annotation)

        db.commit()
        return len(annotations)

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.exception("Failed to bulk-delete annotations")
        raise HTTPException(status_code=500, detail="Failed to delete annotations") from e


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


def _fetch_annotations_with_context(
    db: Session, campaign: Campaign
) -> tuple[list[Annotation], dict[UUID, str]]:
    """Fetch all annotations for a campaign with user emails resolved."""
    annotations = (
        db.execute(
            select(Annotation)
            .where(Annotation.campaign_id == campaign.id)
            .options(joinedload(Annotation.geometry), joinedload(Annotation.annotation_task))
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
    return annotations, user_email_map


def _geometry_to_wkt(geom) -> str | None:
    if geom is None:
        return None
    try:
        return to_shape(geom).wkt
    except Exception:
        return str(geom)


# Canonical column order for stacnotator-generated columns. Used by both
# the CSV and GeoJSON exports so the most-relevant identifying columns sit
# at the front of the file. Any column not present in a given record is
# silently skipped.
_STACNOTATOR_COLUMN_ORDER: tuple[str, ...] = (
    "stacnotator_annotation_number",
    "stacnotator_task_id",
    "stacnotator_task_status",
    "stacnotator_label_id",
    "stacnotator_label_name",
    "stacnotator_annotator_count",
    "stacnotator_annotation_id",
    "stacnotator_comment",
    "stacnotator_confidence",
    "stacnotator_is_authoritative",
    "stacnotator_flagged_for_review",
    "stacnotator_flag_comment",
    "stacnotator_created_by_user_email",
    "stacnotator_created_at",
    "stacnotator_geometry_wkt",
)


def _ordered_columns(records: list[dict]) -> list[str]:
    """Compute the final column order for an export.

    Stacnotator-generated columns first (in ``_STACNOTATOR_COLUMN_ORDER``),
    then any raw_source_data / user-provided columns in first-seen order.
    Only columns that actually appear in at least one record are included.
    """
    seen: set[str] = set()
    for record in records:
        seen.update(record.keys())

    ordered: list[str] = []
    for col in _STACNOTATOR_COLUMN_ORDER:
        if col in seen:
            ordered.append(col)
            seen.discard(col)
    # Remaining keys are user-provided (raw_source_data). Preserve first-seen
    # order across the records so the layout is deterministic.
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
    """
    conflicts: list[int] = []
    for task_id, task_anns in grouped.items():
        labeled = [a for a in task_anns if a.label_id is not None]
        if len(labeled) >= 2 and len({a.label_id for a in labeled}) > 1:
            task = task_anns[0].annotation_task
            conflicts.append(task.annotation_number if task else task_id)
    return sorted(conflicts)


def _compute_task_status_for_export(task: AnnotationTask | None) -> str | None:
    """Use the same status rules as the API by going through the schema.

    Avoids duplicating the logic in schemas.py:88 (compute_task_status).
    """
    if task is None:
        return None
    return AnnotationTaskOut.model_validate(task).task_status


def _build_export_record_for_annotation(
    annotation: Annotation,
    campaign: Campaign,
    user_email_map: dict[UUID, str],
    task_status: str | None,
    include_geometry_wkt: bool,
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

    record["stacnotator_annotation_id"] = annotation.id
    record["stacnotator_label_id"] = annotation.label_id
    record["stacnotator_label_name"] = _resolve_label_name(campaign, annotation.label_id)
    record["stacnotator_comment"] = annotation.comment
    record["stacnotator_confidence"] = annotation.confidence
    record["stacnotator_is_authoritative"] = annotation.is_authoritative
    record["stacnotator_flagged_for_review"] = annotation.flagged_for_review
    record["stacnotator_flag_comment"] = annotation.flag_comment
    record["stacnotator_created_by_user_email"] = user_email_map.get(annotation.created_by_user_id)
    record["stacnotator_created_at"] = annotation.created_at
    record["stacnotator_annotator_count"] = task_annotator_count
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

    # NOTE: stacnotator_annotation_id intentionally omitted in merged rows.
    # Use stacnotator_task_id as the join key when exporting with merge on.
    record["stacnotator_label_id"] = agreed_label_id
    record["stacnotator_label_name"] = _resolve_label_name(campaign, agreed_label_id)
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
        task_status = _compute_task_status_for_export(task)
        labeled = [a for a in task_anns if a.label_id is not None]

        if merge_on_agreement and len(labeled) >= 2:
            records.append(
                _build_export_record_merged(
                    task_anns, campaign, user_email_map, task_status, include_geometry_wkt
                )
            )
            canonical_annotations.append(
                next((a for a in labeled if a.is_authoritative), labeled[0])
            )
        else:
            # Nothing to merge (zero or one labeled annotation) or merging is
            # off - emit one row per annotation. Every row for the same task
            # carries the same labeled-annotator count so agreement analyses
            # remain possible without re-grouping by task_id.
            labeled_count = len(labeled)
            for ann in task_anns:
                records.append(
                    _build_export_record_for_annotation(
                        ann,
                        campaign,
                        user_email_map,
                        task_status,
                        include_geometry_wkt,
                        task_annotator_count=labeled_count,
                    )
                )
                canonical_annotations.append(ann)

    # Standalone (open-mode) annotations: never grouped, one row each.
    for ann in standalone:
        records.append(
            _build_export_record_for_annotation(
                ann, campaign, user_email_map, None, include_geometry_wkt
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

    records, _canonical = _build_annotation_records(
        annotations=annotations,
        campaign=campaign,
        user_email_map=user_email_map,
        merge_on_agreement=merge_on_agreement,
        include_geometry_wkt=True,
    )

    # Build a deterministic column order with stacnotator IDs at the front
    # so the human-readable annotation_number sits in column A. Then fill
    # NaN for any record that's missing one of the columns - merged rows
    # omit stacnotator_annotation_id and per-task raw_source_data keys may
    # differ across rows, so the underlying record dicts are ragged.
    columns = _ordered_columns(records)
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

    records, canonical_annotations = _build_annotation_records(
        annotations=annotations,
        campaign=campaign,
        user_email_map=user_email_map,
        merge_on_agreement=merge_on_agreement,
        include_geometry_wkt=False,
    )

    # Same canonical order as the CSV: annotation_number front-and-centre.
    columns = _ordered_columns(records)

    features = []
    for record, canonical in zip(records, canonical_annotations, strict=True):
        geojson_geometry = None
        if canonical.geometry:
            try:
                geojson_geometry = mapping(to_shape(canonical.geometry.geometry))
            except Exception:
                geojson_geometry = None

        # GeoJSON properties must be JSON-serialisable: coerce datetimes.
        # Build the dict in canonical order so consumers see the same layout
        # as the CSV (Python preserves dict insertion order).
        properties: dict = {}
        for col in columns:
            if col in record:
                value = record[col]
                properties[col] = value.isoformat() if hasattr(value, "isoformat") else value

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

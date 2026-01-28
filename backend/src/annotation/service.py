import io
from typing import Optional, Dict, Any
from uuid import UUID
from datetime import datetime

import pandas as pd
import numpy as np
from fastapi import HTTPException
from geoalchemy2.shape import to_shape
from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from src.annotation.constants import (
    ANNOTATION_TASK_STATUS_DONE,
    ANNOTATION_TASK_STATUS_SKIPPED,
)
from src.annotation.models import Annotation, AnnotationGeometry, AnnotationTaskItem
from src.annotation.schema import AnnotationCreate, AnnotationFromTaskCreate, AnnotationUpdate
from src.auth.models import User
from src.campaigns.models import Campaign

# CSV import configuration
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB
REQUIRED_COLUMNS = {"id", "lat", "lon"}


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
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded")
    except pd.errors.EmptyDataError:
        raise HTTPException(status_code=400, detail="CSV file is empty")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid CSV format")

    # Validate required columns
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV must contain columns: {sorted(REQUIRED_COLUMNS)}",
        )

    # Preserve all data in raw_source_data for export back to csv later
    df["raw_source_data"] = df.apply(lambda r: r.to_dict(), axis=1)
    df = df[list(REQUIRED_COLUMNS) + ["raw_source_data"]].dropna()

    if df.empty:
        raise HTTPException(
            status_code=400,
            detail="No valid rows after removing empty values",
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

    # Validate coordinates
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
        for lon, lat in zip(df["lon"].values, df["lat"].values)
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
            for geometry_id, (_, row) in zip(geometry_ids, df.iterrows())
        ]

        db.execute(insert(AnnotationTaskItem), task_records)
        db.commit()

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Import failed. No geometries or task items were created.",
        )


# ============================================================================
# Annotation Creation
# ============================================================================


def add_annotation_for_task(
    db: Session,
    annotation_task: AnnotationTaskItem,
    annotation_create: AnnotationFromTaskCreate,
    user_id: UUID,
) -> Optional[Annotation]:
    """
    Create or update annotation for a task item and update task status.

    If annotation exists:
    - Delete it if no new label provided and mark task as skipped
    - Update it if new label/comment is provided

    If annotation doesn't exist:
    - Create annotation record if label or comment is provided
    - Update task status to 'done' (with label) or 'skipped' (without label)

    Args:
        db: Database session
        annotation_task: Task item being annotated
        annotation_create: Annotation data from user
        user_id: ID of user creating the annotation
    """
    # Check if annotation already exists for this task
    existing_annotation = db.execute(
        select(Annotation).where(Annotation.annotation_task_item_id == annotation_task.id)
    ).scalar_one_or_none()

    annotation = None

    if existing_annotation:
        # If no new label provided, delete existing annotation and mark as skipped
        if annotation_create.label_id is None:
            db.delete(existing_annotation)
            annotation_task.status = ANNOTATION_TASK_STATUS_SKIPPED
        else:
            # Update existing annotation with new label/comment
            existing_annotation.label_id = annotation_create.label_id
            existing_annotation.comment = annotation_create.comment
            existing_annotation.created_by_user_id = user_id
            annotation_task.status = ANNOTATION_TASK_STATUS_DONE
            annotation = existing_annotation
    else:
        # Create new annotation if label or comment provided
        if annotation_create.label_id is not None or annotation_create.comment is not None:
            annotation = Annotation(
                geometry_id=annotation_task.geometry_id,
                label_id=annotation_create.label_id,
                comment=annotation_create.comment,
                annotation_task_item_id=annotation_task.id,
                campaign_id=annotation_task.campaign_id,
                created_by_user_id=user_id,
            )
            db.add(annotation)

        # Update task status
        annotation_task.status = (
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
            annotation_task_item_id=None,  # Standalone annotation
        )
        db.add(annotation)
        db.commit()
        db.refresh(annotation)

        return annotation

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to create annotation: {str(e)}")


def update_annotation(
    db: Session,
    annotation_id: int,
    annotation_update: AnnotationUpdate,
    user_id: UUID,
) -> Annotation:
    """
    Update an existing annotation.

    Updates label, comment, and/or geometry. If geometry is updated,
    creates a new geometry record and updates the reference.

    Args:
        db: Database session
        annotation_id: ID of annotation to update
        annotation_update: Updated annotation data
        user_id: ID of user updating the annotation

    Returns:
        Updated annotation record

    Raises:
        HTTPException: If annotation not found or update fails
    """
    # Get existing annotation
    annotation = db.execute(
        select(Annotation).where(Annotation.id == annotation_id)
    ).scalar_one_or_none()

    if annotation is None:
        raise HTTPException(status_code=404, detail="Annotation not found")

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

        # Update user who last modified
        annotation.created_by_user_id = user_id

        db.commit()
        db.refresh(annotation)

        return annotation

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to update annotation: {str(e)}")


# ============================================================================
# Annotation Retrieval
# ============================================================================


def get_annotations_for_campaign(
    db: Session,
    campaign_id: int,
) -> list[Annotation]:
    """
    Retrieve all annotations for a specific campaign.

    Returns both task-based and standalone annotations for the given campaign.

    Args:
        db: Database session
        campaign_id: ID of campaign to retrieve annotations for

    Returns:
        List of all annotation records for the campaign
    """
    annotations = (
        db.execute(select(Annotation).where(Annotation.campaign_id == campaign_id)).scalars().all()
    )

    return list(annotations)


def delete_annotation(
    db: Session,
    annotation_id: int,
    campaign_id: int,
) -> None:
    """
    Delete a specific annotation from a campaign.

    If the annotation is linked to a task item, the task status is updated
    to 'pending' to allow re-annotation.

    Args:
        db: Database session
        annotation_id: ID of annotation to delete
        campaign_id: ID of campaign (used for validation)

    Raises:
        HTTPException: If annotation not found or doesn't belong to campaign
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

    try:
        # If linked to a task, reset task status to pending
        if annotation.annotation_task_item_id is not None:
            task = db.execute(
                select(AnnotationTaskItem).where(
                    AnnotationTaskItem.id == annotation.annotation_task_item_id
                )
            ).scalar_one_or_none()

            if task:
                task.status = "pending"
                db.add(task)  # Explicitly add to session to ensure update is tracked

        # Delete the annotation
        db.delete(annotation)
        db.commit()

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete annotation: {str(e)}")


# ============================================================================
# Data Export
# ============================================================================


def build_annotations_export(db: Session, campaign: Campaign) -> pd.DataFrame:
    """
    Build comprehensive export of all annotations and tasks for a campaign.

    Args:
        db: Database session
        campaign: Campaign to export data for

    Returns:
        DataFrame with all annotation and task data
    """

    def convert_geometry_to_wkt(geom):
        """Convert GeoAlchemy2 geometry to WKT string."""
        if geom is None:
            return None
        try:
            return to_shape(geom).wkt
        except Exception:
            return str(geom)

    def get_label_name(label_id):
        """Resolve label ID to label name from campaign settings."""
        if label_id is None:
            return None
        labels = campaign.settings.labels if campaign.settings else {}
        label_id_str = str(label_id)
        if label_id_str in labels:
            label_data = labels[label_id_str]
            return label_data.get("name") if isinstance(label_data, dict) else label_data
        return None

    def get_user_email(user_id):
        """Resolve user ID to email address."""
        if user_id is None:
            return None
        user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
        return user.email if user else None

    # Query all annotation tasks
    task_items = (
        db.execute(select(AnnotationTaskItem).where(AnnotationTaskItem.campaign_id == campaign.id))
        .scalars()
        .all()
    )

    export_records = []

    # Process task items (with or without annotations)
    for task in task_items:
        # Start with raw source data
        record = task.raw_source_data.copy() if task.raw_source_data else {}

        # Add task metadata
        record["annotation_id"] = task.id
        record["annotation_number"] = task.annotation_number
        record["task_status"] = task.status
        record["assigned_user_email"] = get_user_email(task.assigned_user_id)
        record["geometry_wkt"] = (
            convert_geometry_to_wkt(task.geometry.geometry) if task.geometry else None
        )

        # Add annotation data if exists
        if task.annotation:
            record["annotation_label_id"] = task.annotation.label_id
            record["annotation_label_name"] = get_label_name(task.annotation.label_id)
            record["annotation_comment"] = task.annotation.comment
            record["annotation_created_by_user_email"] = get_user_email(
                task.annotation.created_by_user_id
            )
            record["annotation_created_at"] = task.annotation.created_at
        else:
            # Null annotation fields for unannotated tasks
            record["annotation_label_id"] = None
            record["annotation_label_name"] = None
            record["annotation_comment"] = None
            record["annotation_created_by_user_email"] = None
            record["annotation_created_at"] = None

        export_records.append(record)

    # Query standalone annotations (not linked to tasks)
    standalone_annotations = (
        db.execute(
            select(Annotation).where(
                Annotation.campaign_id == campaign.id,
                Annotation.annotation_task_item_id.is_(None),
            )
        )
        .scalars()
        .all()
    )

    # Process standalone annotations
    for annotation in standalone_annotations:
        record = {
            # Null task fields
            "annotation_id": None,
            "annotation_number": None,
            "task_status": None,
            "assigned_user_email": None,
            "geometry_wkt": (
                convert_geometry_to_wkt(annotation.geometry.geometry)
                if annotation.geometry
                else None
            ),
            # Annotation fields
            "annotation_label_id": annotation.label_id,
            "annotation_label_name": get_label_name(annotation.label_id),
            "annotation_comment": annotation.comment,
            "annotation_created_by_user_email": get_user_email(annotation.created_by_user_id),
            "annotation_created_at": annotation.created_at,
        }
        export_records.append(record)

    return pd.DataFrame(export_records)
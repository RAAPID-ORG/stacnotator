from datetime import datetime
from typing import Literal
from uuid import UUID

from geoalchemy2.shape import to_shape
from pydantic import BaseModel, field_validator, model_validator

from src.annotation.constants import (
    ANNOTATION_TASK_STATUS_SKIPPED,
    TASK_STATUS_CONFLICTING,
    TASK_STATUS_DONE,
    TASK_STATUS_PARTIAL,
    TASK_STATUS_PENDING,
    TASK_STATUS_SKIPPED,
)


class GeometryOut(BaseModel):
    id: int
    geometry: str

    @field_validator("geometry", mode="before")
    @classmethod
    def convert_geometry(cls, v):
        """Convert GeoAlchemy2 Geometry objects to WKT representation."""
        if v is None:
            return None
        return to_shape(v).wkt

    class Config:
        from_attributes = True


class AnnotationFromTaskOut(BaseModel):
    id: int
    label_id: int | None
    comment: str | None
    created_by_user_id: UUID
    created_at: datetime
    confidence: int | None
    is_authoritative: bool

    class Config:
        from_attributes = True


class AnnotationOut(AnnotationFromTaskOut):
    geometry: GeometryOut

    class Config:
        from_attributes = True


class AnnotationTaskAssignmentOut(BaseModel):
    user_id: UUID
    status: str
    user_email: str | None = None
    user_display_name: str | None = None

    @model_validator(mode="before")
    @classmethod
    def populate_user_info(cls, data):
        """Populate user_email and user_display_name from the user relationship."""
        if hasattr(data, "user") and data.user is not None:
            user = data.user
            result = {
                "user_id": data.user_id,
                "status": data.status,
                "user_email": user.email,
                "user_display_name": user.display_name,
            }
            return result
        return data

    class Config:
        from_attributes = True


class AnnotationTaskOut(BaseModel):
    id: int
    annotation_number: int
    task_status: str = TASK_STATUS_PENDING
    geometry: GeometryOut
    assignments: list[AnnotationTaskAssignmentOut] | None
    annotations: list[AnnotationFromTaskOut]

    @model_validator(mode="before")
    @classmethod
    def compute_task_status(cls, data):
        """
        Compute task_status on the fly from assignments and annotations.

        - pending:     No non-skipped user has a labeled annotation
        - skipped:     ALL assigned users skipped
        - partial:     Some (not all) non-skipped users have labeled annotations
        - done:        All non-skipped users labeled with the SAME label
        - conflicting: All non-skipped users labeled with DIFFERENT labels
        """
        # Handle both ORM objects and dicts
        if hasattr(data, "assignments"):
            assignments = data.assignments or []
            annotations = data.annotations or []
            # Access ORM attributes
            assignment_list = [{"user_id": a.user_id, "status": a.status} for a in assignments]
            annotation_list = [
                {"label_id": a.label_id, "created_by_user_id": a.created_by_user_id}
                for a in annotations
            ]
        elif isinstance(data, dict):
            assignment_list = [
                ({"user_id": a.user_id, "status": a.status} if hasattr(a, "user_id") else a)
                for a in (data.get("assignments") or [])
            ]
            annotation_list = [
                (
                    {
                        "label_id": a.label_id,
                        "created_by_user_id": a.created_by_user_id,
                    }
                    if hasattr(a, "label_id")
                    else a
                )
                for a in (data.get("annotations") or [])
            ]
        else:
            return data

        labeled = [a for a in annotation_list if a.get("label_id") is not None]

        if not assignment_list:
            status = TASK_STATUS_DONE if labeled else TASK_STATUS_PENDING
        else:
            all_skipped = all(
                a.get("status") == ANNOTATION_TASK_STATUS_SKIPPED for a in assignment_list
            )
            if all_skipped:
                status = TASK_STATUS_SKIPPED
            else:
                non_skipped_ids = {
                    a["user_id"]
                    for a in assignment_list
                    if a.get("status") != ANNOTATION_TASK_STATUS_SKIPPED
                }
                completed_ids = {
                    a["created_by_user_id"]
                    for a in labeled
                    if a["created_by_user_id"] in non_skipped_ids
                }

                if not completed_ids:
                    status = TASK_STATUS_PENDING
                elif len(completed_ids) < len(non_skipped_ids):
                    status = TASK_STATUS_PARTIAL
                else:
                    labels = {
                        a["label_id"] for a in labeled if a["created_by_user_id"] in non_skipped_ids
                    }
                    status = TASK_STATUS_DONE if len(labels) == 1 else TASK_STATUS_CONFLICTING

        # Set the computed status on the data
        if hasattr(data, "__dict__"):
            # ORM model — inject into the dict that pydantic will use
            data.__dict__["task_status"] = status
        elif isinstance(data, dict):
            data["task_status"] = status

        return data

    class Config:
        from_attributes = True


class AnnotationTaskListOut(BaseModel):
    campaign_id: int
    tasks: list[AnnotationTaskOut]


class AnnotationsListOut(BaseModel):
    campaign_id: int
    annotations: list[AnnotationOut]


class AnnotationFromTaskCreate(BaseModel):
    label_id: int | None
    comment: str | None
    confidence: int | None
    is_authoritative: bool | None = None


class AnnotationTaskSubmitResponse(BaseModel):
    """Response from submitting/skipping an annotation task."""

    annotation: AnnotationFromTaskOut | None
    task_status: str
    assignment_status: str

    class Config:
        from_attributes = True


class AnnotationCreate(BaseModel):
    label_id: int
    comment: str | None
    geometry_wkt: str  # Geometry in WKT format
    confidence: str | None


class AnnotationUpdate(BaseModel):
    label_id: int | None
    comment: str | None
    geometry_wkt: str | None  # Geometry in WKT format
    is_authoritative: bool | None


class ValidateLabelSubmissionsResponse(BaseModel):
    """Result of a KNN-based label validation check.

    status tells the caller why a certain result was returned:

    - "ok" - enough data, label agrees with neighbours
    - "mismatch" - enough data, label disagrees with neighbours
    - "skipped_no_embedding" - task has no embedding vector
    - "skipped_insufficient_data" - not enough labeled neighbours yet
    - "disabled" - validation is disabled (no embedding year configured)
    """

    status: Literal[
        "ok",
        "mismatch",
        "skipped_no_embedding",
        "skipped_insufficient_data",
        "disabled",
    ]
    agrees: bool | None = None

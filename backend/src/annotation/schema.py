from datetime import datetime
from typing import Literal
from uuid import UUID

from geoalchemy2.shape import to_shape
from pydantic import BaseModel, field_validator, model_validator


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
    geometry: GeometryOut
    assignments: list[AnnotationTaskAssignmentOut] | None
    annotations: list[AnnotationFromTaskOut]

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

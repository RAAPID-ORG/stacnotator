from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, field_validator
from datetime import datetime
from geoalchemy2.shape import to_shape
from src.auth.schemas import UserOut


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
    label_id: Optional[int]
    comment: Optional[str]
    created_by_user_id: UUID
    created_at: datetime
    confidence: Optional[int]
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
    user_email: Optional[str] = None
    user_display_name: Optional[str] = None

    class Config:
        from_attributes = True


class AnnotationTaskOut(BaseModel):
    id: int
    annotation_number: int
    geometry: GeometryOut
    assignments: Optional[List[AnnotationTaskAssignmentOut]]
    annotations: List[AnnotationFromTaskOut]

    class Config:
        from_attributes = True


class AnnotationTaskListOut(BaseModel):
    campaign_id: int
    tasks: list[AnnotationTaskOut]


class AnnotationsListOut(BaseModel):
    campaign_id: int
    annotations: List[AnnotationOut]


class AnnotationFromTaskCreate(BaseModel):
    label_id: Optional[int]
    comment: Optional[str]
    confidence: Optional[int]
    is_authoritative: Optional[bool] = None


class AnnotationCreate(BaseModel):
    label_id: int
    comment: Optional[str]
    geometry_wkt: str  # Geometry in WKT format
    confidence: Optional[str]


class AnnotationUpdate(BaseModel):
    label_id: Optional[int]
    comment: Optional[str]
    geometry_wkt: Optional[str]  # Geometry in WKT format
    is_authoritative: Optional[bool]

class ValidateLabelSubmissionsResponse(BaseModel):
    agrees: bool
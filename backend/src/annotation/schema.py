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
    label_id: int
    comment: Optional[str]
    created_by_user_id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


class AnnotationOut(AnnotationFromTaskOut):
    geometry: GeometryOut

    class Config:
        from_attributes = True


class AnnotationTaskItemOut(BaseModel):
    id: int
    annotation_number: int
    geometry: GeometryOut
    status: str
    assigned_user: Optional[UserOut]
    annotation: Optional[AnnotationFromTaskOut]

    class Config:
        from_attributes = True


class AnnotationTaskListOut(BaseModel):
    campaign_id: int
    tasks: list[AnnotationTaskItemOut]


class AnnotationsListOut(BaseModel):
    campaign_id: int
    annotations: List[AnnotationOut]


class AnnotationFromTaskCreate(BaseModel):
    label_id: Optional[int]
    comment: Optional[str]


class AnnotationCreate(BaseModel):
    label_id: int
    comment: Optional[str]
    geometry_wkt: str  # Geometry in WKT format


class AnnotationUpdate(BaseModel):
    label_id: Optional[int]
    comment: Optional[str]
    geometry_wkt: Optional[str]  # Geometry in WKT format


class AISegmentationRequest(BaseModel):
    start_date: datetime
    end_date: datetime
    longitude: float
    latitude: float
    roi_size: int = 512
    max_cloud_cover: float = 20.0
    label_id: Optional[int] = None
    comment: Optional[str] = None


class PolygonOut(BaseModel):
    polygon_wkt: str  # WKT polygon with proper georeferencing
    score: float
    
    
class AISegmentationResponse(BaseModel):
    annotation_id: Optional[int] = None  # May be None if label_id not provided
    polygons: List[PolygonOut]  # List of polygon results with scores
    transform: Optional[dict] = None  # Affine transform information
    crs: Optional[str] = None  # Coordinate reference system
    bounds: Optional[List[float]] = None  # Bounding box [west, south, east, north]

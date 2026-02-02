from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, field_validator, computed_field
from src.auth.schemas import UserOut
from src.imagery.schemas import CanvasLayoutOut, ImageryCreate, ImageryOut, ImageryWithWindowsOut
from src.timeseries.schemas import TimeSeriesCreate, TimeSeriesOut


# ============================================================================
# Campaign Related Schemas
# ============================================================================
class LabelBase(BaseModel):
    """
    A label that can be assigned to an annotation within a campaign.
    """

    id: int  # ID that is used for annotation
    name: str


class CampaignSettingsOut(BaseModel):
    labels: List[LabelBase]
    bbox_west: float
    bbox_south: float
    bbox_east: float
    bbox_north: float

    @field_validator("labels", mode="before")
    @classmethod
    def convert_labels(cls, v):
        """
        Convert JSONB dict from DB to -> List[Label]
        {"1": "Forest"} -> [{id: 1, name: "Forest"}]
        """
        if isinstance(v, dict):
            return [LabelBase(id=int(k), name=str(vv)) for k, vv in v.items()]
        return v

    class Config:
        from_attributes = True


class CampaignSettingsCreate(BaseModel):
    labels: List[LabelBase]
    bbox_west: float
    bbox_south: float
    bbox_east: float
    bbox_north: float

    # Helper to convert labels to dict in DB
    def to_orm(self) -> dict:
        return {
            "labels": {str(label.id): label.name for label in self.labels},
            "bbox_west": self.bbox_west,
            "bbox_south": self.bbox_south,
            "bbox_east": self.bbox_east,
            "bbox_north": self.bbox_north,
        }


class CampaignOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    mode: str

    settings: CampaignSettingsOut
    imagery: list[ImageryOut]
    time_series: list[TimeSeriesOut]

    class Config:
        from_attributes = True


class CampaignCreate(BaseModel):
    name: str
    mode: str
    settings: CampaignSettingsCreate
    imagery_configs: Optional[list[ImageryCreate]]
    timeseries_configs: Optional[list[TimeSeriesCreate]]


class CampaignListItemOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    is_admin: bool = False
    is_member: bool = False

    class Config:
        from_attributes = True


class CampaignOutWithImageryWindows(CampaignOut):
    imagery: List[ImageryWithWindowsOut]

    @computed_field
    @property
    def default_main_canvas_layout(self) -> Optional[CanvasLayoutOut]:
        """Get the default main canvas layout for this campaign."""
        if hasattr(self, "_default_main_canvas_layout"):
            return self._default_main_canvas_layout
        return None

    @computed_field
    @property
    def personal_main_canvas_layout(self) -> Optional[CanvasLayoutOut]:
        """Get the personal main canvas layout for the current user."""
        if hasattr(self, "_personal_main_canvas_layout"):
            return self._personal_main_canvas_layout
        return None

    @classmethod
    def from_orm(cls, obj, user_id: Optional[UUID] = None):
        """Override from_orm to extract default and personal layouts from canvas_layouts."""

        # Find the default main canvas layout (imagery_id IS NULL, is_default=True)
        default_layout = None
        personal_layout = None

        if hasattr(obj, "canvas_layouts"):
            for layout in obj.canvas_layouts:
                if layout.imagery_id is None:  # Main campaign layout
                    if layout.is_default and layout.user_id is None:
                        default_layout = CanvasLayoutOut.model_validate(layout)
                    elif user_id and layout.user_id == user_id:
                        personal_layout = CanvasLayoutOut.model_validate(layout)

        # Convert imagery objects manually to get their default and personal layouts
        imagery_list = []
        if hasattr(obj, "imagery"):
            for img in obj.imagery:
                imagery_list.append(ImageryWithWindowsOut.from_orm(img, user_id=user_id))

        # Build a dict from the ORM object for base fields
        base_data = {
            "id": obj.id,
            "name": obj.name,
            "created_at": obj.created_at,
            "mode": obj.mode,
            "settings": obj.settings,
            "time_series": obj.time_series,
            "imagery": imagery_list,
        }

        # Create instance with converted data
        instance = cls.model_validate(base_data)

        # Store the layouts
        instance._default_main_canvas_layout = default_layout
        instance._personal_main_canvas_layout = personal_layout
        return instance


class CampaignUserOut(BaseModel):
    user: UserOut
    is_admin: bool
    is_authorative_reviewer: bool

    class Config:
        from_attributes = True


# ============================================================================
# Specific Request / Response Schemas
# ============================================================================


class AssignUsersToCampaignRequest(BaseModel):
    user_ids: List[UUID]


class CampaignsListResponse(BaseModel):
    items: list[CampaignListItemOut]


class CampaignUsersResponse(BaseModel):
    campaign_id: int
    users: List[CampaignUserOut]


class UpdateCampaignNameRequest(BaseModel):
    name: str


class UpdateCampaignBBoxRequest(BaseModel):
    bbox_west: float
    bbox_south: float
    bbox_east: float
    bbox_north: float


class AssignTasksToUsersRequest(BaseModel):
    """
    Request to assign multiple tasks to users.
    Maps task IDs to list of user IDs (supports multiple reviewers per task).
    """

    task_assignments: dict[int, list[UUID]]


class AssignReviewersRequest(BaseModel):
    """
    Request to assign reviewers to tasks based on different patterns.
    """
    
    pattern: str  # 'percentage', 'manual', 'fixed'
    
    # For 'percentage' pattern
    percentage: Optional[float] = None  # Percentage of tasks to review (0-100)
    num_reviewers: Optional[int] = None  # Number of reviewers per task
    reviewer_ids: Optional[list[UUID]] = None  # Pool of reviewers to choose from
    
    # For 'manual' pattern
    manual_assignments: Optional[dict[int, list[UUID]]] = None  # task_id -> list of user_ids
    
    # For 'fixed' pattern
    num_tasks: Optional[int] = None  # Number of tasks to assign reviewers to
    fixed_num_reviewers: Optional[int] = None  # Fixed number of reviewers per task


class DeleteAnnotationTasksRequest(BaseModel):
    """
    Request to delete multiple annotation tasks.
    """

    task_ids: list[int]


# ============================================================================
# Campaign Statistics Schemas
# ============================================================================


class AnnotatorInfo(BaseModel):
    """Basic information about an annotator."""
    user_id: str
    user_email: str
    user_display_name: Optional[str]
    total_annotations: int
    label_distribution: dict[str, int]  # label name -> count


class PairwiseAgreement(BaseModel):
    """Agreement percentage between two annotators."""
    annotator1_id: str
    annotator2_id: str
    agreement_percentage: Optional[float]  # percentage (0-100), None if no shared tasks
    shared_tasks: int  # number of tasks both annotators worked on


class CampaignStatistics(BaseModel):
    """Statistics for a campaign focused on inter-annotator agreement."""
    campaign_id: int
    campaign_name: str
    total_annotations: int
    tasks_with_multiple_annotations: int  # Number of tasks used for agreement calculation
    overall_label_distribution: dict[str, int]  # Overall label distribution
    krippendorff_alpha: Optional[float]  # Overall inter-annotator agreement (0-1)
    annotators: list[AnnotatorInfo]
    pairwise_agreements: list[PairwiseAgreement]

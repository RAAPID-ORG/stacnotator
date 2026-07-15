from datetime import datetime
from typing import Literal
from uuid import UUID

from geoalchemy2.shape import to_shape
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from src.annotation.constants import (
    ANNOTATION_TASK_STATUS_SKIPPED,
    TASK_STATUS_CONFLICTING,
    TASK_STATUS_DONE,
    TASK_STATUS_PARTIAL,
    TASK_STATUS_PENDING,
    TASK_STATUS_SKIPPED,
)


class DateRangeValue(BaseModel):
    start: str
    end: str


FormValue = int | float | str | list[int] | DateRangeValue


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

    model_config = ConfigDict(from_attributes=True)


class AnnotationFromTaskOut(BaseModel):
    id: int
    label_id: int | None
    comment: str | None
    created_by_user_id: UUID
    created_by_user_email: str | None = None
    created_by_user_display_name: str | None = None
    created_at: datetime
    updated_at: datetime
    confidence: int | None
    is_authoritative: bool
    flagged_for_review: bool
    flag_comment: str | None
    imagery_slice_id: int | None = None
    imagery_source_name: str | None = None
    imagery_start_date: str | None = None
    imagery_end_date: str | None = None
    form_values: dict[str, FormValue] | None = None
    # Computed per request from the labelling policy (campaigns/policy.py),
    # never stored. None for standalone annotations.
    counts_toward_completion: bool | None = None

    @model_validator(mode="before")
    @classmethod
    def populate_creator_info(cls, data):
        """Surface email / display_name from the creator relationship so the
        review pages can render the annotator even when the user is no longer
        a campaign member or task assignee."""
        if hasattr(data, "__dict__") and getattr(data, "creator", None) is not None:
            data.__dict__["created_by_user_email"] = data.creator.email
            data.__dict__["created_by_user_display_name"] = data.creator.display_name
        return data

    model_config = ConfigDict(from_attributes=True)


class AnnotationOut(AnnotationFromTaskOut):
    geometry: GeometryOut

    model_config = ConfigDict(from_attributes=True)


class AnnotationTaskAssignmentOut(BaseModel):
    user_id: UUID
    status: Literal["pending", "done", "skipped"]
    is_review: bool = False
    claimed_at: datetime | None = None
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
                "is_review": data.is_review,
                "claimed_at": data.claimed_at,
                "user_email": user.email,
                "user_display_name": user.display_name,
            }
            return result
        return data

    model_config = ConfigDict(from_attributes=True)


def compute_task_status_value(assignment_list: list[dict], annotation_list: list[dict]) -> str:
    """Derive a task's status from its assignments and annotations.

    Only counting annotations (`counts_toward_completion` is not False;
    missing means counting) drive done/partial/conflicting. Review
    assignments set a required review-label count, satisfiable by a counting
    label from any non-primary user, not just the assigned reviewer(s).
    """
    counting = [a for a in annotation_list if a.get("counts_toward_completion") is not False]
    labeled = [a for a in counting if a.get("label_id") is not None]
    has_authoritative_label = any(a.get("is_authoritative") for a in labeled)

    if has_authoritative_label:
        # An authoritative reviewer's label resolves the task on its own,
        # overriding assignment-based aggregation.
        return TASK_STATUS_DONE
    if not assignment_list:
        # No assignment table entries - treat any label as done.
        return TASK_STATUS_DONE if labeled else TASK_STATUS_PENDING

    all_skipped = all(a.get("status") == ANNOTATION_TASK_STATUS_SKIPPED for a in assignment_list)
    if all_skipped:
        return TASK_STATUS_SKIPPED

    num_reviewers_required = sum(1 for a in assignment_list if a.get("is_review"))
    if num_reviewers_required:
        primary_ids = {a["user_id"] for a in assignment_list if not a.get("is_review")}
        primary_labeled = {
            a["created_by_user_id"]: a["label_id"]
            for a in labeled
            if a["created_by_user_id"] in primary_ids
        }
        # Anyone else with a counting label fills a review slot, whether or
        # not they hold an assignment row on this task.
        review_labeled = {
            a["created_by_user_id"]: a["label_id"]
            for a in labeled
            if a["created_by_user_id"] not in primary_ids
        }
        if not primary_labeled and not review_labeled:
            return TASK_STATUS_PENDING
        if primary_labeled.keys() != primary_ids or len(review_labeled) < num_reviewers_required:
            return TASK_STATUS_PARTIAL
        labels = set(primary_labeled.values()) | set(review_labeled.values())
        return TASK_STATUS_DONE if len(labels) == 1 else TASK_STATUS_CONFLICTING

    all_assigned_ids = {a["user_id"] for a in assignment_list}
    labeled_ids = {
        a["created_by_user_id"] for a in labeled if a["created_by_user_id"] in all_assigned_ids
    }
    if not labeled_ids:
        # Nobody labeled yet; some may have skipped or still be pending.
        return TASK_STATUS_PENDING
    if labeled_ids != all_assigned_ids:
        # Some assignees labeled, others didn't (skip or not-yet-acted).
        # Not enough information to call this done or conflicting.
        return TASK_STATUS_PARTIAL
    labels = {a["label_id"] for a in labeled if a["created_by_user_id"] in labeled_ids}
    return TASK_STATUS_DONE if len(labels) == 1 else TASK_STATUS_CONFLICTING


class AnnotationTaskOut(BaseModel):
    id: int
    annotation_number: int
    task_set_id: int
    task_status: Literal["pending", "partial", "done", "skipped", "conflicting"] = (
        TASK_STATUS_PENDING
    )
    geometry: GeometryOut
    assignments: list[AnnotationTaskAssignmentOut] | None
    annotations: list[AnnotationFromTaskOut]
    # Whether a satellite embedding vector exists for this task. Populated by
    # the task list/fetch query (extra attribute on the ORM instance). Used by
    # the frontend to show why KNN label validation is unavailable on a task.
    has_embedding: bool = False

    @model_validator(mode="before")
    @classmethod
    def compute_task_status(cls, data):
        """
        Compute task_status on the fly from assignments and annotations.

        A skipped assignee is treated as "did not contribute a label", so a
        task is only done/conflicting when *every* assignee actually provided
        a label. One skip next to one label is partial, not done.

        - pending:     No assignee has labeled yet (and not all skipped)
        - skipped:     ALL assigned users skipped
        - partial:     At least one label, but some assignees still haven't
                       labeled (they either skipped or haven't acted yet)
        - done:        Every assignee labeled and all labels match, OR an
                       authoritative reviewer has submitted a label that
                       overrides the assignment-based aggregation.
        - conflicting: Every assignee labeled and labels disagree
        """
        # Handle both ORM objects and dicts
        if hasattr(data, "assignments"):
            assignments = data.assignments or []
            annotations = data.annotations or []
            # Access ORM attributes
            assignment_list = [
                {"user_id": a.user_id, "status": a.status, "is_review": a.is_review}
                for a in assignments
            ]
            annotation_list = [
                {
                    "label_id": a.label_id,
                    "created_by_user_id": a.created_by_user_id,
                    "is_authoritative": a.is_authoritative,
                    "counts_toward_completion": getattr(a, "counts_toward_completion", None),
                }
                for a in annotations
            ]
        elif isinstance(data, dict):
            assignment_list = [
                (
                    {
                        "user_id": a.user_id,
                        "status": a.status,
                        "is_review": getattr(a, "is_review", False),
                    }
                    if hasattr(a, "user_id")
                    else a
                )
                for a in (data.get("assignments") or [])
            ]
            annotation_list = [
                (
                    {
                        "label_id": a.label_id,
                        "created_by_user_id": a.created_by_user_id,
                        "is_authoritative": getattr(a, "is_authoritative", False),
                        "counts_toward_completion": getattr(a, "counts_toward_completion", None),
                    }
                    if hasattr(a, "label_id")
                    else a
                )
                for a in (data.get("annotations") or [])
            ]
        else:
            return data

        status = compute_task_status_value(assignment_list, annotation_list)

        # Set the computed status on the data
        if hasattr(data, "__dict__"):
            # ORM model - inject into the dict that pydantic will use
            data.__dict__["task_status"] = status
        elif isinstance(data, dict):
            data["task_status"] = status

        return data

    model_config = ConfigDict(from_attributes=True)


class AnnotationTaskListOut(BaseModel):
    campaign_id: int
    tasks: list[AnnotationTaskOut]


class AnnotationFromTaskCreate(BaseModel):
    label_id: int | None
    comment: str | None = Field(max_length=5000)
    confidence: int | None = Field(default=None, ge=0, le=10)
    is_authoritative: bool | None = None
    flagged_for_review: bool | None = None
    flag_comment: str | None = Field(default=None, max_length=5000)
    form_values: dict[str, FormValue] | None = None


class AnnotationTaskSubmitResponse(BaseModel):
    """Response from submitting/skipping an annotation task."""

    annotation: AnnotationFromTaskOut | None
    task_status: str
    assignment_status: str

    model_config = ConfigDict(from_attributes=True)


class ClaimTaskResponse(BaseModel):
    """Response from soft-claiming a task."""

    task_id: int
    claimed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class AnnotationCreate(BaseModel):
    label_id: int
    comment: str | None = Field(max_length=5000)
    geometry_wkt: str  # Geometry in WKT format
    confidence: int | None = Field(default=None, ge=0, le=10)
    flagged_for_review: bool | None = None
    flag_comment: str | None = Field(default=None, max_length=5000)
    imagery_slice_id: int | None = None
    imagery_source_name: str | None = None
    imagery_start_date: str | None = None
    imagery_end_date: str | None = None
    form_values: dict[str, FormValue] | None = None


class AnnotationsExtentOut(BaseModel):
    """Bounding box of a campaign's annotations as [minx, miny, maxx, maxy] in
    EPSG:4326, or null when the campaign has no annotations."""

    bbox: tuple[float, float, float, float] | None = None


class AnnotationDensityCell(BaseModel):
    """One aggregated grid cell for the minimap distribution overview: the
    cell centre (EPSG:4326) and how many annotation centroids fall in it.

    Lets the minimap show where annotations are as lightweight indicators
    without shipping every geometry - the count drives shading/size."""

    lon: float
    lat: float
    count: int


class BatchDeleteAnnotationsRequest(BaseModel):
    annotation_ids: list[int]


class BatchDeleteAnnotationsResponse(BaseModel):
    deleted_count: int


class BatchCreateAnnotationsRequest(BaseModel):
    # Capped to keep a single request/transaction bounded; the frontend labels
    # vector features in one call rather than one request per feature.
    annotations: list[AnnotationCreate] = Field(max_length=5000)


class BatchCreateAnnotationsResponse(BaseModel):
    created_count: int


class AnnotationUpdate(BaseModel):
    label_id: int | None
    comment: str | None = Field(max_length=5000)
    geometry_wkt: str | None  # Geometry in WKT format
    confidence: int | None = Field(default=None, ge=0, le=10)
    is_authoritative: bool | None
    flagged_for_review: bool | None = None
    flag_comment: str | None = Field(default=None, max_length=5000)
    imagery_slice_id: int | None = None
    imagery_source_name: str | None = None
    imagery_start_date: str | None = None
    imagery_end_date: str | None = None
    form_values: dict[str, FormValue] | None = None


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


class KnnValidationStatusOut(BaseModel):
    """Summary of what the KNN label validator has available.

    Used by the frontend to explain to annotators why validation may be
    unavailable for a given task/label (e.g. not enough prior labels yet).
    """

    # True when an embedding year is set on the campaign. If false, nothing
    # else in this response is meaningful.
    enabled: bool
    # Minimum number of embedded+labeled neighbours required for a specific
    # label before validation runs for that label (k in kNN).
    required_per_label: int
    # Minimum total number of embedded+labeled tasks required in the campaign.
    required_total: int
    # Current total of distinct tasks that have both an embedding and at least
    # one labeled annotation.
    total_labeled_with_embedding: int
    # Per-label count of distinct embedded tasks carrying that label. Key is
    # label_id as a string (JSON object key convention).
    per_label_counts: dict[str, int]

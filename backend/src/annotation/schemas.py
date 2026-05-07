from datetime import datetime
from typing import Literal
from uuid import UUID

from geoalchemy2.shape import to_shape
from pydantic import BaseModel, ConfigDict, field_validator, model_validator

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

    model_config = ConfigDict(from_attributes=True)


class AnnotationTaskOut(BaseModel):
    id: int
    annotation_number: int
    task_status: str = TASK_STATUS_PENDING
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
            assignment_list = [{"user_id": a.user_id, "status": a.status} for a in assignments]
            annotation_list = [
                {
                    "label_id": a.label_id,
                    "created_by_user_id": a.created_by_user_id,
                    "is_authoritative": a.is_authoritative,
                }
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
                        "is_authoritative": getattr(a, "is_authoritative", False),
                    }
                    if hasattr(a, "label_id")
                    else a
                )
                for a in (data.get("annotations") or [])
            ]
        else:
            return data

        labeled = [a for a in annotation_list if a.get("label_id") is not None]
        has_authoritative_label = any(a.get("is_authoritative") for a in labeled)

        if has_authoritative_label:
            # An authoritative reviewer's label resolves the task on its own,
            # overriding assignment-based aggregation.
            status = TASK_STATUS_DONE
        elif not assignment_list:
            # No assignment table entries - treat any label as done.
            status = TASK_STATUS_DONE if labeled else TASK_STATUS_PENDING
        else:
            all_assigned_ids = {a["user_id"] for a in assignment_list}
            all_skipped = all(
                a.get("status") == ANNOTATION_TASK_STATUS_SKIPPED for a in assignment_list
            )
            labeled_ids = {
                a["created_by_user_id"]
                for a in labeled
                if a["created_by_user_id"] in all_assigned_ids
            }

            if all_skipped:
                status = TASK_STATUS_SKIPPED
            elif not labeled_ids:
                # Nobody labeled yet; some may have skipped or still be pending.
                status = TASK_STATUS_PENDING
            elif labeled_ids != all_assigned_ids:
                # Some assignees labeled, others didn't (skip or not-yet-acted).
                # Not enough information to call this done or conflicting.
                status = TASK_STATUS_PARTIAL
            else:
                labels = {a["label_id"] for a in labeled if a["created_by_user_id"] in labeled_ids}
                status = TASK_STATUS_DONE if len(labels) == 1 else TASK_STATUS_CONFLICTING

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


class AnnotationsListOut(BaseModel):
    campaign_id: int
    annotations: list[AnnotationOut]


class AnnotationFromTaskCreate(BaseModel):
    label_id: int | None
    comment: str | None
    confidence: int | None
    is_authoritative: bool | None = None
    flagged_for_review: bool | None = None
    flag_comment: str | None = None


class AnnotationTaskSubmitResponse(BaseModel):
    """Response from submitting/skipping an annotation task."""

    annotation: AnnotationFromTaskOut | None
    task_status: str
    assignment_status: str

    model_config = ConfigDict(from_attributes=True)


class AnnotationCreate(BaseModel):
    label_id: int
    comment: str | None
    geometry_wkt: str  # Geometry in WKT format
    confidence: int | None
    flagged_for_review: bool | None = None
    flag_comment: str | None = None


class BatchDeleteAnnotationsRequest(BaseModel):
    annotation_ids: list[int]


class BatchDeleteAnnotationsResponse(BaseModel):
    deleted_count: int


class AnnotationUpdate(BaseModel):
    label_id: int | None
    comment: str | None
    geometry_wkt: str | None  # Geometry in WKT format
    confidence: int | None = None
    is_authoritative: bool | None
    flagged_for_review: bool | None = None
    flag_comment: str | None = None


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

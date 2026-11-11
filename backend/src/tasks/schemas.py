"""Request and response shapes of task work: tasks with their answers, claims,
assignments, task sets."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)

from src.annotation.constants import AssignmentStatus, TaskOutcome, TaskStatus
from src.annotation.schemas import AnnotationFromTaskOut


class TaskAssignmentOut(BaseModel):
    user_id: UUID
    # Derived from the assignee's answer, never stored.
    status: AssignmentStatus
    is_review: bool = False
    user_email: str | None = None
    user_display_name: str | None = None


class TaskOut(BaseModel):
    id: int
    annotation_number: int
    task_set_id: int
    task_status: TaskStatus
    geometry_wkt: str
    assignments: list[TaskAssignmentOut]
    annotations: list[AnnotationFromTaskOut]
    # The soft claim on this task. Concurrency only: it says who is working on
    # it right now, never who may label it.
    claimed_by_user_id: UUID | None = None
    claimed_at: datetime | None = None
    claimed_by_display_name: str | None = None
    # Whether a satellite embedding vector exists for this task, which KNN label
    # validation needs.
    has_embedding: bool = False
    # Standalone annotations drawn after leaving this task for Explore.
    nearby_annotation_count: int = 0
    # Who has drawn shapes as this draw task's answer.
    drawn_by_user_ids: list[UUID] = []


class TaskListOut(BaseModel):
    campaign_id: int
    tasks: list[TaskOut]


# The task summary is columnar: one array per field, row i of every array in a group
# describing the same item, and people referred to by their position in `users`. A
# campaign can hold tens of thousands of tasks, and per-row objects repeated every key
# and user id - most of what the response weighed.


class TaskSummaryUsers(BaseModel):
    id: list[UUID]
    display_name: list[str]
    # Platform admins only.
    email: list[str | None]


class TaskSummaryTasks(BaseModel):
    id: list[int]
    annotation_number: list[int]
    task_set_id: list[int]
    task_status: list[TaskStatus]
    claimed_by: list[int | None]
    claimed_at: list[datetime | None]
    # The task geometry's centroid, to six decimals.
    lon: list[float]
    lat: list[float]
    nearby_annotation_count: list[int]
    drawn_by: list[list[int]]


class TaskSummaryAssignments(BaseModel):
    task: list[int]
    user: list[int]
    status: list[AssignmentStatus]


class TaskSummaryAnswers(BaseModel):
    """Each task row, without what only one task's view shows (its form values, slice
    notes and imagery): `GET /tasks/details` has those."""

    id: list[int]
    task: list[int]
    user: list[int]
    label_id: list[int | None]
    outcome: list[TaskOutcome]
    confidence: list[int | None]
    flagged_for_review: list[bool]
    active_seconds: list[int | None]
    is_authoritative: list[bool]
    counts_toward_completion: list[bool]
    comment: list[str | None]
    flag_comment: list[str | None]
    # Form fields with a non-empty value, by field id.
    answered_field_ids: list[list[str]]


class TaskSummaryOut(BaseModel):
    campaign_id: int
    # The cursor for the next `since`.
    server_time: datetime
    users: TaskSummaryUsers
    tasks: TaskSummaryTasks
    assignments: TaskSummaryAssignments
    answers: TaskSummaryAnswers


class TaskStatusOut(BaseModel):
    """Where a task and the acting user stand after a write to it."""

    task_status: TaskStatus
    assignment_status: AssignmentStatus

    model_config = ConfigDict(from_attributes=True)


class TaskSubmitResponse(TaskStatusOut):
    """Response from submitting or skipping an annotation task.

    The annotation is always there: a skip is stored with the outcome `skipped`,
    so every submission leaves a record behind.
    """

    annotation: AnnotationFromTaskOut


class ClaimTaskResponse(BaseModel):
    """Response from soft-claiming a task.

    `claimed` false with a holder means somebody else is on it; false without
    one means there was nothing to lease (the task is assigned, or already
    worked). Neither is an error - labelling it anyway stays allowed.
    """

    task_id: int
    claimed: bool
    claimed_at: datetime | None
    holder_user_id: UUID | None = None
    holder_display_name: str | None = None


class ClaimNextResponse(BaseModel):
    """The task the server picked and claimed, or null once the pool is dry."""

    task: TaskOut | None

    model_config = ConfigDict(from_attributes=True)


class TaskDensityCell(BaseModel):
    """One grid cell's worth of tasks sharing a status and a label: where they sit and
    how many there are. The campaign maps draw from these instead of a marker per task,
    so the payload grows with cells rather than with the size of the campaign."""

    lon: float
    lat: float
    task_status: TaskStatus
    label_id: int | None
    count: int


class TaskChangesOut(BaseModel):
    """Tasks that changed since a cursor, re-read whole, and the cursor for the
    next poll. Same clock as :class:`AnnotationChangesOut`."""

    server_time: datetime
    tasks: list[TaskOut]


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


class AssignTasksToUsersRequest(BaseModel):
    """
    Intent to assign annotation tasks to campaign members.

    - "explicit": assign exactly the given task_assignments mapping.
    - "even": split the pool of unassigned, unannotated tasks across user_ids.
    - "fixed_per_user": give each user in user_task_counts that many tasks.
    """

    strategy: Literal["even", "fixed_per_user", "explicit"]
    user_ids: list[UUID] = []
    user_task_counts: dict[UUID, int] | None = None
    task_assignments: dict[int, list[UUID]] | None = None

    # Optional scope: restrict the distribution pool to one task set.
    task_set_id: int | None = None


class AssignTasksToUsersResult(BaseModel):
    total_assigned: int


class ImportTaskAssignmentsResult(BaseModel):
    """Summary of a task-assignment CSV import."""

    tasks_updated: int
    assignees_created: int
    reviewers_created: int


class _ReviewerAssignment(BaseModel):
    """Reviewers go only to tasks that already have a primary (non-review)
    assignment, and each picked task is topped up to `reviewers_per_task`."""

    reviewer_ids: list[UUID]
    reviewers_per_task: int = Field(ge=1)
    # Restricts the reviewable pool to one task set.
    task_set_id: int | None = None


class ReviewShareOfTasks(_ReviewerAssignment):
    pattern: Literal["percentage"]
    percentage: float = Field(gt=0, le=100)


class ReviewNumberOfTasks(_ReviewerAssignment):
    pattern: Literal["fixed"]
    num_tasks: int = Field(ge=1)


class DeleteTasksRequest(BaseModel):
    """
    Request to delete multiple annotation tasks.

    The tasks' annotations are kept, detached from their task, unless
    ``delete_annotations`` asks for them to go too.
    """

    task_ids: list[int]
    delete_annotations: bool = False


class UnassignTasksRequest(BaseModel):
    """
    Request to batch-unassign users from annotation tasks.

    If `user_ids` is provided, only those users are unassigned from each task.
    If omitted, all users are unassigned from each task.
    """

    task_ids: list[int]
    user_ids: list[UUID] | None = None


class TaskSetOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    num_tasks: int
    num_labeled: int


class TaskSetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v


class TaskSetRename(BaseModel):
    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v


class MoveTasksToSetRequest(BaseModel):
    task_ids: list[int]


class MoveTasksToSetResult(BaseModel):
    num_moved: int


AssignReviewersRequest = Annotated[
    ReviewShareOfTasks | ReviewNumberOfTasks, Field(discriminator="pattern")
]

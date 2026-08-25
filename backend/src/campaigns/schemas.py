from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)

from src.campaigns.form_fields import FormField, validate_form_fields
from src.canvas.schemas import CanvasLayoutOut
from src.custom_layers.schemas import CustomMapOut, VectorLayerOut
from src.imagery.schemas import (
    BasemapOut,
    ImageryEditorStateCreate,
    ImagerySourceOut,
    ImageryViewOut,
)
from src.timeseries.schemas import TimeSeriesCreate, TimeSeriesOut


# ============================================================================
# Campaign Related Schemas
# ============================================================================
def _check_form_fields(value: list[FormField]) -> list[FormField]:
    validate_form_fields(value)
    return value


ValidatedFormFields = Annotated[list[FormField], AfterValidator(_check_form_fields)]


class LabelBase(BaseModel):
    """
    A label that can be assigned to an annotation within a campaign.
    """

    id: int  # ID that is used for annotation
    name: str
    geometry_type: Literal["point", "polygon", "line"] | None = None


def label_id_to_name(labels: dict | None) -> dict[int, str]:
    """Decode a campaign's labels JSONB ({"1": {"name": "Forest", ...}}) into
    {label_id: display_name}."""
    if not isinstance(labels, dict):
        return {}
    return {int(label_id): data["name"] for label_id, data in labels.items()}


PolicyAudienceKind = Literal["admins", "authoritative", "assignees", "members", "anyone"]

# Labelling policies options per kind of task/explore
_EXPLORE_ALLOWED_KINDS: frozenset[str] = frozenset({"admins", "members", "anyone"})
_UNASSIGNED_TASKS_ALLOWED_KINDS: frozenset[str] = frozenset(
    {"admins", "authoritative", "members", "anyone"}
)
_ASSIGNED_TASKS_ALLOWED_KINDS: frozenset[str] = frozenset(
    {"admins", "authoritative", "assignees", "members", "anyone"}
)
_COMPLETE_ASSIGNED_ALLOWED_KINDS: frozenset[str] = frozenset(
    {"admins", "authoritative", "assignees", "members"}
)
# Never "anyone": undoing other people's work is not something a campaign can
# open to the public, however public its labelling is.
_MODIFY_OTHERS_ALLOWED_KINDS: frozenset[str] = frozenset({"admins", "authoritative", "members"})


class PolicyAudience(BaseModel):
    """An audience selector for one labelling-policy axis: a set of role
    `kinds` plus an additive list of specifically selected `user_ids`. Empty
    kinds and empty user_ids means "no one"."""

    kinds: list[PolicyAudienceKind] = []
    user_ids: list[UUID] = []


def _validate_axis_kinds(
    audience: PolicyAudience, allowed: frozenset[str], axis_name: str
) -> PolicyAudience:
    disallowed = [kind for kind in audience.kinds if kind not in allowed]
    if disallowed:
        raise ValueError(
            f"{axis_name} does not allow kind(s) {disallowed}; allowed: {sorted(allowed)}"
        )
    return audience


class LabellingPolicy(BaseModel):
    """Who may label what, and whose labels count toward task completion.

    See docs/labelling-policy.md for the
    full rationale behind the four axes.
    """

    explore: PolicyAudience = Field(default_factory=PolicyAudience)
    unassigned_tasks: PolicyAudience = Field(default_factory=PolicyAudience)
    assigned_tasks: PolicyAudience = Field(default_factory=PolicyAudience)
    complete_assigned: PolicyAudience = Field(default_factory=PolicyAudience)
    # Defaults to campaign admins rather than to the empty audience: a policy
    # stored before this axis existed has to keep meaning what it meant, which
    # is "its author, or an admin".
    modify_others: PolicyAudience = Field(default_factory=lambda: PolicyAudience(kinds=["admins"]))

    @field_validator("explore")
    @classmethod
    def _check_explore_kinds(cls, v: PolicyAudience) -> PolicyAudience:
        return _validate_axis_kinds(v, _EXPLORE_ALLOWED_KINDS, "explore")

    @field_validator("unassigned_tasks")
    @classmethod
    def _check_unassigned_tasks_kinds(cls, v: PolicyAudience) -> PolicyAudience:
        return _validate_axis_kinds(v, _UNASSIGNED_TASKS_ALLOWED_KINDS, "unassigned_tasks")

    @field_validator("assigned_tasks")
    @classmethod
    def _check_assigned_tasks_kinds(cls, v: PolicyAudience) -> PolicyAudience:
        return _validate_axis_kinds(v, _ASSIGNED_TASKS_ALLOWED_KINDS, "assigned_tasks")

    @field_validator("complete_assigned")
    @classmethod
    def _check_complete_assigned_kinds(cls, v: PolicyAudience) -> PolicyAudience:
        return _validate_axis_kinds(v, _COMPLETE_ASSIGNED_ALLOWED_KINDS, "complete_assigned")

    @field_validator("modify_others")
    @classmethod
    def _check_modify_others_kinds(cls, v: PolicyAudience) -> PolicyAudience:
        return _validate_axis_kinds(v, _MODIFY_OTHERS_ALLOWED_KINDS, "modify_others")

    model_config = ConfigDict(from_attributes=True)


def default_labelling_policy(is_public: bool = False) -> LabellingPolicy:
    """The labelling policy used when a campaign is created without an
    explicit one, and backfilled by migration z1labelpolicy for existing
    campaigns. Matches current unified behavior (any member can label
    anything); completion stays with assignees/admins/authoritative.

    Public campaigns additionally open the explore/unassigned_tasks/
    assigned_tasks axes to 'anyone' (unauthenticated/any visitor), since a
    public campaign is meant to be labellable without membership. Whose
    label *counts* toward completion is a separate question the spec answers
    "no" for anonymous visitors, so complete_assigned is unchanged.
    """
    anyone = ["anyone"] if is_public else []
    return LabellingPolicy(
        explore=PolicyAudience(kinds=["members", *anyone]),
        unassigned_tasks=PolicyAudience(kinds=["members", *anyone]),
        assigned_tasks=PolicyAudience(kinds=["members", *anyone]),
        complete_assigned=PolicyAudience(kinds=["assignees", "admins", "authoritative"]),
        modify_others=PolicyAudience(kinds=["admins"]),
    )


class UpdateLabellingPolicyRequest(LabellingPolicy):
    """Request body for PATCH /campaigns/{id}/labelling-policy - same shape
    as LabellingPolicy, plus the campaign-public check applied by the service.

    The four labelling axes are required (no defaults), unlike the base
    LabellingPolicy: a PATCH is a full replacement of the stored policy, so
    silently omitting one would default it to "no one" rather than leaving it
    as the caller likely intended. Callers must always send the complete
    policy, which is what the settings UI does.

    ``modify_others`` keeps its inherited default instead, because that
    default is "campaign admins" rather than "no one": omitting it leaves the
    axis where a campaign that never set it already was.
    """

    explore: PolicyAudience
    unassigned_tasks: PolicyAudience
    assigned_tasks: PolicyAudience
    complete_assigned: PolicyAudience


class CampaignSettingsOut(BaseModel):
    labels: list[LabelBase]
    bbox_west: float
    bbox_south: float
    bbox_east: float
    bbox_north: float
    embedding_year: int | None = None
    guide_markdown: str | None = None
    sample_extent_meters: float | None = None
    labelling_policy: LabellingPolicy
    form_fields: list[FormField] = []
    research_sharing: bool

    @field_validator("labels", mode="before")
    @classmethod
    def convert_labels(cls, v):
        """Convert the labels JSONB dict from the DB into list[LabelBase]:
        {"1": {"name": "Forest", "geometry_type": "polygon"}} -> [{id: 1, ...}]."""
        if not isinstance(v, dict):
            return v
        return [
            LabelBase(
                id=int(k),
                name=vv["name"],
                geometry_type=vv.get("geometry_type"),
            )
            for k, vv in v.items()
        ]

    model_config = ConfigDict(from_attributes=True)


class CampaignSettingsCreate(BaseModel):
    labels: list[LabelBase]
    bbox_west: float
    bbox_south: float
    bbox_east: float
    bbox_north: float
    embedding_year: int | None = None
    sample_extent_meters: float | None = None
    form_fields: ValidatedFormFields = []

    # Helper to convert labels to dict in DB
    def to_orm(self) -> dict:
        labels_dict = {}
        for label in self.labels:
            label_data = {"name": label.name}
            if label.geometry_type is not None:
                label_data["geometry_type"] = label.geometry_type
            labels_dict[str(label.id)] = label_data
        return {
            "labels": labels_dict,
            "bbox_west": self.bbox_west,
            "bbox_south": self.bbox_south,
            "bbox_east": self.bbox_east,
            "bbox_north": self.bbox_north,
            "embedding_year": self.embedding_year,
            "sample_extent_meters": self.sample_extent_meters,
            "form_fields": [f.model_dump() for f in self.form_fields],
        }


class CampaignSummaryOut(BaseModel):
    """A campaign without its imagery. What the overview, tasks and review pages read.

    Serving those from `CampaignOut` meant loading the whole imagery tree - sources,
    collections, slices, tile URLs - for pages that render a name and a settings object,
    at around twenty sequential queries instead of a handful.
    """

    id: int
    project_id: int
    name: str
    created_at: datetime
    mode: Literal["tasks", "open"]
    is_public: bool = False
    registration_status: str = "ready"
    embedding_status: str = "ready"
    registration_errors: list[dict] | None = None
    annotations_version: int = 0

    viewer_is_admin: bool = False
    viewer_is_member: bool = False
    viewer_is_authoritative_reviewer: bool = False

    settings: CampaignSettingsOut

    model_config = ConfigDict(from_attributes=True)


class CampaignOut(CampaignSummaryOut):
    imagery_sources: list[ImagerySourceOut]
    imagery_views: list[ImageryViewOut]
    basemaps: list[BasemapOut]
    custom_maps: list[CustomMapOut] = []
    vector_layers: list[VectorLayerOut] = []
    time_series: list[TimeSeriesOut]


class CampaignCreate(BaseModel):
    name: str
    mode: Literal["tasks", "open"] = "tasks"  # for default mode. actual ACL in labelling_policy
    project_id: int
    settings: CampaignSettingsCreate
    imagery_editor_state: ImageryEditorStateCreate | None = None
    timeseries_configs: list[TimeSeriesCreate] | None = None
    labelling_policy: LabellingPolicy | None = None


class CampaignListItemOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    project_id: int
    is_admin: bool = False
    is_member: bool = False
    is_public: bool = False
    registration_status: str = "ready"
    embedding_status: str = "ready"

    model_config = ConfigDict(from_attributes=True)


class CampaignOutFull(CampaignOut):
    """Campaign with canvas layout information extracted."""

    default_main_canvas_layout: Annotated[
        CanvasLayoutOut | None, Field(json_schema_extra={"readOnly": True})
    ]
    personal_main_canvas_layout: Annotated[
        CanvasLayoutOut | None, Field(json_schema_extra={"readOnly": True})
    ]

    @classmethod
    def from_orm(cls, obj, user_id: UUID | None = None):
        default_layout = None
        personal_layout = None

        if hasattr(obj, "canvas_layouts"):
            for layout in obj.canvas_layouts:
                if layout.view_id is None:
                    if layout.is_default and layout.user_id is None:
                        default_layout = CanvasLayoutOut.model_validate(layout)
                    elif user_id and layout.user_id == user_id:
                        personal_layout = CanvasLayoutOut.model_validate(layout)

        views_list = []
        if hasattr(obj, "imagery_views"):
            for view in obj.imagery_views:
                views_list.append(ImageryViewOut.from_orm(view, user_id=user_id))

        return cls.model_validate(
            {
                "id": obj.id,
                "project_id": obj.project_id,
                "name": obj.name,
                "created_at": obj.created_at,
                "mode": obj.mode,
                "is_public": obj.is_public,
                "annotations_version": obj.annotations_version,
                "settings": obj.settings,
                "time_series": obj.time_series,
                "imagery_sources": obj.imagery_sources,
                "imagery_views": views_list,
                "basemaps": obj.basemaps,
                "custom_maps": obj.custom_maps,
                "vector_layers": obj.vector_layers,
                "default_main_canvas_layout": default_layout,
                "personal_main_canvas_layout": personal_layout,
            }
        )


# ============================================================================
# Specific Request / Response Schemas
# ============================================================================


class CampaignsListResponse(BaseModel):
    items: list[CampaignListItemOut]


class UpdateCampaignNameRequest(BaseModel):
    name: str


class CampaignDuplicateRequest(BaseModel):
    """Tasks and annotations are deliberate decisions - no defaults."""

    include_tasks: bool
    include_annotations: bool
    include_user_layouts: bool = True


class UpdateCampaignGuideRequest(BaseModel):
    guide_markdown: str | None = None


class UpdateSampleExtentRequest(BaseModel):
    sample_extent_meters: float | None = None


class UpdateResearchSharingRequest(BaseModel):
    research_sharing: bool


class UpdateCampaignBBoxRequest(BaseModel):
    bbox_west: float
    bbox_south: float
    bbox_east: float
    bbox_north: float


class UpdateEmbeddingYearRequest(BaseModel):
    """Set or change the year from which satellite embeddings are sourced."""

    embedding_year: int | None = None


class UpdateCampaignLabelsRequest(BaseModel):
    """Replace the campaign's label set. Existing label IDs are preserved (so
    annotations referencing them continue to resolve); new labels get appended."""

    labels: list[LabelBase]


class UpdateCampaignFormFieldsRequest(BaseModel):
    """Replace the campaign's custom form fields. Existing field IDs must be
    preserved (stored annotation answers key off them); new fields get new ids."""

    form_fields: ValidatedFormFields


class EmbeddingYearUpdateResponse(BaseModel):
    """Response after updating the embedding year."""

    embedding_year: int | None
    embeddings_recomputed: bool


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


class AssignReviewersRequest(BaseModel):
    """
    Request to assign reviewers to tasks based on different patterns.

    Reviewers may only be assigned to tasks that already have a primary
    (non-review) assignment. Each selected task is topped up to the requested
    number of reviewers, so re-running does not stack additional reviewers on
    tasks that already meet the target.
    """

    pattern: Literal["percentage", "manual", "fixed"]

    # For 'percentage' pattern
    percentage: float | None = None  # Percentage of already-assigned tasks to review (0-100)
    num_reviewers: int | None = None  # Target reviewers per task (excluding the annotator)
    reviewer_ids: list[UUID] | None = None  # Pool of reviewers to choose from

    # For 'manual' pattern
    manual_assignments: dict[int, list[UUID]] | None = None  # task_id -> list of reviewer user_ids

    # For 'fixed' pattern
    num_tasks: int | None = None  # Number of already-assigned tasks to review
    fixed_num_reviewers: int | None = None  # Target reviewers per task (excluding the annotator)

    # Optional scope: restrict the reviewable pool to one task set.
    task_set_id: int | None = None


class DeleteAnnotationTasksRequest(BaseModel):
    """
    Request to delete multiple annotation tasks.
    """

    task_ids: list[int]


class UnassignTasksRequest(BaseModel):
    """
    Request to batch-unassign users from annotation tasks.

    If `user_ids` is provided, only those users are unassigned from each task.
    If omitted, all users are unassigned from each task.
    """

    task_ids: list[int]
    user_ids: list[UUID] | None = None


# ============================================================================
# Campaign Statistics Schemas
# ============================================================================


class AnnotatorInfo(BaseModel):
    """Basic information about an annotator."""

    user_id: UUID
    user_email: str
    user_display_name: str | None
    total_annotations: int
    label_distribution: dict[str, int]  # label name -> count
    timed_tasks: int = 0  # tasks with a measured duration
    median_seconds_per_task: int | None = None
    total_active_seconds: int | None = None


class PairwiseAgreement(BaseModel):
    """Agreement percentage between two annotators."""

    annotator1_id: str
    annotator2_id: str
    agreement_percentage: float | None  # percentage (0-100), None if no shared tasks
    shared_tasks: int  # number of tasks both annotators worked on


class CampaignStatistics(BaseModel):
    """Statistics for a campaign focused on inter-annotator agreement."""

    campaign_id: int
    campaign_name: str
    total_annotations: int
    tasks_with_multiple_annotations: int  # Number of tasks used for agreement calculation
    overall_label_distribution: dict[str, int]  # Overall label distribution
    krippendorff_alpha: float | None  # Overall inter-annotator agreement (0-1)
    annotators: list[AnnotatorInfo]
    pairwise_agreements: list[PairwiseAgreement]


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

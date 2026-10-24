from datetime import datetime
from typing import Annotated, Any, Literal, TypedDict
from uuid import UUID

from geoalchemy2.shape import to_shape
from pydantic import (
    AliasChoices,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    model_validator,
)

from src.annotation.constants import TaskOutcome


class DateRangeValue(TypedDict):
    start: str
    end: str


# A TypedDict, not a BaseModel: form values stay plain JSON containers so
# annotation.forms.validate_form_values remains the single authority on shape.
FormValue = int | float | str | list[int] | DateRangeValue


class SliceComment(BaseModel):
    """A note about one imagery slice, kept alongside the annotation it was
    written on. The imagery fields are a snapshot, taken for the same reason
    `Annotation.imagery_*` is: the note has to stay readable once the slice it
    names has been re-registered or dropped."""

    slice_id: int
    text: str = Field(max_length=2000)
    source_name: str | None = None
    start_date: str | None = None
    end_date: str | None = None


def normalize_slice_comments(comments: list[SliceComment] | None) -> list[dict] | None:
    """One note per slice, blank ones dropped, `None` when nothing is left - so
    clearing the last note leaves a NULL column rather than an empty list."""
    by_slice = {c.slice_id: c for c in comments or [] if c.text.strip()}
    return [c.model_dump() for c in by_slice.values()] or None


def _wkt(value: Any) -> str:
    """A geometry column as WKT, like every geometry this API hands out."""
    return value if isinstance(value, str) else to_shape(value).wkt


Wkt = Annotated[str, BeforeValidator(_wkt)]


class AnnotationFromTaskOut(BaseModel):
    id: int
    label_id: int | None
    # Set on task rows, None on shapes.
    outcome: TaskOutcome | None = None
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
    slice_comments: list[SliceComment] | None = None
    form_values: dict[str, FormValue] | None = None
    active_seconds: int | None = None
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
    geometry_wkt: Wkt = Field(validation_alias=AliasChoices("geometry", "geometry_wkt"))
    # Origin: set for task-bound annotations, None for standalone (explore)
    # ones. Lets the annotations page open the matching work mode on "View".
    task_id: int | None = None
    origin_task_id: int | None = None
    output_of_task_id: int | None = None

    model_config = ConfigDict(from_attributes=True)


AnnotationSort = Literal[
    "default",
    "id-asc",
    "id-desc",
    "confidence-asc",
    "confidence-desc",
    "time-asc",
    "time-desc",
]


class AnnotationListItemOut(BaseModel):
    """One row of the annotations page.

    Deliberately not ``AnnotationOut``. The list renders metadata and needs a point to
    fly to, never the geometry itself - and shipping every geometry is what made this
    page a 70 MB, ten-second request on a campaign holding 100k annotations. The
    centroid is computed in the database so the shape never crosses the wire at all.
    """

    id: int
    label_id: int | None
    confidence: int | None
    flagged_for_review: bool
    flag_comment: str | None = None
    comment: str | None = None
    task_id: int | None = None
    created_at: datetime
    created_by_user_id: UUID
    created_by_user_email: str | None = None
    created_by_user_display_name: str | None = None
    centroid_lat: float | None = None
    centroid_lon: float | None = None
    # The answers, so the review tables can show them without a read per row.
    form_values: dict[str, FormValue] | None = None


class AnnotationsPageOut(BaseModel):
    """A page of annotations plus how many matched the filter, so the client can show
    "showing n of m" and page without asking twice."""

    items: list[AnnotationListItemOut]
    total: int
    limit: int
    offset: int


class AnnotationLabelDensityCell(BaseModel):
    """One grid cell's worth of a single label: where that class sits and how much of it
    is there. The review map draws the campaign's class distribution from these, which is
    a different question from the plain density grid's "where are annotations at all"."""

    lon: float
    lat: float
    label_id: int | None
    count: int


class AnnotatorFacet(BaseModel):
    user_id: UUID
    email: str | None = None
    display_name: str | None = None
    count: int


class LabelFacet(BaseModel):
    """``label_id`` is None for annotations that carry no label."""

    label_id: int | None
    count: int


class ConfidenceFacet(BaseModel):
    confidence: int | None
    count: int


class AnnotationFacetsOut(BaseModel):
    """Everything the annotations page needs that is *about* the whole campaign rather
    than about one page of it: which annotators exist, how the labels are distributed,
    how many there are in total.

    It exists because the page used to derive all of this by scanning every annotation
    it had loaded, which is only possible if you load them all. Aggregating in the
    database is both correct under paging and far cheaper.
    """

    total: int
    with_confidence: int
    annotators: list[AnnotatorFacet]
    labels: list[LabelFacet]
    confidences: list[ConfidenceFacet]


class _AnnotationFields(BaseModel):
    """What every annotation write may carry besides its label and shape."""

    comment: str | None = Field(default=None, max_length=5000)
    confidence: int | None = Field(default=None, ge=0, le=10)
    flagged_for_review: bool | None = None
    flag_comment: str | None = Field(default=None, max_length=5000)
    slice_comments: list[SliceComment] | None = Field(default=None, max_length=100)
    form_values: dict[str, FormValue] | None = None


class _ViewedImagery(BaseModel):
    """The slice the annotator was looking at. Its source and dates are recorded
    from the slice itself (see Annotation)."""

    imagery_slice_id: int | None = None


class TaskAnswerCreate(_AnnotationFields, _ViewedImagery):
    label_id: int | None = None
    is_authoritative: bool | None = None
    # Required for draw tasks; a classify submission's label already says it.
    outcome: TaskOutcome | None = None
    # Active time the client measured for this task since the last submit. Capped
    # at an hour so a misbehaving client cannot distort the duration statistics.
    active_ms: int | None = Field(default=None, ge=0, le=3_600_000)


class AnnotationCreate(_AnnotationFields, _ViewedImagery):
    label_id: int
    geometry_wkt: str
    # The task the annotator was on when they drew this standalone annotation.
    origin_task_id: int | None = None
    # The draw task this shape answers. At most one of the two links is set.
    output_of_task_id: int | None = None


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


class AnnotationChangeOut(BaseModel):
    """One annotation another session created or edited, small enough to poll
    for: the id the tiles use, what to paint it as, and its geometry."""

    id: int
    label_id: int | None = None
    created_by_user_id: UUID
    # WKT, like every other geometry this API hands out, so the client parses
    # it with the one parser it already has.
    geometry_wkt: str


class AnnotationChangesOut(BaseModel):
    """Everything that happened to a campaign's annotations since a cursor,
    plus the cursor for the next poll.

    ``server_time`` is the database clock, never the app's: it is compared
    against ``updated_at``, which the database stamps. ``truncated`` means the
    poll cannot answer this cursor - more changed than it should carry, or the
    cursor is older than deletions are kept - so the client refetches its tiles
    instead of trying to catch up one annotation at a time.
    """

    server_time: datetime
    changes: list[AnnotationChangeOut]
    deleted: list[int] = []
    truncated: bool = False


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


class AnnotationUpdate(_AnnotationFields, _ViewedImagery):
    """Fields left out stay as they are. The imagery viewed only changes
    together with the geometry."""

    label_id: int | None = None
    geometry_wkt: str | None = None

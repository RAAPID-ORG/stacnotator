from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from src.annotation.schemas import AnnotationFromTaskCreate
from src.campaigns.form_fields import FormField
from src.campaigns.schemas import LabelBase

MAX_IMAGE_PX = 2048


class ViewCell(BaseModel):
    """One panel of a view: exactly one of a slice, a basemap or a time series chart."""

    slice_id: int | None = None
    # Visualization of the slice's source; its first one when omitted.
    visualization: str | None = None
    basemap_id: int | None = None
    # Drawn as one chart spanning a full row of the grid.
    timeseries_ids: list[int] | None = Field(default=None, min_length=1, max_length=8)
    # Time series cells only, as the chart options in the annotation page: drop
    # cloud-flagged observations, and draw a Savitzky-Golay smoothed line.
    remove_cloudy: bool = False
    smoothed: bool = False
    # Overrides the view's zoom for this cell, e.g. a wide context cell next to detail.
    zoom: float | None = Field(default=None, ge=1, le=22)

    @model_validator(mode="after")
    def _exactly_one(self) -> "ViewCell":
        chosen = [self.slice_id, self.basemap_id, self.timeseries_ids]
        if sum(value is not None for value in chosen) != 1:
            raise ValueError("a cell names exactly one of slice_id, basemap_id, timeseries_ids")
        if self.timeseries_ids is None and (self.remove_cloudy or self.smoothed):
            raise ValueError("remove_cloudy and smoothed apply to time series cells only")
        return self


class ViewSpec(BaseModel):
    """One packed image: cells laid out in a grid, all at the same zoom around the task."""

    cells: list[ViewCell] = Field(min_length=1, max_length=36)
    columns: int = Field(default=4, ge=1, le=8)
    cell_px: int = Field(default=320, ge=96, le=1024)
    zoom: float = Field(default=15, ge=1, le=22)

    @model_validator(mode="after")
    def _fits(self) -> "ViewSpec":
        if self.columns * self.cell_px > MAX_IMAGE_PX:
            raise ValueError(f"columns * cell_px must be at most {MAX_IMAGE_PX}")
        return self


class AgentRegister(BaseModel):
    name: str = Field(min_length=1, max_length=20, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")
    description: str | None = Field(default=None, max_length=2000)
    task_count: int = Field(default=10, ge=0, le=1000)
    task_set_id: int | None = None
    default_views: list[ViewSpec] | None = Field(default=None, max_length=4)
    takes_over_work: bool = False


class AgentUpdate(BaseModel):
    """Only the fields given change."""

    takes_over_work: bool | None = None
    # What next_task returns and what is drawn ahead for upcoming tasks.
    default_views: list[ViewSpec] | None = Field(default=None, min_length=1, max_length=4)


class AgentTasksRequest(BaseModel):
    count: int = Field(ge=1, le=1000)
    task_set_id: int | None = None


class ViewsRequest(BaseModel):
    """Views to render once; the agent's default views when omitted."""

    views: list[ViewSpec] | None = Field(default=None, max_length=8)


class AgentAnnotate(AnnotationFromTaskCreate):
    comment: str | None = Field(default=None, max_length=5000)


class AgentOut(BaseModel):
    agent_id: UUID
    name: str
    description: str | None
    campaign_id: int
    # The app page that must stay open in a browser to draw this agent's views.
    render_host_path: str
    assigned: int
    remaining: int
    takes_over_work: bool
    default_views: list[ViewSpec]
    host_seen_at: datetime | None
    created_at: datetime


class SliceContext(BaseModel):
    slice_id: int
    name: str
    start_date: str
    end_date: str


class CollectionContext(BaseModel):
    collection_id: int
    name: str
    cover_slice_id: int | None
    slices: list[SliceContext]


class SourceContext(BaseModel):
    source_id: int
    name: str
    # Planet scenes: imagery is searched around each task when asked for, so a date can
    # turn out to hold nothing at a given point.
    on_demand: bool
    default_zoom: int
    max_native_zoom: int | None
    visualizations: list[str]
    collections: list[CollectionContext]


class BasemapContext(BaseModel):
    basemap_id: int
    name: str
    max_native_zoom: int | None


class TimeseriesContext(BaseModel):
    timeseries_id: int
    name: str
    group: str
    data_source: str
    index: str
    start_ym: str
    end_ym: str


class CampaignContext(BaseModel):
    campaign_id: int
    project_id: int
    name: str
    mode: str
    bbox: tuple[float, float, float, float]
    # Side of the square drawn around point tasks; polygon tasks show their own outline.
    sample_extent_meters: float | None
    guide_markdown: str | None
    labels: list[LabelBase]
    form_fields: list[FormField]
    imagery: list[SourceContext]
    basemaps: list[BasemapContext]
    timeseries: list[TimeseriesContext]


class ReleasedTasksOut(BaseModel):
    released: int


class CampaignWorkOut(BaseModel):
    """What there is to hand out before any agent is registered."""

    campaign_id: int
    name: str
    total_tasks: int
    # Neither assigned nor labelled: what new agents can be given.
    open_tasks: int
    agents: list[AgentOut]


class AgentRegistrationOut(BaseModel):
    agent: AgentOut
    context: CampaignContext
    default_views: list[ViewSpec]


class AgentTaskOut(BaseModel):
    task_id: int
    annotation_number: int
    lat: float
    lon: float
    geometry_wkt: str


class RenderedView(BaseModel):
    view: ViewSpec
    status: str
    mime_type: str | None = None
    image_base64: str | None = None
    meta: dict[str, Any] | None = None
    error: str | None = None


class TaskBundleOut(BaseModel):
    task: AgentTaskOut | None
    remaining: int
    views: list[RenderedView]


class RenderJobOut(BaseModel):
    """What a render host needs to draw one view."""

    job_id: int
    agent_id: UUID
    task: AgentTaskOut
    view: ViewSpec


class RenderJobResult(BaseModel):
    mime_type: str | None = Field(default=None, pattern=r"^image/(png|jpeg|webp)$")
    image_base64: str | None = Field(default=None, max_length=12_000_000)
    meta: dict[str, Any] | None = None
    error: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _image_or_error(self) -> "RenderJobResult":
        if (self.image_base64 is None) == (self.error is None):
            raise ValueError("a result carries either an image or an error")
        if self.image_base64 is not None and self.mime_type is None:
            raise ValueError("an image needs its mime_type")
        return self

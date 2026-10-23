from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.campaigns.schemas import default_labelling_policy
from src.database import Base
from src.layers import LayerOwner
from src.projects.access import VISIBILITY_PUBLIC

if TYPE_CHECKING:
    from src.annotation.models import Annotation, AnnotationTask
    from src.canvas.models import CanvasLayout
    from src.custom_layers.models import CustomMap, VectorLayer
    from src.imagery.models import Basemap, ImagerySource, ImageryView
    from src.projects.models import Project
    from src.timeseries.models import Timeseries


class Campaign(Base):
    """
    Represents an annotation campaign containing imagery, settings, tasks and annotations.
    """

    __tablename__ = "campaigns"
    __table_args__ = (
        Index("idx_campaigns_project_id", "project_id"),
        CheckConstraint(
            "default_work_mode IN ('tasks', 'explore')",
            name="campaigns_default_work_mode_values",
        ),
        CheckConstraint("bbox_west BETWEEN -180 AND 180", name="campaigns_bbox_west_range"),
        CheckConstraint("bbox_east BETWEEN -180 AND 180", name="campaigns_bbox_east_range"),
        CheckConstraint("bbox_south BETWEEN -90 AND 90", name="campaigns_bbox_south_range"),
        CheckConstraint("bbox_north BETWEEN -90 AND 90", name="campaigns_bbox_north_range"),
        CheckConstraint("bbox_west < bbox_east", name="campaigns_bbox_lon_order"),
        CheckConstraint("bbox_south < bbox_north", name="campaigns_bbox_lat_order"),
        CheckConstraint("task_output IN ('classify', 'draw')", name="campaigns_task_output_values"),
        {"schema": "data"},
    )

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Campaign metadata
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )
    # Which work mode the annotation page opens in. Who may do which kind of work
    # is the labelling policy's business, not this.
    default_work_mode: Mapped[str] = mapped_column(String(20), nullable=False)
    # Imagery registration status: pending, registering, ready, failed
    registration_status: Mapped[str] = mapped_column(
        String(20), server_default="ready", nullable=False
    )
    # Embedding registration status: pending, registering, ready, failed
    embedding_status: Mapped[str] = mapped_column(
        String(20), server_default="ready", nullable=False
    )
    # Liveness stamps for the background runs behind the two statuses; a
    # "registering" campaign whose stamp goes stale is swept to "failed"
    # (see src/background.py).
    registration_heartbeat_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    embedding_heartbeat_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    # Errors from background registration (JSON array, null when no errors).
    # none_as_null: without it SQLAlchemy stores a cleared value as the JSON
    # scalar 'null' rather than SQL NULL, and finish_status_run's jsonb `||`
    # then appends to it as if it were a one-element array, yielding [null].
    registration_errors: Mapped[list | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )

    # Monotonic counter bumped on every annotation create/update/delete. Used as
    # a cache-busting key in annotation vector-tile URLs so edits invalidate the
    # affected tiles without a manual purge.
    annotations_version: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False)

    project_id: Mapped[int] = mapped_column(
        ForeignKey("data.projects.id", ondelete="CASCADE"), nullable=False
    )

    # --- What annotators work with: the area, the labels and the form ---
    bbox_west: Mapped[float] = mapped_column(nullable=False)
    bbox_south: Mapped[float] = mapped_column(nullable=False)
    bbox_east: Mapped[float] = mapped_column(nullable=False)
    bbox_north: Mapped[float] = mapped_column(nullable=False)
    # [{"id": 1, "name": "Forest", "geometry_type": "polygon"}, ...]; ids are what
    # annotations store, so a label keeps its id for life.
    labels: Mapped[list] = mapped_column(JSONB, server_default="[]", nullable=False)
    form_fields: Mapped[list] = mapped_column(JSONB, server_default="[]", nullable=False)
    # Markdown guide shown to annotators.
    guide_markdown: Mapped[str | None] = mapped_column(String, nullable=True)
    # Side length (in meters) of the square drawn around each point task.
    # NULL draws no extent, only the crosshair.
    sample_extent_meters: Mapped[float | None] = mapped_column(nullable=True)
    # What finishing a task means: picking a label for the task's own geometry
    # (classify), or drawing shapes around it (draw). Fixed once tasks are worked.
    task_output: Mapped[str] = mapped_column(
        String(20), server_default=text("'classify'"), nullable=False
    )
    # Year satellite embeddings are sourced from; NULL means no embeddings.
    embedding_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # When on, annotations may be published as open research data, without any
    # annotator's name. See "Sharing Your Annotations for Research" in the terms.
    research_sharing: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false"), nullable=False
    )
    # Who may label what, and whose labels count toward task completion.
    # See src/campaigns/schemas.py:LabellingPolicy and docs/labelling-policy.md.
    labelling_policy: Mapped[dict] = mapped_column(
        JSONB,
        server_default=text(f"'{default_labelling_policy().model_dump_json()}'::jsonb"),
        nullable=False,
    )

    # Relationships
    project: Mapped["Project"] = relationship(back_populates="campaigns")
    time_series: Mapped[list["Timeseries"]] = relationship(
        back_populates="campaign",
        cascade="all, delete-orphan",
    )
    task_items: Mapped[list["AnnotationTask"]] = relationship(
        back_populates="campaign",
        cascade="all, delete-orphan",
    )
    annotations: Mapped[list["Annotation"]] = relationship(
        back_populates="campaign",
        cascade="all, delete-orphan",
    )
    imagery_sources: Mapped[list["ImagerySource"]] = relationship(
        "ImagerySource",
        back_populates="campaign",
        cascade="all, delete-orphan",
        order_by="ImagerySource.display_order",
    )
    basemaps: Mapped[list["Basemap"]] = relationship(
        "Basemap", back_populates="campaign", cascade="all, delete-orphan"
    )
    custom_maps: Mapped[list["CustomMap"]] = relationship(
        "CustomMap",
        back_populates="campaign",
        cascade="all, delete-orphan",
        order_by="CustomMap.display_order",
    )
    vector_layers: Mapped[list["VectorLayer"]] = relationship(
        "VectorLayer",
        back_populates="campaign",
        cascade="all, delete-orphan",
        order_by="VectorLayer.display_order",
    )
    imagery_views: Mapped[list["ImageryView"]] = relationship(
        "ImageryView",
        back_populates="campaign",
        cascade="all, delete-orphan",
        order_by="ImageryView.display_order",
    )
    canvas_layouts: Mapped[list["CanvasLayout"]] = relationship(
        "CanvasLayout",
        foreign_keys="[CanvasLayout.campaign_id]",
        back_populates="campaign",
        cascade="all, delete-orphan",
    )
    task_sets: Mapped[list["TaskSet"]] = relationship(
        "TaskSet",
        cascade="all, delete-orphan",
    )

    @property
    def is_public(self) -> bool:
        """Platform-public standing, resolved through the owning project.
        Org-public visibility deliberately does not count: the 'anyone'
        audience stays tied to platform-public projects only."""
        return self.project.visibility == VISIBILITY_PUBLIC

    @property
    def layer_owner(self) -> LayerOwner:
        return LayerOwner(campaign_id=self.id)

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        """(west, south, east, north)"""
        return (self.bbox_west, self.bbox_south, self.bbox_east, self.bbox_north)

    @property
    def label_names(self) -> dict[int, str]:
        return {label["id"]: label["name"] for label in self.labels}

    @property
    def settings(self) -> "Campaign":
        """The campaign's configuration, which the API sends as one ``settings``
        object; it lives on the campaign itself."""
        return self


class TaskSet(Base):
    """
    A named group of annotation tasks within a campaign. Every task belongs to
    exactly one set; services enforce that a campaign keeps at least one set.
    """

    __tablename__ = "task_sets"
    __table_args__ = (
        UniqueConstraint("campaign_id", "name"),
        Index("idx_task_sets_campaign_id", "campaign_id"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )

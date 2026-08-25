from datetime import datetime
from typing import TYPE_CHECKING, Literal
from uuid import UUID

from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Identity,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database import Base

FeedbackVerdict = Literal["good", "wrong"]

if TYPE_CHECKING:
    from src.auth.models import User
    from src.custom_layers.models import CustomMap, VectorLayer
    from src.imagery.models import Basemap, ImagerySource
    from src.projects.models import Project


class Visualizer(Base):
    """A published map over imagery and overlays a project has already registered.

    It owns no imagery of its own: each layer points at a source or overlay
    belonging to one of the project's campaigns, which is what lets a visualizer
    be set up in seconds and stay in step with the campaign it draws from.
    """

    __tablename__ = "visualizers"
    __table_args__ = (
        CheckConstraint("bbox_west BETWEEN -180 AND 180", name="visualizers_bbox_west_range"),
        CheckConstraint("bbox_east BETWEEN -180 AND 180", name="visualizers_bbox_east_range"),
        CheckConstraint("bbox_south BETWEEN -90 AND 90", name="visualizers_bbox_south_range"),
        CheckConstraint("bbox_north BETWEEN -90 AND 90", name="visualizers_bbox_north_range"),
        CheckConstraint("bbox_west < bbox_east", name="visualizers_bbox_lon_order"),
        CheckConstraint("bbox_south < bbox_north", name="visualizers_bbox_lat_order"),
        CheckConstraint(
            "num_nonnulls(bbox_west, bbox_south, bbox_east, bbox_north) IN (0, 4)",
            name="visualizers_bbox_all_or_none",
        ),
        Index("idx_visualizers_project_id", "project_id"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("data.projects.id", ondelete="CASCADE"), nullable=False
    )
    # The share link's only secret. Unguessable so a public visualizer can be
    # handed out by URL without exposing the project's id space.
    slug: Mapped[str] = mapped_column(String(24), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Publishing is a deliberate act on the visualizer, independent of the
    # project's visibility: an internal project can publish one map.
    is_public: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    # The area this visualizer is about: what it opens framed on, and the extent
    # its own STAC searches are registered over. All four are set together or
    # none are, which is what "no area chosen yet" looks like.
    bbox_west: Mapped[float | None] = mapped_column(Float, nullable=True)
    bbox_south: Mapped[float | None] = mapped_column(Float, nullable=True)
    bbox_east: Mapped[float | None] = mapped_column(Float, nullable=True)
    bbox_north: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_by: Mapped[UUID | None] = mapped_column(
        ForeignKey("auth.users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.current_timestamp(), nullable=False
    )
    # Set while this visualizer's own imagery is being registered, exactly as a
    # campaign tracks its own. pending|registering|ready|failed.
    registration_status: Mapped[str] = mapped_column(
        String(20), server_default="ready", nullable=False
    )
    registration_heartbeat_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    registration_errors: Mapped[list | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )

    project: Mapped["Project"] = relationship()
    # Imagery registered for this visualizer alone. Sources linked from a
    # campaign are not here - those are referenced through `imagery`.
    imagery_sources: Mapped[list["ImagerySource"]] = relationship(
        back_populates="visualizer",
        cascade="all, delete-orphan",
        order_by="ImagerySource.display_order",
    )
    basemaps: Mapped[list["Basemap"]] = relationship(
        back_populates="visualizer",
        cascade="all, delete-orphan",
    )
    # Overlays set up here rather than reused from a campaign. Both kinds also
    # appear in `overlays`, which is the list the viewer draws from.
    custom_maps: Mapped[list["CustomMap"]] = relationship(
        back_populates="visualizer",
        cascade="all, delete-orphan",
        order_by="CustomMap.display_order",
    )
    vector_layers: Mapped[list["VectorLayer"]] = relationship(
        back_populates="visualizer",
        cascade="all, delete-orphan",
        order_by="VectorLayer.display_order",
    )
    imagery: Mapped[list["VisualizerImagery"]] = relationship(
        back_populates="visualizer",
        cascade="all, delete-orphan",
        order_by="VisualizerImagery.display_order",
    )
    overlays: Mapped[list["VisualizerOverlay"]] = relationship(
        back_populates="visualizer",
        cascade="all, delete-orphan",
        order_by="VisualizerOverlay.display_order",
    )


class VisualizerImagery(Base):
    """One browsable imagery source in a visualizer.

    The source's collections and cover slices carry no meaning here - the
    visualizer flattens them into one dated timeline (see ``timeline.py``).
    """

    __tablename__ = "visualizer_imagery"
    __table_args__ = (
        UniqueConstraint("visualizer_id", "source_id", name="uq_visualizer_imagery_source"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    visualizer_id: Mapped[int] = mapped_column(
        ForeignKey("data.visualizers.id", ondelete="CASCADE"), nullable=False
    )
    source_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery_sources.id", ondelete="CASCADE"), nullable=False
    )
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)

    visualizer: Mapped["Visualizer"] = relationship(back_populates="imagery")
    source: Mapped["ImagerySource"] = relationship()


class VisualizerOverlay(Base):
    """One overlay drawn above the imagery, plus how it opens."""

    __tablename__ = "visualizer_overlays"
    __table_args__ = (
        CheckConstraint(
            "(custom_map_id IS NULL) <> (vector_layer_id IS NULL)",
            name="visualizer_overlays_one_target_check",
        ),
        CheckConstraint("opacity BETWEEN 0 AND 1", name="visualizer_overlays_opacity_check"),
        Index("idx_visualizer_overlays_visualizer_id", "visualizer_id"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    visualizer_id: Mapped[int] = mapped_column(
        ForeignKey("data.visualizers.id", ondelete="CASCADE"), nullable=False
    )
    custom_map_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.custom_maps.id", ondelete="CASCADE"), nullable=True
    )
    vector_layer_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.vector_layers.id", ondelete="CASCADE"), nullable=True
    )
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)
    visible: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
    opacity: Mapped[float] = mapped_column(Float, server_default="1", nullable=False)

    visualizer: Mapped["Visualizer"] = relationship(back_populates="overlays")
    custom_map: Mapped["CustomMap | None"] = relationship()
    vector_layer: Mapped["VectorLayer | None"] = relationship()


class VisualizerFeedback(Base):
    """What someone looking at a published map says about a place on it.

    Feedback is about a spot rather than about the visualizer, which is why it
    carries a box. The layer it is about and the class the person proposes are
    both snapshotted as text as well as by id: a legend can be recoloured or a
    layer removed, and the remark has to stay readable afterwards.
    """

    __tablename__ = "visualizer_feedback"
    __table_args__ = (
        CheckConstraint("bbox_west BETWEEN -180 AND 180", name="feedback_bbox_west_range"),
        CheckConstraint("bbox_east BETWEEN -180 AND 180", name="feedback_bbox_east_range"),
        CheckConstraint("bbox_south BETWEEN -90 AND 90", name="feedback_bbox_south_range"),
        CheckConstraint("bbox_north BETWEEN -90 AND 90", name="feedback_bbox_north_range"),
        CheckConstraint("bbox_west < bbox_east", name="feedback_bbox_lon_order"),
        CheckConstraint("bbox_south < bbox_north", name="feedback_bbox_lat_order"),
        CheckConstraint("verdict IN ('good', 'wrong')", name="feedback_verdict_values"),
        # Silence is not feedback: it says how it looks, what it should be, or why.
        CheckConstraint(
            "verdict IS NOT NULL OR suggested_label IS NOT NULL OR note IS NOT NULL",
            name="feedback_says_something_check",
        ),
        Index("idx_visualizer_feedback_visualizer_id", "visualizer_id"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    visualizer_id: Mapped[int] = mapped_column(
        ForeignKey("data.visualizers.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[UUID | None] = mapped_column(
        ForeignKey("auth.users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=func.current_timestamp(), nullable=False
    )
    bbox_west: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_south: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_east: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_north: Mapped[float] = mapped_column(Float, nullable=False)
    overlay_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.visualizer_overlays.id", ondelete="SET NULL"), nullable=True
    )
    layer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # The one-click read on the area, which is what makes a pile of feedback
    # countable rather than only readable.
    verdict: Mapped[FeedbackVerdict | None] = mapped_column(String(16), nullable=True)
    suggested_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    suggested_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # What was on screen: source and date, so the remark can be placed in time.
    viewing: Mapped[str | None] = mapped_column(String(255), nullable=True)

    user: Mapped["User | None"] = relationship()

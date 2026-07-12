from datetime import datetime
from uuid import UUID

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

from src.database import Base


class Campaign(Base):
    """
    Represents an annotation campaign containing imagery, settings, tasks and annotations.
    """

    __tablename__ = "campaigns"
    __table_args__ = {"schema": "data"}

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Campaign metadata
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=False),
        server_default=func.current_timestamp(),
        nullable=False,
    )
    mode: Mapped[str] = mapped_column(String(20), nullable=False)  # tasks or open
    is_public: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    # Mosaic registration status: pending, registering, ready, failed
    registration_status: Mapped[str] = mapped_column(
        String(20), server_default="ready", nullable=False
    )
    # Embedding registration status: pending, registering, ready, failed
    embedding_status: Mapped[str] = mapped_column(
        String(20), server_default="ready", nullable=False
    )
    # Errors from background registration (JSON array, null when no errors)
    registration_errors: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    # Monotonic counter bumped on every annotation create/update/delete. Used as
    # a cache-busting key in annotation vector-tile URLs so edits invalidate the
    # affected tiles without a manual purge.
    annotations_version: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False)

    # Relationships
    settings: Mapped["CampaignSettings"] = relationship(
        back_populates="campaign",
        uselist=False,
        cascade="all, delete-orphan",
    )
    time_series: Mapped[list["TimeSeries"]] = relationship(  # noqa: F821
        back_populates="campaign",
        cascade="all, delete-orphan",
    )
    users = relationship(
        "CampaignUser",
        cascade="all, delete-orphan",
    )
    task_items: Mapped[list["AnnotationTask"]] = relationship(  # noqa: F821
        back_populates="campaign",
        cascade="all, delete-orphan",
    )
    annotations: Mapped[list["Annotation"]] = relationship(  # noqa: F821
        back_populates="campaign",
        cascade="all, delete-orphan",
    )
    imagery_sources: Mapped[list["ImagerySource"]] = relationship(  # noqa: F821
        "ImagerySource",
        back_populates="campaign",
        cascade="all, delete-orphan",
        order_by="ImagerySource.display_order",
    )
    basemaps: Mapped[list["Basemap"]] = relationship(  # noqa: F821
        "Basemap", back_populates="campaign", cascade="all, delete-orphan"
    )
    custom_maps: Mapped[list["CustomMap"]] = relationship(  # noqa: F821
        "CustomMap",
        back_populates="campaign",
        cascade="all, delete-orphan",
        order_by="CustomMap.display_order",
    )
    vector_layers: Mapped[list["VectorLayer"]] = relationship(  # noqa: F821
        "VectorLayer",
        back_populates="campaign",
        cascade="all, delete-orphan",
        order_by="VectorLayer.display_order",
    )
    imagery_views: Mapped[list["ImageryView"]] = relationship(  # noqa: F821
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
        TIMESTAMP(timezone=False),
        server_default=func.current_timestamp(),
        nullable=False,
    )


class CampaignSettings(Base):
    """
    Campaign configuration including labels that can be used for annotation and geographic bounding box.
    """

    __tablename__ = "settings"
    __table_args__ = (
        # Bounding box coordinate ranges
        CheckConstraint("bbox_west BETWEEN -180 AND 180", name="settings_bbox_west_range"),
        CheckConstraint("bbox_east BETWEEN -180 AND 180", name="settings_bbox_east_range"),
        CheckConstraint("bbox_south BETWEEN -90 AND 90", name="settings_bbox_south_range"),
        CheckConstraint("bbox_north BETWEEN -90 AND 90", name="settings_bbox_north_range"),
        # Bounding box logical ordering
        CheckConstraint("bbox_west < bbox_east", name="settings_bbox_lon_order"),
        CheckConstraint("bbox_south < bbox_north", name="settings_bbox_lat_order"),
        {"schema": "data"},
    )

    # Primary key (also foreign key)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # Settings data
    labels: Mapped[dict] = mapped_column(
        JSONB,
        server_default="{}",
        nullable=False,
    )
    bbox_west: Mapped[float] = mapped_column(nullable=False)
    bbox_south: Mapped[float] = mapped_column(nullable=False)
    bbox_east: Mapped[float] = mapped_column(nullable=False)
    bbox_north: Mapped[float] = mapped_column(nullable=False)

    # Year from which to source satellite embeddings (e.g. 2024).
    # NULL means embeddings are not configured / not used.
    embedding_year: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Markdown guide document shown to annotators
    guide_markdown: Mapped[str | None] = mapped_column(String, nullable=True)

    # Side length (in meters) of the square extent around each task centroid.
    # NULL means no extent is drawn (only crosshair shown for point tasks).
    sample_extent_meters: Mapped[float | None] = mapped_column(nullable=True)

    # Who may label what, and whose labels count toward task completion.
    # Shape: {"explore": AUD, "unassigned_tasks": AUD, "assigned_tasks": AUD,
    # "complete_assigned": AUD} where AUD = {"kinds": [...], "user_ids": [...]}.
    # See src/campaigns/schemas.py:LabellingPolicy and
    # docs/labelling-policy.md.
    labelling_policy: Mapped[dict] = mapped_column(
        JSONB,
        server_default=text(
            '\'{"explore": {"kinds": ["members"], "user_ids": []}, '
            '"unassigned_tasks": {"kinds": ["members"], "user_ids": []}, '
            '"assigned_tasks": {"kinds": ["members"], "user_ids": []}, '
            '"complete_assigned": {"kinds": ["assignees", "admins", "authoritative"], '
            '"user_ids": []}}\'::jsonb'
        ),
        nullable=False,
    )

    # Relationships
    campaign: Mapped["Campaign"] = relationship(back_populates="settings")


class CanvasLayout(Base):
    """
    Stores UI canvas layout configuration for views or campaign settings.
    Can be user-specific (personal layout) or serve as a default layout (is_default=True).

    Layout types:
    - Campaign main layout: campaign_id set, view_id NULL
    - View-specific layout: campaign_id set, view_id set
    """

    __tablename__ = "canvas_layouts"
    __table_args__ = (
        CheckConstraint(
            "(is_default = false) OR (is_default = true AND user_id IS NULL)",
            name="canvas_layouts_default_check",
        ),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=True,
    )

    campaign_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=True,
    )

    view_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.imagery_views.id", ondelete="CASCADE"),
        nullable=True,
    )

    is_default: Mapped[bool] = mapped_column(
        server_default="false",
        nullable=False,
    )

    layout_data: Mapped[list] = mapped_column(
        JSONB,
        server_default="[]",
        nullable=False,
    )

    campaign: Mapped["Campaign | None"] = relationship(
        back_populates="canvas_layouts",
    )
    imagery_view: Mapped["ImageryView | None"] = relationship(  # noqa: F821
        back_populates="canvas_layouts",
    )


class CampaignUser(Base):
    """
    Association table linking users to campaigns with role-based access.
    """

    __tablename__ = "campaign_users"
    __table_args__ = ({"schema": "data"},)

    # Composite primary key
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # User roles in campaign
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False)
    is_authorative_reviewer: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Relationships
    user: Mapped["User"] = relationship()  # noqa: F821

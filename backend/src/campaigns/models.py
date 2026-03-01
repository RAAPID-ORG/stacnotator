from datetime import datetime

from sqlalchemy import TIMESTAMP, Boolean, CheckConstraint, ForeignKey, Integer, String, func
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
    mode: Mapped[str | None] = mapped_column(String(20), nullable=False)  # tasks or open-world

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
    imagery: Mapped[list["Imagery"]] = relationship(
        "Imagery", back_populates="campaign", cascade="all, delete-orphan"
    )
    canvas_layouts: Mapped[list["CanvasLayout"]] = relationship(
        "CanvasLayout",
        foreign_keys="[CanvasLayout.campaign_id]",
        back_populates="campaign",
        cascade="all, delete-orphan",
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

    # Relationships
    campaign: Mapped["Campaign"] = relationship(back_populates="settings")


class CanvasLayout(Base):
    """
    Stores UI canvas layout configuration for imagery or campaign settings.
    Can be user-specific (personal layout) or serve as a default layout (is_default=True).

    Layout types:
    - Campaign main layout: campaign_id set, imagery_id NULL
    - Imagery-specific layout: campaign_id set, imagery_id set
    """

    __tablename__ = "canvas_layouts"
    __table_args__ = (
        # Ensure default layouts are not personal (user_id must be NULL)
        CheckConstraint(
            "(is_default = false) OR (is_default = true AND user_id IS NULL)",
            name="canvas_layouts_default_check",
        ),
        {"schema": "data"},
    )

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Foreign keys
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=True,
    )

    campaign_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=True,
    )

    imagery_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.imagery.id", ondelete="CASCADE"),
        nullable=True,
    )

    # Whether this is the default layout (for user_id IS NULL)
    is_default: Mapped[bool] = mapped_column(
        server_default="false",
        nullable=False,
    )

    # Layout data
    layout_data: Mapped[list] = mapped_column(
        JSONB,
        server_default="[]",
        nullable=False,
    )

    # Relationships
    campaign: Mapped["Campaign | None"] = relationship(
        back_populates="canvas_layouts",
    )
    imagery: Mapped["Imagery | None"] = relationship(
        back_populates="canvas_layouts",
    )


class CampaignUser(Base):
    """
    Association table linking users to campaigns with role-based access.
    """

    __tablename__ = "campaign_users"
    __table_args__ = ({"schema": "data"},)

    # Composite primary key
    user_id: Mapped[int] = mapped_column(
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

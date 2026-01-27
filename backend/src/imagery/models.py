from typing import Optional

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database import Base


class ImageryWindow(Base):
    """
    Represents a time window within an imagery's date range.
    Windows provide multiple views of the same imagery over different time periods.
    They will typically all be disaplayed together for annotation.
    """

    __tablename__ = "imagery_windows"
    __table_args__ = {"schema": "data"}

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Foreign keys
    imagery_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Window time range (YYYYMMDD format)
    window_start_date: Mapped[str] = mapped_column(String(8), nullable=False)
    window_end_date: Mapped[str] = mapped_column(String(8), nullable=False)

    # Index of the window within the imagery
    window_index: Mapped[int] = mapped_column(Integer, nullable=False)

    # Relationships
    imagery: Mapped["Imagery"] = relationship(back_populates="windows")


class Imagery(Base):
    """
    Represents satellite or aerial imagery configuration for a campaign.
    Includes STAC search parameters and temporal windowing settings.
    """

    __tablename__ = "imagery"
    __table_args__ = (
        CheckConstraint("default_zoom BETWEEN 0 AND 22", name="imagery_default_zoom_check"),
        CheckConstraint(
            "window_unit IN ('days', 'months', 'years') OR window_unit IS NULL",
            name="imagery_window_unit_check",
        ),
        {"schema": "data"},
    )

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Foreign keys
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Imagery metadata
    name: Mapped[str] = mapped_column(String, nullable=False)
    start_ym: Mapped[str] = mapped_column(String(6), nullable=False)  # YYYYMM
    end_ym: Mapped[str] = mapped_column(String(6), nullable=False)  # YYYYMM

    # Display settings
    crosshair_hex6: Mapped[str] = mapped_column(
        String(6),
        server_default="ff0000",
        nullable=False,
    )
    default_zoom: Mapped[int] = mapped_column(
        SmallInteger,
        server_default="12",
        nullable=False,
    )

    # ID of the window to show by default on the main canvas
    default_main_window_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )

    # Temporal windowing configuration
    window_interval: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    window_unit: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # Temporal slicing configuration (within windows)
    slicing_interval: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    slicing_unit: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # STAC search configuration
    registration_url: Mapped[str] = mapped_column(String, nullable=False)
    search_body: Mapped[dict] = mapped_column(JSONB, nullable=False)

    # Relationships
    campaign: Mapped["Campaign"] = relationship(back_populates="imagery")  # noqa: F821
    visualization_url_templates: Mapped[list["ImageryVisualizationUrlTemplate"]] = relationship(
        back_populates="imagery",
        cascade="all, delete-orphan",
    )
    windows: Mapped[list["ImageryWindow"]] = relationship(
        back_populates="imagery",
        cascade="all, delete-orphan",
    )
    canvas_layouts: Mapped[list["CanvasLayout"]] = relationship(  # noqa: F821
        "CanvasLayout",
        foreign_keys="[CanvasLayout.imagery_id]",
        back_populates="imagery",
        cascade="all, delete-orphan",
    )


class ImageryVisualizationUrlTemplate(Base):
    """
    Stores URL templates for different imagery visualization styles from TiTiler.
    Each imagery can have multiple visualization options.
    """

    __tablename__ = "imagery_visualization_url_templates"
    __table_args__ = {"schema": "data"}

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Foreign keys
    imagery_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Visualization data
    name: Mapped[str] = mapped_column(String, nullable=False)
    visualization_url: Mapped[str] = mapped_column(String, nullable=False)

    # Relationships
    imagery: Mapped["Imagery"] = relationship(back_populates="visualization_url_templates")

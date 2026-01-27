from geoalchemy2 import Geometry as GeoAlchemyGeometry
from typing import Optional
from uuid import UUID

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.campaigns.models import Campaign
from src.database import Base


class AnnotationGeometry(Base):
    """Stores geometry data for annotations and annotation tasks."""

    __tablename__ = "annotation_geometries"
    __table_args__ = {"schema": "data"}

    # Primary key
    id: Mapped[int] = mapped_column(
        Integer,
        Identity(always=True),
        primary_key=True,
    )

    # Geometry data (PostGIS)
    geometry: Mapped[str] = mapped_column(
        GeoAlchemyGeometry(geometry_type="GEOMETRY", srid=4326),
        nullable=False,
    )


class AnnotationTaskItem(Base):
    """
    Represents a single annotation task assigned within a campaign.
    Each task item has a unique annotation number within its campaign.
    """

    __tablename__ = "annotation_task_items"
    __table_args__ = (
        Index("idx_task_items_campaign_id", "campaign_id"),
        UniqueConstraint("campaign_id", "annotation_number"),
        {"schema": "data"},
    )

    # Primary key
    id: Mapped[int] = mapped_column(
        Integer,
        Identity(always=True),
        primary_key=True,
    )

    # Within Campaign identification
    annotation_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    # Foreign keys
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )

    geometry_id: Mapped[int] = mapped_column(
        ForeignKey("data.annotation_geometries.id", ondelete="CASCADE"),
        nullable=False,
    )

    assigned_user_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("auth.users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Task metadata
    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default="pending",
    )

    raw_source_data: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
    )

    # Relationships
    campaign: Mapped["Campaign"] = relationship(back_populates="task_items")
    geometry: Mapped[AnnotationGeometry] = relationship()
    assigned_user: Mapped[Optional["User"]] = relationship()  # noqa: F821
    annotation: Mapped[Optional["Annotation"]] = relationship(
        foreign_keys="[Annotation.annotation_task_item_id]",
        back_populates="annotation_task_item",
        uselist=False,
    )


class Annotation(Base):
    """
    Represents a completed annotation with label and optional comment.
    Can be created from a task item or standalone. Each task item can have
    at most one annotation (enforced by unique constraint).
    If no label is set, it indicates that the annotation was skipped with a comment.
    """

    __tablename__ = "annotations"
    __table_args__ = (
        Index("idx_annotations_campaign_id", "campaign_id"),
        UniqueConstraint("annotation_task_item_id", name="uq_annotation_task_item_id"),
        {"schema": "data"},
    )

    # Primary key
    id: Mapped[int] = mapped_column(
        Integer,
        Identity(always=True),
        primary_key=True,
    )

    # Foreign keys
    geometry_id: Mapped[int] = mapped_column(
        ForeignKey("data.annotation_geometries.id", ondelete="CASCADE"),
        nullable=False,
    )

    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )

    created_by_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Optional: set if annotation was created from a task
    annotation_task_item_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("data.annotation_task_items.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Annotation data
    label_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Audit fields
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    campaign: Mapped["Campaign"] = relationship(back_populates="annotations")
    geometry: Mapped[AnnotationGeometry] = relationship()
    annotation_task_item: Mapped[Optional["AnnotationTaskItem"]] = relationship(
        back_populates="annotation",
    )

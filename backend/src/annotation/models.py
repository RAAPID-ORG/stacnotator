from datetime import datetime as dt_datetime
from uuid import UUID

import sqlalchemy as sa
from geoalchemy2 import Geometry as GeoAlchemyGeometry
from pgvector.sqlalchemy import Vector
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

from src.auth.models import User
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


class AnnotationTask(Base):
    """
    Represents a single annotation task assigned within a campaign.
    Each task item has a unique annotation number within its campaign.
    """

    __tablename__ = "annotation_tasks"
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

    # Additional columns if ingested from a csv
    raw_source_data: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    # Relationships
    campaign: Mapped["Campaign"] = relationship(back_populates="task_items")
    geometry: Mapped[AnnotationGeometry] = relationship()
    assignments: Mapped[list["AnnotationTaskAssignment"]] = relationship(
        "AnnotationTaskAssignment",
        foreign_keys="[AnnotationTaskAssignment.task_id]",
        back_populates="annotation_task",
        cascade="all, delete-orphan",
    )
    annotations: Mapped[list["Annotation"]] = relationship(
        "Annotation",
        foreign_keys="[Annotation.annotation_task_id]",
        back_populates="annotation_task",
    )


class AnnotationTaskAssignment(Base):
    """
    Assignment from annotation task to a user.
    """

    __tablename__ = "annotation_tasks_assignment"
    __table_args__ = (
        Index("idx_annotation_tasks_assignment_task_id", "task_id"),
        UniqueConstraint("task_id", "user_id"),
        {"schema": "data"},
    )

    # Primary key
    id: Mapped[int] = mapped_column(
        Integer,
        Identity(always=True),
        primary_key=True,
    )

    # Foreign keys
    task_id: Mapped[int] = mapped_column(
        ForeignKey("data.annotation_tasks.id", ondelete="CASCADE"), nullable=False
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"), nullable=False
    )

    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default="pending",
    )

    # Relationships
    annotation_task: Mapped["AnnotationTask"] = relationship(
        back_populates="assignments",
    )
    user: Mapped["User | None"] = relationship()


class Annotation(Base):
    """
    Represents a completed annotation with label and optional comment.
    Can be created from a task or standalone. Multiple users can annotate
    the same task for quality assurance purposes.
    If no label is set, it indicates that the annotation was skipped with a comment.
    """

    __tablename__ = "annotations"
    __table_args__ = (
        Index("idx_annotations_campaign_id", "campaign_id"),
        Index("idx_annotations_task_id", "annotation_task_id"),
        UniqueConstraint(
            "annotation_task_id",
            "created_by_user_id",
            name="uq_annotation_task_user",
        ),
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
    annotation_task_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.annotation_tasks.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Annotation data
    label_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_authoritative: Mapped[bool] = mapped_column(
        sa.Boolean,
        nullable=False,
        server_default=sa.false(),
    )

    # Audit fields
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    campaign: Mapped["Campaign"] = relationship(back_populates="annotations")
    geometry: Mapped[AnnotationGeometry] = relationship()
    annotation_task: Mapped["AnnotationTask | None"] = relationship(
        back_populates="annotations",
    )


class Embedding(Base):
    """Stores a 64-D embedding vector linked to an annotation task."""

    __tablename__ = "embeddings"
    __table_args__ = (
        Index(
            "idx_embeddings_vector_cosine",
            "vector",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"vector": "vector_cosine_ops"},
        ),
        {"schema": "data"},
    )

    # Primary key
    id: Mapped[int] = mapped_column(
        Integer,
        Identity(always=True),
        primary_key=True,
    )

    # Foreign key to the task this embedding belongs to
    annotation_task_id: Mapped[int] = mapped_column(
        ForeignKey("data.annotation_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 64-D embedding vector (pgvector)
    vector = mapped_column(Vector(64), nullable=False)

    # Location & time metadata (for provenance / cache lookups)
    lat: Mapped[float] = mapped_column(sa.Float, nullable=False)
    lon: Mapped[float] = mapped_column(sa.Float, nullable=False)
    period_start: Mapped[dt_datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[dt_datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Relationships
    annotation_task: Mapped["AnnotationTask"] = relationship()

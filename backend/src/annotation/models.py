from datetime import datetime as dt_datetime
from typing import TYPE_CHECKING
from uuid import UUID

import sqlalchemy as sa
from geoalchemy2.elements import WKBElement, WKTElement
from sqlalchemy import (
    CheckConstraint,
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
from src.geometry import geometry_column

if TYPE_CHECKING:
    from src.tasks.models import Task


class DeletedAnnotation(Base):
    """A tombstone: the one change to an annotation that leaves no row to read.

    Written in the same transaction as the delete, so another annotator's map
    can learn about it from the same poll that carries creates and edits.
    Nothing else reads this table, and rows are pruned past
    ``DELETION_RETENTION`` - see ``service.record_annotation_deletions``.
    """

    __tablename__ = "deleted_annotations"
    __table_args__ = (
        Index("idx_deleted_annotations_campaign_deleted_at", "campaign_id", "deleted_at"),
        {"schema": "data"},
    )

    # The annotation's own id, kept as the key: ids are never reused, and the
    # id is the whole point - it is what the map hides.
    annotation_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)

    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )

    deleted_at: Mapped[dt_datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class Annotation(Base):
    """
    A labelled shape. Either a task's row for one annotator (task_id,
    which records the outcome, skips included), or standalone: drawn in Explore
    (optionally remembering origin_task_id) or as a draw task's answer
    (output_of_task_id).
    """

    if TYPE_CHECKING:
        # Not a column: attached per request by tasks/completion.py on
        # task-linked rows (bool); standalone rows never get it.
        counts_toward_completion: bool | None

    __tablename__ = "annotations"
    __table_args__ = (
        Index("idx_annotations_campaign_id", "campaign_id"),
        Index("idx_annotations_task_id", "task_id"),
        Index("idx_annotations_origin_task_id", "origin_task_id"),
        Index("idx_annotations_output_of_task_id", "output_of_task_id"),
        CheckConstraint(
            "num_nonnulls(task_id, origin_task_id, output_of_task_id) <= 1",
            name="annotations_single_task_link",
        ),
        CheckConstraint(
            "outcome IS NULL OR outcome IN ('labelled', 'skipped', 'drawn', 'none_found')",
            name="annotations_outcome_values",
        ),
        CheckConstraint(
            "(task_id IS NULL) = (outcome IS NULL)",
            name="annotations_task_row_has_outcome",
        ),
        CheckConstraint(
            "outcome IS NULL OR (outcome = 'labelled') = (label_id IS NOT NULL)",
            name="annotations_outcome_label_match",
        ),
        Index("idx_annotations_geometry", "geometry", postgresql_using="gist"),
        Index("idx_annotations_created_by_user_id", "created_by_user_id"),
        Index("idx_annotations_imagery_slice_id", "imagery_slice_id"),
        # Backs the annotation changes poll: one annotator picking up another's
        # work must not scan the campaign.
        Index("idx_annotations_campaign_updated_at", "campaign_id", "updated_at"),
        UniqueConstraint(
            "task_id",
            "created_by_user_id",
            name="uq_annotations_task_user",
        ),
        UniqueConstraint(
            "campaign_id",
            "source_id",
            name="uq_annotation_campaign_source",
        ),
        CheckConstraint(
            "confidence IS NULL OR (confidence >= 0 AND confidence <= 10)",
            name="annotations_confidence_range",
        ),
        CheckConstraint(
            "flagged_for_review = true OR flag_comment IS NULL",
            name="annotations_flag_comment_requires_flag",
        ),
        {"schema": "data"},
    )

    # Primary key
    id: Mapped[int] = mapped_column(
        Integer,
        Identity(always=True),
        primary_key=True,
    )

    # A task's answer starts out on the task's geometry and keeps its own copy, so
    # moving one never moves the other.
    geometry: Mapped[WKBElement | WKTElement] = geometry_column()

    # Foreign keys
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )

    created_by_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Set on a task row: this annotator's answer to the task, which dies with it.
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.tasks.id", ondelete="CASCADE"),
        nullable=True,
    )

    # The task the annotator was on when they drew this standalone annotation;
    # never set on a task's own annotation.
    origin_task_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.tasks.id", ondelete="SET NULL"),
        nullable=True,
    )

    # The draw task this shape was drawn as the answer to.
    output_of_task_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.tasks.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Imagery the annotator was viewing in the main window when drawing/editing.
    # The FK gives traceability; the snapshotted dates survive slice edits/deletes.
    imagery_slice_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.imagery_slices.id", ondelete="SET NULL"),
        nullable=True,
    )
    imagery_source_name: Mapped[str | None] = mapped_column(String, nullable=True)
    imagery_start_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    imagery_end_date: Mapped[str | None] = mapped_column(String(10), nullable=True)

    # Stable identifier carried over from a bulk feature import (the source
    # file's stacnotator_annotation_id). NULL for annotations drawn in-app.
    # Unique per campaign so re-importing the same file is rejected.
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Annotation data
    label_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Set on every task row (see TaskOutcome), never on a drawn shape.
    outcome: Mapped[str | None] = mapped_column(String(20), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Notes the annotator attached to individual imagery slices, one per slice.
    # Each entry snapshots the slice's source and dates for the same reason the
    # columns above do: it stays readable after the slice is re-registered.
    # Shaped by annotation.schemas.SliceComment.
    slice_comments: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    form_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    confidence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_authoritative: Mapped[bool] = mapped_column(
        sa.Boolean,
        nullable=False,
        server_default=sa.false(),
    )
    flagged_for_review: Mapped[bool] = mapped_column(
        sa.Boolean,
        nullable=False,
        server_default=sa.false(),
    )
    flag_comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Active seconds the author spent on this task, accumulated across submits.
    # NULL means never measured, which keeps rows predating the measurement out
    # of the duration statistics rather than averaging them in as zero.
    active_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Audit fields
    created_at: Mapped[dt_datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    updated_at: Mapped[dt_datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    campaign: Mapped["Campaign"] = relationship(back_populates="annotations")
    task: Mapped["Task | None"] = relationship(
        foreign_keys=[task_id],
        back_populates="annotations",
    )
    origin_task: Mapped["Task | None"] = relationship(foreign_keys=[origin_task_id])
    output_of_task: Mapped["Task | None"] = relationship(foreign_keys=[output_of_task_id])
    creator: Mapped["User"] = relationship()

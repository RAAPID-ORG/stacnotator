from datetime import datetime
from datetime import datetime as dt_datetime
from typing import TYPE_CHECKING
from uuid import UUID

from geoalchemy2.elements import WKBElement, WKTElement
from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    DateTime,
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

from src.auth.models import User
from src.campaigns.models import Campaign
from src.database import Base
from src.geometry import geometry_column

if TYPE_CHECKING:
    from src.annotation.models import Annotation


class Task(Base):
    """
    Represents a single annotation task assigned within a campaign.
    Each task item has a unique annotation number within its campaign.
    """

    if TYPE_CHECKING:
        # Not a column: attached per request by annotation/service.py, which
        # looks each up in one query rather than per task.
        has_embedding: bool
        nearby_annotation_count: int
        drawn_by_user_ids: list[UUID]

    __tablename__ = "annotation_tasks"
    __table_args__ = (
        Index("idx_task_items_campaign_id", "campaign_id"),
        UniqueConstraint("campaign_id", "annotation_number"),
        Index("idx_annotation_tasks_task_set_id", "task_set_id"),
        Index("idx_annotation_tasks_geometry", "geometry", postgresql_using="gist"),
        Index(
            "idx_annotation_tasks_embedding_cosine",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        # One live claim per user per campaign, enforced by the database rather
        # than by remembering to release the previous one.
        Index(
            "uq_annotation_tasks_one_claim_per_user",
            "campaign_id",
            "claimed_by_user_id",
            unique=True,
            postgresql_where=text("claimed_by_user_id IS NOT NULL"),
        ),
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

    geometry: Mapped[WKBElement | WKTElement] = geometry_column()
    # The location's 64-D AlphaEarth embedding (pgvector), once it has been fetched.
    # Deferred: task lists never need it, only the similarity queries do.
    embedding = mapped_column(Vector(64), nullable=True, deferred=True)

    task_set_id: Mapped[int] = mapped_column(
        ForeignKey("data.task_sets.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Additional columns if ingested from a csv
    raw_source_data: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    # The soft claim: who is working on this task right now, and since when.
    # A lease, not an assignment - it expires (CLAIM_TTL_MINUTES), it never
    # decides who may label, and it is deliberately not a row in
    # annotation_tasks_assignment so that nothing reading assignments sees it.
    claimed_by_user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("auth.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    claimed_at: Mapped[dt_datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    campaign: Mapped["Campaign"] = relationship(back_populates="task_items")
    claimed_by: Mapped["User | None"] = relationship(foreign_keys=[claimed_by_user_id])
    assignments: Mapped[list["TaskAssignment"]] = relationship(
        "TaskAssignment",
        foreign_keys="[TaskAssignment.task_id]",
        back_populates="annotation_task",
        cascade="all, delete-orphan",
    )
    annotations: Mapped[list["Annotation"]] = relationship(
        "Annotation",
        foreign_keys="[Annotation.annotation_task_id]",
        back_populates="annotation_task",
    )


class TaskAssignment(Base):
    """A user an admin put on a task.

    Admin intent only. A user who picks a task out of the unassigned pool
    never gets a row here - their claim lives on the task and their work
    lives on the annotation - which is what keeps `bool(task.assignments)`
    an honest answer to "is this task assigned" for the labelling policy.
    Per-assignee status is derived from the annotations, not stored.
    """

    __tablename__ = "annotation_tasks_assignment"
    __table_args__ = (
        Index("idx_annotation_tasks_assignment_task_id", "task_id"),
        Index("idx_annotation_tasks_assignment_user_id", "user_id"),
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

    # True if this assignment is a review of another user's annotation work,
    # rather than a primary annotation assignment. Reviewers are only added to
    # tasks that already have a primary (non-review) assignment.
    is_review: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )

    # Relationships
    annotation_task: Mapped["Task"] = relationship(
        back_populates="assignments",
    )
    user: Mapped["User | None"] = relationship()


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

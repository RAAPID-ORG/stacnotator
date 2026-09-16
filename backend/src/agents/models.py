from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.auth.models import User
from src.database import Base


class LabellingAgent(Base):
    """An automated annotator working a campaign on behalf of a user.

    The agent is a user row of its own, so assignments, annotations, statistics
    and the review page treat it like any other annotator. This row only adds
    who runs it and what it looks at by default.
    """

    __tablename__ = "labelling_agents"
    __table_args__ = (
        Index("idx_labelling_agents_owner_campaign", "owner_user_id", "campaign_id"),
        {"schema": "data"},
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"), primary_key=True
    )
    owner_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"), nullable=False
    )
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"), nullable=False
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Shaped by agents.schemas.ViewSpec. Rendered ahead for upcoming tasks.
    default_views: Mapped[list] = mapped_column(JSONB, nullable=False)
    # Last time a render host of the owner asked for work in this campaign.
    host_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(foreign_keys=[user_id])


class AgentRenderJob(Base):
    """One view of one task an agent wants to see, rendered by a browser.

    Tiles are fetched and composed by the owner's open render host page, never
    on the server, so this table is the hand-off: the agent's request writes a
    pending row, the host claims and fills it, the request reads it back.
    """

    __tablename__ = "agent_render_jobs"
    __table_args__ = (
        UniqueConstraint("agent_user_id", "task_id", "view_key"),
        Index("idx_agent_render_jobs_pending", "status", "priority", "created_at"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    agent_user_id: Mapped[UUID] = mapped_column(
        ForeignKey("data.labelling_agents.user_id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[int] = mapped_column(
        ForeignKey("data.annotation_tasks.id", ondelete="CASCADE"), nullable=False
    )
    view_key: Mapped[str] = mapped_column(String(64), nullable=False)
    view: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # pending -> rendering -> done | failed
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="pending")
    # 0 = an agent is waiting on it, 1 = rendered ahead
    priority: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="1")
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    image: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

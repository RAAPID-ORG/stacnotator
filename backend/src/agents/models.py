from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Text, false, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.auth.models import User
from src.database import Base


class LabellingAgent(Base):
    """An automated annotator working a campaign on behalf of a user.

    The agent is a user row of its own, so assignments, annotations, statistics
    and the review page treat it like any other annotator. This row only adds
    who runs it.
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
    # When its own tasks run out, take over tasks still waiting on its owner's other
    # agents in the campaign.
    takes_over_work: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(foreign_keys=[user_id])

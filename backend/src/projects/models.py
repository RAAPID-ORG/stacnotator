from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database import Base
from src.organizations.models import Organization

if TYPE_CHECKING:
    from src.auth.models import User
    from src.campaigns.models import Campaign


class Project(Base):
    """The membership unit: users belong to projects; campaigns belong to
    exactly one project and inherit its access rules."""

    __tablename__ = "projects"
    __table_args__ = (
        Index("projects_organization_id_idx", "organization_id"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("data.organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    created_by: Mapped[UUID | None] = mapped_column(
        ForeignKey("auth.users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )

    organization: Mapped[Organization] = relationship()
    users: Mapped[list["ProjectUser"]] = relationship(cascade="all, delete-orphan")
    campaigns: Mapped[list["Campaign"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )


class ProjectUser(Base):
    """Project membership with project-wide roles. Lifted from the former
    campaign_users table; roles apply to every campaign in the project."""

    __tablename__ = "project_users"
    __table_args__ = (
        Index("project_users_project_id_idx", "project_id"),
        {"schema": "data"},
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"), primary_key=True
    )
    project_id: Mapped[int] = mapped_column(
        ForeignKey("data.projects.id", ondelete="CASCADE"), primary_key=True
    )
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False)
    is_authoritative_reviewer: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )

    user: Mapped["User"] = relationship()

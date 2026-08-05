from datetime import datetime
from typing import TYPE_CHECKING
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
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database import Base

if TYPE_CHECKING:
    from src.auth.models import User

ORG_STATUS_PENDING = "pending"
ORG_STATUS_APPROVED = "approved"
ORG_STATUS_REJECTED = "rejected"

MEMBER_STATUS_PENDING = "pending"
MEMBER_STATUS_ACTIVE = "active"


class Organization(Base):
    """A tenant: owns projects, members, and tiler permissions. Requested by a
    user, unusable until a platform admin approves it."""

    __tablename__ = "organizations"
    __table_args__ = (
        UniqueConstraint("name", name="organizations_name_uniq"),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="organizations_status_check",
        ),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), server_default=ORG_STATUS_PENDING, nullable=False
    )
    # Whether this org's imagery may point at internal storage read through the
    # tiler's Azure managed identity. Platform-admin controlled.
    allows_internal_storage: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )
    created_by: Mapped[UUID | None] = mapped_column(
        ForeignKey("auth.users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )

    users: Mapped[list["OrganizationUser"]] = relationship(
        cascade="all, delete-orphan",
        back_populates="organization",
    )
    tilers: Mapped[list["OrganizationTiler"]] = relationship(
        cascade="all, delete-orphan",
    )

    @property
    def allowed_tiler_names(self) -> list[str]:
        return [t.tiler_name for t in self.tilers]


class OrganizationUser(Base):
    """Org membership. `pending` rows come from the join link (Phase 3) and
    grant nothing until an org admin approves them."""

    __tablename__ = "organization_users"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'active')",
            name="organization_users_status_check",
        ),
        Index("organization_users_organization_id_idx", "organization_id"),
        {"schema": "data"},
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"), primary_key=True
    )
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("data.organizations.id", ondelete="CASCADE"), primary_key=True
    )
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(
        String(20), server_default=MEMBER_STATUS_ACTIVE, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )

    organization: Mapped["Organization"] = relationship(back_populates="users")
    user: Mapped["User"] = relationship()


class OrganizationTiler(Base):
    """Tilers this org may use, granted by platform admins."""

    __tablename__ = "organization_tilers"
    __table_args__ = ({"schema": "data"},)

    organization_id: Mapped[int] = mapped_column(
        ForeignKey("data.organizations.id", ondelete="CASCADE"), primary_key=True
    )
    tiler_name: Mapped[str] = mapped_column(String(64), primary_key=True)

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
    Uuid,
    func,
    text,
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
    api_keys: Mapped[list["OrganizationApiKey"]] = relationship(
        cascade="all, delete-orphan",
    )

    @property
    def allowed_tiler_names(self) -> list[str]:
        return [t.tiler_name for t in self.tilers]


class OrganizationUser(Base):
    """Org membership. `pending` rows are access requests: a registered user
    asked to join and an org admin has not decided yet. They grant nothing -
    every access check requires `active`."""

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
    # What the requester wrote when asking to join. Only informs the admin's
    # decision, so approval clears it.
    request_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )

    organization: Mapped["Organization"] = relationship(back_populates="users")
    user: Mapped["User"] = relationship()


class OrganizationApiKey(Base):
    """A provider API key an org admin stores once, so every campaign in the
    org can point its imagery at it instead of pasting the same secret again -
    and so rotating it is one edit rather than one per campaign.

    Same AES-256-GCM ciphertext as the per-campaign keys (src/crypto.py); it is
    decrypted only by the tile proxy and never leaves the backend."""

    __tablename__ = "organization_api_keys"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="organization_api_keys_name_uniq"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("data.organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    encrypted_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[UUID | None] = mapped_column(
        ForeignKey("auth.users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )


class OrganizationTiler(Base):
    """Tilers this org may use, granted by platform admins."""

    __tablename__ = "organization_tilers"
    __table_args__ = ({"schema": "data"},)

    organization_id: Mapped[int] = mapped_column(
        ForeignKey("data.organizations.id", ondelete="CASCADE"), primary_key=True
    )
    tiler_name: Mapped[str] = mapped_column(String(64), primary_key=True)


class Invite(Base):
    """Pre-authorization for an email with no account yet, targeting exactly
    one organization or one project. Consumed silently at registration
    (auth.service.register_user), turning into the matching membership row.
    No email is sent; the admin relays the sign-up instruction."""

    __tablename__ = "invites"
    __table_args__ = (
        CheckConstraint(
            "(organization_id IS NULL) != (project_id IS NULL)",
            name="invites_exactly_one_target_check",
        ),
        Index("invites_email_idx", "email"),
        # One pending invite per email+target; COALESCE folds the NULL half of
        # the XOR pair so duplicates collide (ids are Identity, never 0).
        Index(
            "invites_pending_target_uniq",
            "email",
            text("COALESCE(organization_id, 0)"),
            text("COALESCE(project_id, 0)"),
            unique=True,
            postgresql_where=text("consumed_at IS NULL"),
        ),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=True), primary_key=True)
    # Lowercased on write (normalize_emails); matched against the lowercased
    # email of every newly registered user.
    email: Mapped[str] = mapped_column(Text, nullable=False)
    organization_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.organizations.id", ondelete="CASCADE"), nullable=True
    )
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.projects.id", ondelete="CASCADE"), nullable=True
    )
    invited_by: Mapped[UUID | None] = mapped_column(
        ForeignKey("auth.users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )
    consumed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    consumed_by: Mapped[UUID | None] = mapped_column(Uuid, nullable=True)

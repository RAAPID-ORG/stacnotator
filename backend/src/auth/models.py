import uuid
from uuid import UUID

from sqlalchemy import (
    TIMESTAMP,
    CheckConstraint,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.auth.constants import ROLE_ADMIN, ROLE_APPROVED, ROLE_USER
from src.database import Base


class User(Base):
    """
    Represents an authenticated user in the system.
    Supports external identity providers with role-based access control.
    """

    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("issuer", "external_uid", name="users_issuer_external_uid_uniq"),
        UniqueConstraint("email", name="users_email_uniq"),
        {"schema": "auth"},
    )

    # Primary key
    id: Mapped[UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )

    # External identity provider data
    issuer: Mapped[str] = mapped_column(Text, nullable=False)
    external_uid: Mapped[str] = mapped_column(Text, nullable=False)

    # User profile
    email: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit timestamps
    created_at: Mapped[str] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )
    last_login: Mapped[str] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )

    # Relationships
    roles = relationship(
        "UserRole",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    @property
    def is_approved(self) -> bool:
        """Check if user has the approved role."""
        return any(r.role == ROLE_APPROVED for r in self.roles)

    @property
    def is_admin(self) -> bool:
        """Check if user has the admin role."""
        return any(r.role == ROLE_ADMIN for r in self.roles)


class UserRole(Base):
    """
    Association table for user roles with role validation.
    Composite primary key of user_id and role allows multiple roles per user.
    """

    __tablename__ = "user_roles"
    __table_args__ = (
        CheckConstraint(
            f"role IN ('{ROLE_USER}', '{ROLE_APPROVED}', '{ROLE_ADMIN}')",
            name="user_roles_role_check",
        ),
        Index("user_roles_user_id_idx", "user_id"),
        {"schema": "auth"},
    )

    # Composite primary key
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    role: Mapped[str] = mapped_column(Text, primary_key=True)

    # Relationships
    user = relationship("User", back_populates="roles")

import uuid
from datetime import datetime
from uuid import UUID

from sqlalchemy import TIMESTAMP, Boolean, Index, Text, UniqueConstraint, false, func, text
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class User(Base):
    """
    Represents an authenticated user in the system.
    Supports external identity providers.
    """

    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("issuer", "external_uid", name="users_issuer_external_uid_uniq"),
        UniqueConstraint("email", name="users_email_uniq"),
        # Usernames are unique regardless of case.
        Index("users_display_name_lower_uniq", text("lower(display_name)"), unique=True),
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

    # Version of the terms this user accepted; null until they have accepted any.
    # No separate timestamp: the app is gated until acceptance, so created_at
    # bounds when it happened.
    terms_accepted_version: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Audit timestamps
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )

    # Platform-wide administration. Organization and project rights live on
    # their membership rows.
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)

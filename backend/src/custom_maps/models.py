import uuid
from datetime import datetime
from uuid import UUID

from geoalchemy2 import Geometry
from sqlalchemy import (
    TIMESTAMP,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base

STATUS_PENDING = "pending"
STATUS_PROCESSING = "processing"
STATUS_READY = "ready"
STATUS_FAILED = "failed"


class CustomMap(Base):
    """A user-uploaded map (e.g. classification raster) overlaid on imagery for a campaign."""

    __tablename__ = "custom_maps"
    __table_args__ = (
        CheckConstraint(
            f"status IN ('{STATUS_PENDING}', '{STATUS_PROCESSING}', "
            f"'{STATUS_READY}', '{STATUS_FAILED}')",
            name="custom_maps_status_check",
        ),
        Index("ix_custom_maps_campaign_order", "campaign_id", "display_order"),
        Index("ix_custom_maps_bounds", "bounds", postgresql_using="gist"),
        {"schema": "data"},
    )

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )
    uploaded_by_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), server_default=STATUS_PENDING, nullable=False)
    source_path: Mapped[str] = mapped_column(Text, nullable=False)
    cog_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    bounds = mapped_column(Geometry("POLYGON", srid=4326), nullable=True)
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)
    # Mirrors collection_stac_configs.viz_params; baked into the tile URL on the wire.
    viz_params: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    band_count: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    min_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        server_default=func.current_timestamp(),
        nullable=False,
    )

from datetime import datetime

from sqlalchemy import ForeignKey, Integer, SmallInteger, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import DateTime

from src.database import Base


class CustomMap(Base):
    """A campaign-scoped single-band prediction map (COG) rendered as an overlay."""

    __tablename__ = "custom_maps"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    cog_url: Mapped[str] = mapped_column(Text, nullable=False)
    render_config: Mapped[dict] = mapped_column(JSONB, nullable=False)
    max_native_zoom: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    mosaic_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tile_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), server_default="registering", nullable=False)
    status_error: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)
    mlops_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    campaign: Mapped["Campaign"] = relationship(back_populates="custom_maps")  # noqa: F821

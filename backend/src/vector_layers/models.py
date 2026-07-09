from datetime import datetime

from sqlalchemy import ForeignKey, Integer, SmallInteger, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import DateTime

from src.database import Base


class VectorLayer(Base):
    """A campaign-scoped PMTiles vector layer rendered client-side in open mode.

    Unlike ``CustomMap`` (a COG registered on the tiler), a vector layer is just a
    ``.pmtiles`` URL the frontend reads directly via HTTP range requests, so there
    is no tiler registration and no status lifecycle - the row is usable as soon as
    it is created.
    """

    __tablename__ = "vector_layers"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    pmtiles_url: Mapped[str] = mapped_column(Text, nullable=False)
    # Optional MVT source-layer name to render; null renders every layer in the file.
    source_layer: Mapped[str | None] = mapped_column(String, nullable=True)
    color: Mapped[str] = mapped_column(String(9), server_default="#3b82f6", nullable=False)
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    campaign: Mapped["Campaign"] = relationship(back_populates="vector_layers")  # noqa: F821

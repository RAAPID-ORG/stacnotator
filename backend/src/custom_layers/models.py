from datetime import datetime

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import DateTime

from src.database import Base


class CustomMap(Base):
    """A campaign-scoped single-band prediction map (COG) rendered as an overlay."""

    __tablename__ = "custom_maps"
    __table_args__ = (
        UniqueConstraint("campaign_id", "name", name="uq_custom_maps_campaign_name"),
        {"schema": "data"},
    )

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
    # COG lives in internal storage the tiler reads with its managed identity. Only internal
    # users may enable this (enforced in the router); it drives the tiler's asset_signer marker.
    internal_storage: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    campaign: Mapped["Campaign"] = relationship(back_populates="custom_maps")  # noqa: F821


class VectorLayer(Base):
    """A campaign-scoped PMTiles vector layer rendered client-side in open mode.

    Unlike ``CustomMap`` (a COG registered on the tiler), a vector layer is just a
    ``.pmtiles`` URL the frontend reads directly via HTTP range requests, so there
    is no tiler registration and no status lifecycle - the row is usable as soon as
    it is created.
    """

    __tablename__ = "vector_layers"
    __table_args__ = (
        Index("idx_vector_layers_campaign_id", "campaign_id"),
        {"schema": "data"},
    )

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

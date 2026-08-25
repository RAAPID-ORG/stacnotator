from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
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
from src.layers import LayerOwner

if TYPE_CHECKING:
    from src.campaigns.models import Campaign
    from src.visualizers.models import Visualizer


class _OwnedLayer:
    """The owner columns and relationships shared by both overlay kinds."""

    campaign_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"), nullable=True
    )
    visualizer_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.visualizers.id", ondelete="CASCADE"), nullable=True
    )

    @property
    def owner(self) -> LayerOwner:
        return LayerOwner(campaign_id=self.campaign_id, visualizer_id=self.visualizer_id)


class CustomMap(Base, _OwnedLayer):
    """A campaign-scoped single-band prediction map (COG) rendered as an overlay."""

    __tablename__ = "custom_maps"
    __table_args__ = (
        UniqueConstraint("campaign_id", "name", name="uq_custom_maps_campaign_name"),
        CheckConstraint(
            "(campaign_id IS NULL) <> (visualizer_id IS NULL)",
            name="custom_maps_one_owner_check",
        ),
        Index("idx_custom_maps_visualizer_id", "visualizer_id"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
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

    campaign: Mapped["Campaign | None"] = relationship(back_populates="custom_maps")
    visualizer: Mapped["Visualizer | None"] = relationship(back_populates="custom_maps")


class VectorLayer(Base, _OwnedLayer):
    """A campaign-scoped PMTiles vector layer rendered client-side in open mode.

    Just a ``.pmtiles`` URL the frontend reads directly via HTTP range requests.
    """

    __tablename__ = "vector_layers"
    __table_args__ = (
        CheckConstraint(
            "(campaign_id IS NULL) <> (visualizer_id IS NULL)",
            name="vector_layers_one_owner_check",
        ),
        Index("idx_vector_layers_campaign_id", "campaign_id"),
        Index("idx_vector_layers_visualizer_id", "visualizer_id"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    pmtiles_url: Mapped[str] = mapped_column(Text, nullable=False)
    # If multi layer source: source-layer name to render. null renders every layer.
    source_layer: Mapped[str | None] = mapped_column(String, nullable=True)
    color: Mapped[str] = mapped_column(String(9), server_default="#3b82f6", nullable=False)
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    campaign: Mapped["Campaign | None"] = relationship(back_populates="vector_layers")
    visualizer: Mapped["Visualizer | None"] = relationship(back_populates="vector_layers")

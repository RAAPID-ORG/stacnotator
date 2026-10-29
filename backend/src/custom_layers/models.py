from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
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
from src.layers import OwnedLayer, one_owner_check
from src.storage_access import StorageAccessOut, described

if TYPE_CHECKING:
    from src.campaigns.models import Campaign
    from src.visualizers.models import Visualizer


class CustomMap(Base, OwnedLayer):
    """A campaign-scoped single-band prediction map (COG) rendered as an overlay."""

    __tablename__ = "custom_maps"
    __table_args__ = (
        UniqueConstraint("campaign_id", "name", name="uq_custom_maps_campaign_name"),
        UniqueConstraint("visualizer_id", "name", name="uq_custom_maps_visualizer_name"),
        one_owner_check("custom_maps"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    cog_url: Mapped[str] = mapped_column(Text, nullable=False)
    render_config: Mapped[dict] = mapped_column(JSONB, nullable=False)
    max_native_zoom: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    mosaic_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # The tiler mosaic_id is registered on, which its tile URL and a revoke address.
    tiler: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # registering, ready, failed, or pending: owed a run the next booting worker starts
    status: Mapped[str] = mapped_column(String(16), server_default="registering", nullable=False)
    status_errors: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)
    mlops_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # COG lives in internal storage the tiler reads with its managed identity. Only internal
    # users may enable this (enforced in the router); it drives the tiler's asset_signer marker.
    internal_storage: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    storage_auth: Mapped[str | None] = mapped_column(String(32), nullable=True)
    encrypted_storage_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    storage_secret_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    campaign: Mapped["Campaign | None"] = relationship(back_populates="custom_maps")
    visualizer: Mapped["Visualizer | None"] = relationship(back_populates="custom_maps")

    @property
    def storage_access(self) -> StorageAccessOut | None:
        return described(self)

    @property
    def tile_layer(self) -> str:
        return f"custom_map:{self.id}"

    @property
    def tile_url(self) -> str | None:
        from src.custom_layers.render import tile_url

        return tile_url(self)


class VectorLayer(Base, OwnedLayer):
    """A campaign-scoped PMTiles vector layer rendered client-side.

    Just a ``.pmtiles`` URL the frontend reads directly via HTTP range requests.
    """

    __tablename__ = "vector_layers"
    __table_args__ = (
        one_owner_check("vector_layers"),
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

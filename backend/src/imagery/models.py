from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, declared_attr, mapped_column, relationship

from src.database import Base
from src.layers import OwnedLayer, one_owner_check
from src.storage_access import StorageAccessOut, described

if TYPE_CHECKING:
    from src.campaigns.models import Campaign
    from src.canvas.models import CanvasLayout
    from src.organizations.models import OrganizationApiKey
    from src.visualizers.models import Visualizer


@dataclass(frozen=True)
class ProviderKey:
    """A layer's provider credential, and the only host it may be sent to.

    Two people set a keyed layer up and they are not the same person: an
    organization admin stores the shared secret, a campaign admin points a layer
    at it and writes that layer's tile URL. Without a host on the key, writing
    the URL would be enough to have the proxy deliver the secret anywhere -
    which is why a shared key names its host and this pairs the two.

    ``allowed_host`` is None for a key typed into the layer itself, which
    restricts nothing: whoever typed it already knows it.
    """

    ciphertext: str
    allowed_host: str | None


class ProviderKeyed:
    """A layer whose tile URL template takes a provider API key: its own, typed into
    the layer, or one of the organization's shared keys. At most one is set."""

    # AES-256-GCM ciphertext of the key substituted into the layer's {api_key} URL
    # template. Decrypted only by the backend tile proxy.
    encrypted_api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    organization_api_key_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.organization_api_keys.id", ondelete="SET NULL"), nullable=True
    )

    @declared_attr
    def organization_api_key(cls) -> Mapped["OrganizationApiKey | None"]:
        return relationship()

    @property
    def has_api_key(self) -> bool:
        return self.encrypted_api_key is not None or self.organization_api_key_id is not None

    @property
    def provider_key(self) -> ProviderKey | None:
        """The key to decrypt for this layer's tiles: its own, or the shared one
        it points at, with the host that one is bound to.

        A shared key with no host bound is no key at all - it predates the
        binding and an organization admin has to say where it may be sent before
        anything will spend it.
        """
        if self.encrypted_api_key:
            return ProviderKey(self.encrypted_api_key, None)
        shared = self.organization_api_key
        if shared is None or not shared.allowed_tile_host:
            return None
        return ProviderKey(shared.encrypted_key, shared.allowed_tile_host)


class ImagerySource(Base, OwnedLayer, ProviderKeyed):
    """Imagery an owner offers: visualizations of it, and its collections over time."""

    __tablename__ = "imagery_sources"
    __table_args__ = (
        CheckConstraint("default_zoom BETWEEN 0 AND 22", name="source_zoom_check"),
        one_owner_check("imagery_sources"),
        Index("idx_imagery_sources_campaign_id", "campaign_id"),
        Index("idx_imagery_sources_visualizer_id", "visualizer_id"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    crosshair_hex6: Mapped[str] = mapped_column(String(6), server_default="ff0000", nullable=False)
    default_zoom: Mapped[int] = mapped_column(SmallInteger, server_default="15", nullable=False)
    # Deepest zoom the provider serves real pixels for. Past it the client upscales
    # instead of requesting tiles that cannot get any sharper. Null = no cap.
    # Same contract as Basemap.max_native_zoom.
    max_native_zoom: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)

    campaign: Mapped["Campaign | None"] = relationship(back_populates="imagery_sources")
    visualizer: Mapped["Visualizer | None"] = relationship(back_populates="imagery_sources")

    @property
    def tile_layer(self) -> str:
        return f"source:{self.id}"

    visualizations: Mapped[list["Visualization"]] = relationship(
        back_populates="source",
        cascade="all, delete-orphan",
        order_by="Visualization.display_order",
    )
    collections: Mapped[list["ImageryCollection"]] = relationship(
        back_populates="source",
        cascade="all, delete-orphan",
        order_by="ImageryCollection.display_order",
    )
    generation_series: Mapped[list["ImageryGenerationSeries"]] = relationship(
        back_populates="source",
        cascade="all, delete-orphan",
        order_by="ImageryGenerationSeries.id",
    )

    # Registration state, per source rather than per owner: one source can be fully
    # registered while another is still missing tiles.
    @property
    def slice_count(self) -> int:
        return sum(len(c.slices) for c in self.collections)

    @property
    def registered_slice_count(self) -> int:
        """Slices an annotator can see under every visualization."""
        return sum(
            1
            for c in self.collections
            for s in c.slices
            if len(s.tiles) >= len(self.visualizations) > 0
        )

    @property
    def refreshable(self) -> bool:
        """Whether re-running its searches could pick up newer imagery."""
        return any(c.is_stac for c in self.collections)


class Visualization(Base):
    """One way a source is drawn ('True Color', 'NDVI'). The name is a label; every
    collection's parameters and every slice's tiles refer to the visualization by id."""

    __tablename__ = "visualizations"
    __table_args__ = (
        UniqueConstraint("source_id", "name", name="uq_visualizations_source_name"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery_sources.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)

    source: Mapped["ImagerySource"] = relationship(back_populates="visualizations")


class ImageryGenerationSeries(Base):
    """What the temporal generator was asked for when it produced a run of
    collections, so it can be reopened: the period and how it was cut. The search
    and visualizations live on the collections."""

    __tablename__ = "imagery_generation_series"
    __table_args__ = (
        Index("idx_imagery_generation_series_source_id", "source_id"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery_sources.id", ondelete="CASCADE"),
        nullable=False,
    )
    config: Mapped[dict] = mapped_column(JSONB, nullable=False)

    source: Mapped["ImagerySource"] = relationship(back_populates="generation_series")
    collections: Mapped[list["ImageryCollection"]] = relationship(
        back_populates="generation_series"
    )


class ImageryCollection(Base):
    """One window of a source (e.g. Jan 2024) and its slices.

    A STAC collection carries the search its slices are mosaicked from and the
    parameters of each visualization; a manual one carries neither, its slices hold
    tile templates instead. The slice at ``cover_slice_index`` is the one the window
    opens on; with ``has_dedicated_cover`` it is a whole-window composite searched
    and rendered with the cover overrides rather than one of the regular slices.
    """

    __tablename__ = "imagery_collections"
    __table_args__ = (
        Index("idx_imagery_collections_source_id", "source_id"),
        Index("idx_imagery_collections_generation_series_id", "generation_series_id"),
        CheckConstraint(
            "(catalog_url IS NULL) = (stac_collection_id IS NULL)",
            name="imagery_collections_search_whole",
        ),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery_sources.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    cover_slice_index: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)
    has_dedicated_cover: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)
    generation_series_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.imagery_generation_series.id", ondelete="SET NULL"),
        nullable=True,
    )

    # --- The STAC search, NULL for a manual collection ---
    catalog_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    stac_collection_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # The hosted tiler that serves what MPC cannot (a Settings.TILERS key).
    tiler: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # CQL2-JSON; slice dates are filled in at registration.
    search_query: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    cover_search_query: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Also handed to a hosted tiler's ingest, which filters before the search runs.
    max_cloud_cover: Mapped[float | None] = mapped_column(nullable=True)
    # Assets live in internal storage the tiler reads with its managed identity.
    internal_storage: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    # A private catalog's own access, provided by the customer (see src/storage_access.py).
    storage_auth: Mapped[str | None] = mapped_column(String(32), nullable=True)
    encrypted_storage_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    storage_secret_expires_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )

    source: Mapped["ImagerySource"] = relationship(back_populates="collections")
    generation_series: Mapped["ImageryGenerationSeries | None"] = relationship(
        back_populates="collections"
    )
    slices: Mapped[list["ImagerySlice"]] = relationship(
        back_populates="collection",
        cascade="all, delete-orphan",
        order_by="ImagerySlice.display_order",
    )
    visualizations: Mapped[list["CollectionVisualization"]] = relationship(
        back_populates="collection",
        cascade="all, delete-orphan",
    )

    @property
    def is_stac(self) -> bool:
        return self.catalog_url is not None

    @property
    def search(self) -> "ImageryCollection | None":
        """The search, which the API sends as one object; it lives on the collection."""
        return self if self.is_stac else None

    @property
    def storage_access(self) -> StorageAccessOut | None:
        return described(self)

    def is_cover(self, sl: "ImagerySlice") -> bool:
        """Whether ``sl`` is this window's dedicated cover."""
        return (
            self.has_dedicated_cover
            and 0 <= self.cover_slice_index < len(self.slices)
            and self.slices[self.cover_slice_index] is sl
        )


class CollectionVisualization(Base):
    """How a STAC collection draws one of its source's visualizations: the tiler
    parameters, and the dedicated cover's own when it has them."""

    __tablename__ = "collection_visualizations"
    __table_args__ = {"schema": "data"}

    collection_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery_collections.id", ondelete="CASCADE"), primary_key=True
    )
    visualization_id: Mapped[int] = mapped_column(
        ForeignKey("data.visualizations.id", ondelete="CASCADE"), primary_key=True
    )
    params: Mapped[dict] = mapped_column(JSONB, nullable=False)
    cover_params: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    collection: Mapped["ImageryCollection"] = relationship(back_populates="visualizations")
    visualization: Mapped["Visualization"] = relationship()


class ImagerySlice(Base):
    """A period within a collection. A STAC slice is mosaicked by registration
    (``mosaics``); a manual one is given a tile template per visualization
    (``templates``). Its tiles follow from either - see ``imagery.tiles``."""

    __tablename__ = "imagery_slices"
    __table_args__ = (
        Index("idx_imagery_slices_collection_id", "collection_id"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    collection_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery_collections.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False, server_default="")
    start_date: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD
    end_date: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)

    collection: Mapped["ImageryCollection"] = relationship(back_populates="slices")
    mosaics: Mapped[list["SliceMosaic"]] = relationship(
        back_populates="slice", cascade="all, delete-orphan"
    )
    templates: Mapped[list["SliceTemplate"]] = relationship(
        back_populates="slice", cascade="all, delete-orphan"
    )

    @property
    def tiles(self) -> list["SliceTile"]:
        from src.imagery.tiles import slice_tiles

        return slice_tiles(self.collection, self)


@dataclass(frozen=True)
class SliceTile:
    """Where one visualization of a slice is drawn from. ``tiler`` names the tiler that
    serves it: "mpc", a hosted tiler, or None for a template a provider serves."""

    visualization_id: int
    url: str
    tiler: str | None


class SliceMosaic(Base):
    """A slice's search, registered on one provider: MPC's searchid or a hosted
    tiler's. A slice has one per provider its visualizations are drawn by."""

    __tablename__ = "slice_mosaics"
    __table_args__ = {"schema": "data"}

    slice_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery_slices.id", ondelete="CASCADE"), primary_key=True
    )
    # "mpc" or a hosted tiler's name (Settings.TILERS).
    provider: Mapped[str] = mapped_column(String(64), primary_key=True)
    mosaic_id: Mapped[str] = mapped_column(String(64), nullable=False)

    slice: Mapped["ImagerySlice"] = relationship(back_populates="mosaics")


class SliceTemplate(Base):
    """A manual slice's XYZ template for one visualization; ``{api_key}`` marks a
    template the backend proxy completes with the source's key."""

    __tablename__ = "slice_templates"
    __table_args__ = {"schema": "data"}

    slice_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery_slices.id", ondelete="CASCADE"), primary_key=True
    )
    visualization_id: Mapped[int] = mapped_column(
        ForeignKey("data.visualizations.id", ondelete="CASCADE"), primary_key=True
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)

    slice: Mapped["ImagerySlice"] = relationship(back_populates="templates")


class Basemap(Base, OwnedLayer, ProviderKeyed):
    """Static XYZ basemap layer for a campaign (e.g. OSM, satellite)."""

    __tablename__ = "basemaps"
    __table_args__ = (
        one_owner_check("basemaps"),
        Index("idx_basemaps_campaign_id", "campaign_id"),
        Index("idx_basemaps_visualizer_id", "visualizer_id"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    # Max zoom at which the provider serves real tiles. Past this, the client
    # upscales the deepest tile instead of requesting "no data" placeholders.
    # Null = unlimited (no cap on tile requests).
    max_native_zoom: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    campaign: Mapped["Campaign | None"] = relationship(back_populates="basemaps")
    visualizer: Mapped["Visualizer | None"] = relationship(back_populates="basemaps")


class ImageryView(Base):
    """A named view over an ordered set of the campaign's imagery sources. Every
    collection of those sources is a window of the view unless a layout hides it."""

    __tablename__ = "imagery_views"
    __table_args__ = (
        Index("idx_imagery_views_campaign_id", "campaign_id"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False, server_default="")
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)

    campaign: Mapped["Campaign"] = relationship(back_populates="imagery_views")
    sources: Mapped[list["ViewSource"]] = relationship(
        cascade="all, delete-orphan", order_by="ViewSource.position"
    )
    canvas_layouts: Mapped[list["CanvasLayout"]] = relationship(
        "CanvasLayout",
        foreign_keys="[CanvasLayout.view_id]",
        back_populates="imagery_view",
        cascade="all, delete-orphan",
    )

    @property
    def source_ids(self) -> list[int]:
        return [vs.source_id for vs in self.sources]

    @source_ids.setter
    def source_ids(self, ids: list[int]) -> None:
        self.sources = [ViewSource(source_id=sid, position=i) for i, sid in enumerate(ids)]


class ViewSource(Base):
    """A source a view browses, at its place in the view's order. Goes with the
    source when the source is deleted."""

    __tablename__ = "view_sources"
    __table_args__ = (
        Index("idx_view_sources_source_id", "source_id"),
        {"schema": "data"},
    )

    view_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery_views.id", ondelete="CASCADE"), primary_key=True
    )
    source_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery_sources.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)

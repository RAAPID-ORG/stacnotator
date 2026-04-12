from geoalchemy2 import Geometry
from sqlalchemy import (
    CheckConstraint,
    DateTime,
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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database import Base


class ImagerySource(Base):
    """
    Top-level imagery provider for a campaign.
    Groups collections under a shared set of display settings and visualizations.
    """

    __tablename__ = "imagery_sources"
    __table_args__ = (
        CheckConstraint("default_zoom BETWEEN 0 AND 22", name="source_zoom_check"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    crosshair_hex6: Mapped[str] = mapped_column(String(6), server_default="ff0000", nullable=False)
    default_zoom: Mapped[int] = mapped_column(SmallInteger, server_default="14", nullable=False)
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)

    campaign: Mapped["Campaign"] = relationship(back_populates="imagery_sources")  # noqa: F821
    visualizations: Mapped[list["VisualizationTemplate"]] = relationship(
        back_populates="source",
        cascade="all, delete-orphan",
    )
    collections: Mapped[list["ImageryCollection"]] = relationship(
        back_populates="source",
        cascade="all, delete-orphan",
    )


class VisualizationTemplate(Base):
    """Named visualization option belonging to a source (e.g. 'True Color', 'NDVI')."""

    __tablename__ = "visualization_templates"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery_sources.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)

    source: Mapped["ImagerySource"] = relationship(back_populates="visualizations")


class ImageryCollection(Base):
    """
    Temporal grouping of slices within a source.
    Represents one 'window' of imagery (e.g. Jan 2024, Q1 2024).
    """

    __tablename__ = "imagery_collections"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery_sources.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    cover_slice_index: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)

    source: Mapped["ImagerySource"] = relationship(back_populates="collections")
    slices: Mapped[list["ImagerySlice"]] = relationship(
        back_populates="collection",
        cascade="all, delete-orphan",
    )
    stac_config: Mapped["CollectionStacConfig | None"] = relationship(
        back_populates="collection",
        uselist=False,
        cascade="all, delete-orphan",
    )


class CollectionStacConfig(Base):
    """STAC registration config for a collection (only for STAC-based collections)."""

    __tablename__ = "collection_stac_configs"
    __table_args__ = {"schema": "data"}

    collection_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery_collections.id", ondelete="CASCADE"),
        primary_key=True,
    )
    registration_url: Mapped[str] = mapped_column(Text, nullable=False)
    search_body: Mapped[str] = mapped_column(Text, nullable=False)
    # Tile URL templates with {searchId} placeholders, persisted so we can re-register
    # when the campaign bbox changes.  Format: [{"viz_name": "...", "url_template": "..."}]
    viz_url_templates: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    # New fields for STAC catalog browser / TiTiler integration ──
    catalog_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    stac_collection_id: Mapped[str | None] = mapped_column(String, nullable=True)
    tile_provider: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Structured viz params: {"assets": [...], "rescale": "0,3000", "colormap_name": ...}
    viz_params: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Cover slice viz params (different compositing, etc.)
    cover_viz_params: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Max cloud cover percentage for STAC search filtering
    max_cloud_cover: Mapped[float | None] = mapped_column(nullable=True)
    # Custom CQL2-JSON search query (when set, used instead of auto-generated query)
    search_query: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Custom search query override for cover slice only
    cover_search_query: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    collection: Mapped["ImageryCollection"] = relationship(back_populates="stac_config")


class ImagerySlice(Base):
    """
    A temporal slice within a collection.
    Each slice has a start/end date and per-visualization resolved tile URLs.
    """

    __tablename__ = "imagery_slices"
    __table_args__ = {"schema": "data"}

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
    tile_urls: Mapped[list["SliceTileUrl"]] = relationship(
        back_populates="slice",
        cascade="all, delete-orphan",
    )


class SliceTileUrl(Base):
    """Resolved XYZ tile URL for a specific slice + visualization combination."""

    __tablename__ = "slice_tile_urls"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slice_id: Mapped[int] = mapped_column(
        ForeignKey("data.imagery_slices.id", ondelete="CASCADE"),
        nullable=False,
    )
    visualization_name: Mapped[str] = mapped_column(String, nullable=False)
    tile_url: Mapped[str] = mapped_column(Text, nullable=False)
    # 'mpc' | 'self_hosted' | null (= direct URL, backward compat)
    tile_provider: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Link to mosaic registration (NULL for MPC/manual URLs)
    mosaic_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey("data.mosaic_registrations.mosaic_id", ondelete="SET NULL"),
        nullable=True,
    )

    slice: Mapped["ImagerySlice"] = relationship(back_populates="tile_urls")
    mosaic: Mapped["MosaicRegistration | None"] = relationship(back_populates="tile_urls")


class MosaicRegistration(Base):
    """
    Persistent record of a STAC mosaic registration.
    Replaces the volatile in-memory _mosaic_store dict.
    One row per unique mosaic (deduplicated by deterministic SHA256 hash).
    """

    __tablename__ = "mosaic_registrations"
    __table_args__ = {"schema": "data"}

    mosaic_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    catalog_url: Mapped[str] = mapped_column(Text, nullable=False)
    stac_collection_id: Mapped[str] = mapped_column(String, nullable=False)
    bbox: Mapped[list] = mapped_column(JSONB, nullable=False)  # [west, south, east, north]
    datetime_range: Mapped[str] = mapped_column(String, nullable=False)
    max_cloud_cover: Mapped[float | None] = mapped_column(Float, nullable=True)
    item_count: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False)
    assets_info: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # pending | ready | failed | empty
    status: Mapped[str] = mapped_column(String(20), server_default="pending", nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    registered_at: Mapped[str | None] = mapped_column(DateTime, server_default=func.now())

    items: Mapped[list["MosaicItem"]] = relationship(
        back_populates="mosaic",
        cascade="all, delete-orphan",
    )
    tile_urls: Mapped[list["SliceTileUrl"]] = relationship(back_populates="mosaic")


class MosaicItem(Base):
    """
    STAC item reference within a mosaic registration.
    Stores the minimal data needed for tile compositing (href, bbox, datetime).
    The geom column is a PostGIS envelope built from the bbox for spatial indexing.
    """

    __tablename__ = "mosaic_items"
    __table_args__ = (
        Index("ix_mosaic_items_geom", "geom", postgresql_using="gist"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mosaic_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("data.mosaic_registrations.mosaic_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    item_id: Mapped[str] = mapped_column(String, nullable=False)
    href: Mapped[str] = mapped_column(Text, nullable=False)
    bbox_west: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_south: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_east: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_north: Mapped[float] = mapped_column(Float, nullable=False)
    datetime: Mapped[str] = mapped_column(String, nullable=False)
    cloud_cover: Mapped[float | None] = mapped_column(Float, nullable=True)
    geom = mapped_column(Geometry("POLYGON", srid=4326), nullable=True)

    mosaic: Mapped["MosaicRegistration"] = relationship(back_populates="items")


class Basemap(Base):
    """Static XYZ basemap layer for a campaign (e.g. OSM, satellite)."""

    __tablename__ = "basemaps"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)

    campaign: Mapped["Campaign"] = relationship(back_populates="basemaps")  # noqa: F821


class ImageryView(Base):
    """
    Named view that references a set of collections from various sources.
    Collection membership and visibility are stored in JSONB.
    """

    __tablename__ = "imagery_views"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False, server_default="")
    display_order: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False)

    # [{ "collection_id": int, "source_id": int, "show_as_window": bool }, ...]
    collection_refs: Mapped[list] = mapped_column(JSONB, server_default="[]", nullable=False)

    campaign: Mapped["Campaign"] = relationship(back_populates="imagery_views")  # noqa: F821
    canvas_layouts: Mapped[list["CanvasLayout"]] = relationship(  # noqa: F821
        "CanvasLayout",
        foreign_keys="[CanvasLayout.view_id]",
        back_populates="imagery_view",
        cascade="all, delete-orphan",
    )

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
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

    slice: Mapped["ImagerySlice"] = relationship(back_populates="tile_urls")


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

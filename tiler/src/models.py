"""Read-only models for mosaic data. Matches backend schema exactly."""

from sqlalchemy import Float, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class MosaicRegistration(Base):
    __tablename__ = "mosaic_registrations"
    __table_args__ = {"schema": "data"}

    mosaic_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    catalog_url: Mapped[str] = mapped_column(Text, nullable=False)
    stac_collection_id: Mapped[str] = mapped_column(String, nullable=False)
    bbox: Mapped[list] = mapped_column(JSONB, nullable=False)
    datetime_range: Mapped[str] = mapped_column(String, nullable=False)
    item_count: Mapped[int] = mapped_column(Integer, nullable=False)
    assets_info: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)


class MosaicItem(Base):
    __tablename__ = "mosaic_items"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mosaic_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    item_id: Mapped[str] = mapped_column(String, nullable=False)
    href: Mapped[str] = mapped_column(Text, nullable=False)
    bbox_west: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_south: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_east: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_north: Mapped[float] = mapped_column(Float, nullable=False)
    datetime: Mapped[str] = mapped_column(String, nullable=False)
    cloud_cover: Mapped[float | None] = mapped_column(Float, nullable=True)

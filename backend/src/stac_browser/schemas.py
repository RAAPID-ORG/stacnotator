"""Pydantic schemas for the STAC browser API."""

from math import isfinite

from pydantic import BaseModel, Field, field_validator

from src.stac_browser.client import parse_datetime


class StacCatalogOut(BaseModel):
    id: str
    title: str
    url: str
    summary: str
    is_mpc: bool
    auth_required: bool
    tiler_name: str | None = (
        None  #  Tiler that should serve this catalog tiles. Co-locate with data.
    )
    provided: bool = False  # Only true for MPC + our hosted + configured tilers
    selectable: bool = True  # False if needs unhandled auth or other blocking reason
    unavailable_reason: str | None = None  # Reason for selectable


class BandInfo(BaseModel):
    name: str
    description: str | None = None


class AssetInfo(BaseModel):
    title: str
    type: str
    roles: list[str]
    bands: list[BandInfo] = []


class TemporalExtent(BaseModel):
    start: str | None = None
    end: str | None = None


class StacCollectionOut(BaseModel):
    id: str
    title: str
    description: str
    temporal_extent: TemporalExtent | None = None
    spatial_extent: list[float] | None = None
    keywords: list[str] = []
    item_assets: dict[str, AssetInfo] = {}
    has_cloud_cover: bool = False
    selectable: bool = True  # False if needs unhandled auth or other blocking reason
    unavailable_reason: str | None = None  # Reason for selectable


MAX_SEARCH_LIMIT = 500


class SearchRequest(BaseModel):
    catalog_url: str = Field(min_length=1, max_length=2048)
    collection_id: str = Field(min_length=1, max_length=256)
    bbox: list[float] | None = None
    datetime_range: str | None = Field(default=None, max_length=64)
    limit: int = Field(default=50, ge=1, le=MAX_SEARCH_LIMIT)
    # Cursor for paging static catalogs: resume the item-link crawl from here.
    offset: int = Field(default=0, ge=0)

    @field_validator("bbox")
    @classmethod
    def _valid_bbox(cls, bbox: list[float] | None) -> list[float] | None:
        """A GeoJSON bbox: 2D or 3D, finite, south before north.

        Longitude is left alone on purpose - west past east is how a box crossing
        the antimeridian is written, and callers vary on whether they wrap.
        """
        if bbox is None:
            return None
        if len(bbox) not in (4, 6):
            raise ValueError("bbox must have 4 or 6 values")
        if any(not isfinite(v) for v in bbox):
            raise ValueError("bbox values must be finite")
        south, north = (bbox[1], bbox[4]) if len(bbox) == 6 else (bbox[1], bbox[3])
        if not (-90 <= south <= 90 and -90 <= north <= 90):
            raise ValueError("bbox latitudes must be within [-90, 90]")
        if south > north:
            raise ValueError("bbox south must not exceed north")
        return bbox

    @field_validator("datetime_range")
    @classmethod
    def _valid_datetime_range(cls, value: str | None) -> str | None:
        """Only what a STAC datetime parameter may be: an instant, or an interval
        with at most one open end."""
        if value is None:
            return None
        parts = value.split("/")
        if len(parts) > 2:
            raise ValueError("datetime_range must be an instant or start/end")
        if all(part.strip() in ("", "..") for part in parts):
            raise ValueError("datetime_range must have at least one bound")
        for part in parts:
            if part.strip() not in ("", "..") and parse_datetime(part) is None:
                raise ValueError(f"datetime_range has an unparseable bound: {part}")
        return value


class StacItemOut(BaseModel):
    id: str
    datetime: str | None = None
    bbox: list[float] | None = None
    geometry: dict | None = None
    properties: dict = {}
    assets: dict[str, AssetInfo] = {}
    thumbnail: str | None = None
    self_href: str | None = None


class SearchResponse(BaseModel):
    items: list[StacItemOut]
    count: int
    next_offset: int | None = None  # crawl offset, null of results complete

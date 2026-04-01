"""Pydantic schemas for STAC browser / tiling API."""

from pydantic import BaseModel

# ── Catalog ────────────────────────────────────────────────────────────


class StacCatalogOut(BaseModel):
    id: str
    title: str
    url: str
    summary: str
    is_mpc: bool
    auth_required: bool


# ── Shared ─────────────────────────────────────────────────────────────


class AssetInfo(BaseModel):
    title: str
    type: str
    roles: list[str]


# ── Collection ─────────────────────────────────────────────────────────


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


# ── Search ─────────────────────────────────────────────────────────────


class SearchRequest(BaseModel):
    catalog_url: str
    collection_id: str
    bbox: list[float] | None = None
    datetime_range: str | None = None
    limit: int = 50


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


# ── Mosaic ─────────────────────────────────────────────────────────────


class MosaicRegisterRequest(BaseModel):
    catalog_url: str
    collection_id: str
    bbox: list[float]
    datetime_range: str
    max_items: int | None = None
    pixel_selection: str = "first"


class MosaicRegisterResponse(BaseModel):
    mosaic_id: str
    item_count: int
    assets: dict[str, AssetInfo]


# ── Stats ──────────────────────────────────────────────────────────────


class StatsRequest(BaseModel):
    catalog_url: str
    collection_id: str
    assets: list[str]
    bbox: list[float] | None = None
    datetime_range: str | None = None
    max_cloud_cover: float | None = None


class StatsResponse(BaseModel):
    rescale: str
    source: str

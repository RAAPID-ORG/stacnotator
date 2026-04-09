"""Pydantic schemas for STAC browser / tiling API."""

from pydantic import BaseModel


class StacCatalogOut(BaseModel):
    id: str
    title: str
    url: str
    summary: str
    is_mpc: bool
    auth_required: bool


class AssetInfo(BaseModel):
    title: str
    type: str
    roles: list[str]


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


class MosaicRegisterRequest(BaseModel):
    catalog_url: str
    collection_id: str
    bbox: list[float]
    datetime_range: str
    max_items: int | None = None


class MosaicRegisterResponse(BaseModel):
    mosaic_id: str
    item_count: int
    assets: dict[str, AssetInfo]

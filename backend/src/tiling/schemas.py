"""Pydantic schemas for STAC browser / tiling API."""

from pydantic import BaseModel


class StacCatalogOut(BaseModel):
    id: str
    title: str
    url: str
    summary: str
    is_mpc: bool
    auth_required: bool
    # Set for our platform tiler catalogs; picking a collection auto-targets this tiler.
    tiler_name: str | None = None
    # True for catalogs we provide (MPC + platform tiler catalogs), false for external.
    provided: bool = False


class BandInfo(BaseModel):
    name: str
    description: str | None = None


class AssetInfo(BaseModel):
    title: str
    type: str
    roles: list[str]
    # Populated from the asset's eo:bands; lets the wizard pick bands within a single
    # multiband asset. Empty for single-band / per-band-asset collections (e.g. MPC).
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


class SearchRequest(BaseModel):
    catalog_url: str
    collection_id: str
    bbox: list[float] | None = None
    datetime_range: str | None = None
    limit: int = 50
    # Cursor for paging static catalogs: resume the item-link crawl from here.
    offset: int = 0


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
    # Next crawl offset for a static catalog when more items remain; null when the
    # results are complete (STAC-API catalogs are server-filtered and never paged).
    next_offset: int | None = None

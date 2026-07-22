"""Pydantic schemas for STAC browser / tiling API."""

from pydantic import BaseModel


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


class SearchRequest(BaseModel):
    catalog_url: str
    collection_id: str
    bbox: list[float] | None = None
    datetime_range: str | None = None
    limit: int = 50
    offset: int = 0  # Cursor for paging static catalogs: resume the item-link crawl from here.


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

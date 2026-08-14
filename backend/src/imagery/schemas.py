from typing import Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PrivateAttr,
    computed_field,
    field_validator,
    model_validator,
)

from src.canvas.schemas import CanvasLayoutOut

# ============================================================================
# Slice / Collection / Source - Output Schemas
# ============================================================================


class SliceTileUrlOut(BaseModel):
    id: int
    visualization_name: str
    tile_url: str
    tile_provider: str | None = None
    mosaic_id: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ImagerySliceOut(BaseModel):
    id: int
    name: str
    start_date: str
    end_date: str
    display_order: int
    tile_urls: list[SliceTileUrlOut]

    model_config = ConfigDict(from_attributes=True)


class CollectionVizConfigOut(BaseModel):
    """Per-collection, per-visualization render params (new authoritative representation)."""

    id: int
    name: str
    display_order: int
    render_params: dict
    cover_render_params: dict | None = None

    model_config = ConfigDict(from_attributes=True)


class CollectionStacConfigOut(BaseModel):
    catalog_url: str | None = None
    stac_collection_id: str | None = None
    # API name `tiler`, ORM column `tile_provider`. null => default tiler.
    tiler: str | None = Field(default=None, validation_alias="tile_provider")
    viz_configs: list[CollectionVizConfigOut] = []
    max_cloud_cover: float | None = None
    search_query: dict | None = None
    cover_search_query: dict | None = None
    internal_storage: bool = False

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ImageryCollectionOut(BaseModel):
    id: int
    name: str
    cover_slice_index: int
    has_dedicated_cover: bool = False
    display_order: int
    generation_series_id: int | None = None
    slices: list[ImagerySliceOut]
    stac_config: CollectionStacConfigOut | None = None

    model_config = ConfigDict(from_attributes=True)


class VisualizationTemplateOut(BaseModel):
    id: int
    name: str
    display_order: int

    model_config = ConfigDict(from_attributes=True)


class ImageryGenerationConfigV1(BaseModel):
    """Lossless, versioned input for the temporal imagery generator."""

    version: Literal[1] = 1
    catalog_url: str
    stac_collection_id: str
    collection_title: str
    is_mpc: bool
    has_cloud_cover: bool
    tiler: str | None = None
    start_date: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    end_date: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    collection_period_interval: int = Field(ge=1)
    collection_period_unit: Literal["weeks", "months", "years"]
    slice_period_interval: int = Field(ge=1)
    slice_period_unit: Literal["days", "weeks", "months", "years"]
    cover_mode: Literal["nth", "custom"]
    cover_slice_nth: int = Field(ge=1)
    max_cloud_cover: float = Field(ge=0, le=100)
    item_sort: Literal["date_desc", "date_asc", "cloud_cover_asc"]
    cover_max_cloud_cover: float = Field(ge=0, le=100)
    cover_item_sort: Literal["date_desc", "date_asc", "cloud_cover_asc"]
    visualizations: list["NamedVizParamsCreate"]
    cover_visualizations: list["NamedVizParamsCreate"] = []
    search_query: dict | None = None
    cover_search_query: dict | None = None
    internal_storage: bool = False

    model_config = ConfigDict(extra="forbid")


class ImageryGenerationSeriesOut(BaseModel):
    id: int
    config: ImageryGenerationConfigV1

    model_config = ConfigDict(from_attributes=True)


class ImagerySourceOut(BaseModel):
    id: int
    name: str
    crosshair_hex6: str
    default_zoom: int
    display_order: int
    visualizations: list[VisualizationTemplateOut]
    collections: list[ImageryCollectionOut]
    generation_series: list[ImageryGenerationSeriesOut] = []
    # Whether a provider API key is configured (drives the admin UI), and which
    # shared org key it is when the source uses one. The key value/ciphertext is
    # never serialized.
    has_api_key: bool = False
    organization_api_key_id: int | None = None

    model_config = ConfigDict(from_attributes=True)


class BasemapOut(BaseModel):
    id: int
    name: str
    url: str
    max_native_zoom: int | None = None
    has_api_key: bool = False
    organization_api_key_id: int | None = None

    model_config = ConfigDict(from_attributes=True)


class ApiKeyUpdate(BaseModel):
    """Where this layer's provider key comes from: a literal value to encrypt
    and keep on the row, or one of the owning organization's shared keys.
    Write-only either way - a stored value is never read back."""

    value: str | None = Field(default=None, min_length=1)
    organization_api_key_id: int | None = None

    @model_validator(mode="after")
    def exactly_one_source(self) -> "ApiKeyUpdate":
        if (self.value is None) == (self.organization_api_key_id is None):
            raise ValueError("Set exactly one of value or organization_api_key_id")
        return self


class ApiKeyStatusOut(BaseModel):
    has_api_key: bool
    organization_api_key_id: int | None = None


class OrganizationKeyOut(BaseModel):
    """A shared key this campaign's organization offers, by name."""

    id: int
    name: str


class OrganizationKeysResponse(BaseModel):
    items: list[OrganizationKeyOut]


class ImageryViewOut(BaseModel):
    id: int
    name: str
    display_order: int
    source_ids: list[int]

    # Populated by from_orm; stay None on any other construction path (e.g. a
    # plain ImageryViewOut(**kwargs) in a test). Read-only computed fields so
    # they don't reappear as writable input fields on this output-only schema.
    _default_canvas_layout: CanvasLayoutOut | None = PrivateAttr(default=None)
    _personal_canvas_layout: CanvasLayoutOut | None = PrivateAttr(default=None)

    @computed_field
    @property
    def default_canvas_layout(self) -> CanvasLayoutOut | None:
        return self._default_canvas_layout

    @computed_field
    @property
    def personal_canvas_layout(self) -> CanvasLayoutOut | None:
        return self._personal_canvas_layout

    @classmethod
    def from_orm(cls, obj, user_id: UUID | None = None) -> "ImageryViewOut":
        instance = cls.model_validate(obj)
        for layout in getattr(obj, "canvas_layouts", []):
            if layout.is_default and layout.user_id is None:
                instance._default_canvas_layout = CanvasLayoutOut.model_validate(layout)
            elif user_id and layout.user_id == user_id:
                instance._personal_canvas_layout = CanvasLayoutOut.model_validate(layout)
        return instance

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Create Schemas
# ============================================================================


class SliceTileUrlCreate(BaseModel):
    visualization_name: str
    tile_url: str


class ImagerySliceCreate(BaseModel):
    id: int | None = None
    name: str = ""
    start_date: str
    end_date: str
    tile_urls: list[SliceTileUrlCreate] = []


class VizParamsCreate(BaseModel):
    """Structured visualization parameters for TiTiler tile rendering."""

    assets: list[str] = []
    asset_as_band: bool = False
    # 1-based band indexes to output from a single multiband asset (e.g. [6,4,2] for RGB).
    # The tiler slices the read result to these bands - see the tiler's CompositingBackend.
    bidx: list[int] | None = None
    rescale: str | None = None
    colormap_name: str | None = None
    color_formula: str | None = None
    expression: str | None = None
    resampling: str | None = None
    compositing: str | None = None
    nodata: float | None = None
    extra_params: dict[str, str] | None = None
    mask_layer: str | None = None
    mask_values: list[int] | None = None
    nir_band: str | None = None
    red_band: str | None = None
    max_items: int | None = None


class NamedVizParamsCreate(BaseModel):
    name: str
    viz_params: VizParamsCreate
    cover_viz_params: VizParamsCreate | None = None


class CollectionStacConfigCreate(BaseModel):
    catalog_url: str | None = None
    stac_collection_id: str | None = None
    tiler: str | None = None  # hosted tiler name; null => DEFAULT_TILER
    visualizations: list[NamedVizParamsCreate] = []
    max_cloud_cover: float | None = None
    search_query: dict | None = None
    cover_search_query: dict | None = None
    internal_storage: bool = False


class ImageryCollectionCreate(BaseModel):
    id: int | None = None
    name: str
    cover_slice_index: int = 0
    has_dedicated_cover: bool = False
    generation_series_key: str | None = None
    slices: list[ImagerySliceCreate]
    stac_config: CollectionStacConfigCreate | None = None


class ImageryGenerationSeriesCreate(BaseModel):
    """One source-level series in the full-editor write model.

    ``key`` is a request-local identity used by collections in the same
    payload. ``id`` preserves an existing database row when editing.
    """

    key: str = Field(min_length=1)
    id: int | None = None
    config: ImageryGenerationConfigV1


class VisualizationTemplateCreate(BaseModel):
    name: str


class ImagerySourceCreate(BaseModel):
    id: int | None = None
    name: str
    crosshair_hex6: str = "ff0000"
    default_zoom: int = 15
    visualizations: list[VisualizationTemplateCreate]
    generation_series: list[ImageryGenerationSeriesCreate] = []
    collections: list[ImageryCollectionCreate]

    @field_validator("visualizations")
    @classmethod
    def visualization_names_unique(
        cls, v: list[VisualizationTemplateCreate]
    ) -> list[VisualizationTemplateCreate]:
        names = [viz.name for viz in v]
        if len(names) != len(set(names)):
            raise ValueError("visualization names must be unique per source")
        return v

    @model_validator(mode="after")
    def generation_series_references_are_valid(self) -> "ImagerySourceCreate":
        keys = [series.key for series in self.generation_series]
        if len(keys) != len(set(keys)):
            raise ValueError("generation series keys must be unique per source")
        ids = [series.id for series in self.generation_series if series.id is not None]
        if len(ids) != len(set(ids)):
            raise ValueError("generation series ids must be unique per source")
        known = set(keys)
        unknown = {
            collection.generation_series_key
            for collection in self.collections
            if collection.generation_series_key is not None
            and collection.generation_series_key not in known
        }
        if unknown:
            raise ValueError(f"unknown generation series keys: {sorted(unknown)}")
        referenced = {
            collection.generation_series_key
            for collection in self.collections
            if collection.generation_series_key is not None
        }
        unreferenced = known - referenced
        if unreferenced:
            raise ValueError(f"unreferenced generation series keys: {sorted(unreferenced)}")
        return self


class BasemapCreate(BaseModel):
    id: int | None = None
    name: str
    url: str
    max_native_zoom: int | None = None


class ImageryEditorStateCreate(BaseModel):
    """Full imagery editor state sent from the frontend on campaign creation."""

    sources: list[ImagerySourceCreate]
    basemaps: list[BasemapCreate]


# ============================================================================
# View Request Schemas
# ============================================================================


class ImageryViewCreate(BaseModel):
    name: str = ""
    source_ids: list[int] = []


class ImageryViewUpdate(BaseModel):
    """Partial update: only the provided fields change."""

    name: str | None = None
    source_ids: list[int] | None = None


class ImageryViewOrderUpdate(BaseModel):
    """Full campaign view ordering; must list every view id exactly once."""

    view_ids: list[int]

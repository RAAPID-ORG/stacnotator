from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, computed_field, field_validator

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
    slices: list[ImagerySliceOut]
    stac_config: CollectionStacConfigOut | None = None

    model_config = ConfigDict(from_attributes=True)


class VisualizationTemplateOut(BaseModel):
    id: int
    name: str
    display_order: int

    model_config = ConfigDict(from_attributes=True)


class ImagerySourceOut(BaseModel):
    id: int
    name: str
    crosshair_hex6: str
    default_zoom: int
    display_order: int
    visualizations: list[VisualizationTemplateOut]
    collections: list[ImageryCollectionOut]
    # Whether an encrypted provider API key is configured (drives the admin UI). The key
    # value/ciphertext is never serialized.
    has_api_key: bool = False

    model_config = ConfigDict(from_attributes=True)


class BasemapOut(BaseModel):
    id: int
    name: str
    url: str
    max_native_zoom: int | None = None
    has_api_key: bool = False

    model_config = ConfigDict(from_attributes=True)


class ApiKeyUpdate(BaseModel):
    """Write-only provider API key value (campaign-admin sets it; never read back)."""

    value: str = Field(min_length=1)


class ApiKeyStatusOut(BaseModel):
    has_api_key: bool


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
    slices: list[ImagerySliceCreate]
    stac_config: CollectionStacConfigCreate | None = None


class VisualizationTemplateCreate(BaseModel):
    name: str


class ImagerySourceCreate(BaseModel):
    id: int | None = None
    name: str
    crosshair_hex6: str = "ff0000"
    default_zoom: int = 14
    visualizations: list[VisualizationTemplateCreate]
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

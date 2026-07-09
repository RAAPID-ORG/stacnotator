from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field

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


class TilerOption(BaseModel):
    """A tiler the user may use, from the unified registry."""

    name: str
    kind: str  # "mpc" | "hosted"
    url: str | None = None  # browser-facing URL (hosted only; null for MPC)
    is_default: bool  # default hosted pick for non-MPC collections


class AllowedTilersOut(BaseModel):
    """Hosted tilers selectable in the imagery wizard (default first)."""

    tilers: list[TilerOption]


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


class ViewCollectionRefItem(BaseModel):
    collection_id: int
    source_id: int
    show_as_window: bool = True


class CanvasLayoutItem(BaseModel):
    """One react-grid-layout tile: grid id and position/size in grid units."""

    i: str
    x: int
    y: int
    w: int
    h: int


class CanvasLayoutOut(BaseModel):
    id: int
    user_id: UUID | None
    layout_data: list[CanvasLayoutItem]

    model_config = ConfigDict(from_attributes=True)


class ImageryViewOut(BaseModel):
    id: int
    name: str
    display_order: int
    collection_refs: list[ViewCollectionRefItem]

    @computed_field
    @property
    def default_canvas_layout(self) -> CanvasLayoutOut | None:
        if hasattr(self, "_default_canvas_layout"):
            return self._default_canvas_layout
        return None

    @computed_field
    @property
    def personal_canvas_layout(self) -> CanvasLayoutOut | None:
        if hasattr(self, "_personal_canvas_layout"):
            return self._personal_canvas_layout
        return None

    @classmethod
    def from_orm(cls, obj, user_id: UUID | None = None):
        default_layout = None
        personal_layout = None
        if hasattr(obj, "canvas_layouts"):
            for layout in obj.canvas_layouts:
                if layout.is_default and layout.user_id is None:
                    default_layout = CanvasLayoutOut.model_validate(layout)
                elif user_id and layout.user_id == user_id:
                    personal_layout = CanvasLayoutOut.model_validate(layout)

        instance = cls.model_validate(obj)
        instance._default_canvas_layout = default_layout
        instance._personal_canvas_layout = personal_layout
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


class BasemapCreate(BaseModel):
    id: int | None = None
    name: str
    url: str
    max_native_zoom: int | None = None


class ViewCollectionRefCreate(BaseModel):
    collection_id: str  # frontend temp id - mapped by service
    source_id: str  # frontend temp id - mapped by service
    show_as_window: bool = True


class ImageryViewCreate(BaseModel):
    id: int | None = None
    name: str = ""
    collection_refs: list[ViewCollectionRefCreate] = []


class ImageryEditorStateCreate(BaseModel):
    """Full imagery editor state sent from the frontend on campaign creation."""

    sources: list[ImagerySourceCreate]
    views: list[ImageryViewCreate]
    basemaps: list[BasemapCreate]


# ============================================================================
# Update / Layout Request Schemas
# ============================================================================


class VisualizationUpdate(BaseModel):
    name: str


class ImagerySourceUpdate(BaseModel):
    """Partial update for an imagery source's display settings."""

    name: str | None = None
    crosshair_hex6: str | None = None
    default_zoom: int | None = None
    visualizations: list[VisualizationUpdate] | None = None


class ImageryCollectionUpdate(BaseModel):
    """Partial update for an imagery collection."""

    name: str | None = None
    cover_slice_index: int | None = None
    has_dedicated_cover: bool | None = None


class ImageryViewUpdate(BaseModel):
    """Partial update for an imagery view."""

    name: str | None = None
    display_order: int | None = None
    collection_refs: list[ViewCollectionRefItem] | None = None


class ImageryViewAddRequest(BaseModel):
    """Create a new view on an existing campaign."""

    name: str = ""
    collection_refs: list[ViewCollectionRefItem] = []


class CanvasLayoutCreate(BaseModel):
    main_layout_data: list
    view_layout_data: list | None = None
    view_id: int | None = None


class CanvasLayoutCreateRequest(BaseModel):
    layout: CanvasLayoutCreate
    should_be_default: bool = False
    view_id: int


class CreateImageryResponse(BaseModel):
    sources: list[ImagerySourceOut]
    views: list[ImageryViewOut]
    basemaps: list[BasemapOut]

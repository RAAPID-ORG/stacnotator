from uuid import UUID

from pydantic import BaseModel, ConfigDict, computed_field

# ============================================================================
# Slice / Collection / Source - Output Schemas
# ============================================================================


class SliceTileUrlOut(BaseModel):
    id: int
    visualization_name: str
    tile_url: str

    model_config = ConfigDict(from_attributes=True)


class ImagerySliceOut(BaseModel):
    id: int
    name: str
    start_date: str
    end_date: str
    display_order: int
    tile_urls: list[SliceTileUrlOut]

    model_config = ConfigDict(from_attributes=True)


class CollectionStacConfigOut(BaseModel):
    registration_url: str
    search_body: str

    model_config = ConfigDict(from_attributes=True)


class ImageryCollectionOut(BaseModel):
    id: int
    name: str
    cover_slice_index: int
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

    model_config = ConfigDict(from_attributes=True)


class BasemapOut(BaseModel):
    id: int
    name: str
    url: str

    model_config = ConfigDict(from_attributes=True)


class ViewCollectionRefItem(BaseModel):
    collection_id: int
    source_id: int
    show_as_window: bool = True


class CanvasLayoutOut(BaseModel):
    id: int
    user_id: UUID | None
    layout_data: list

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
    name: str = ""
    start_date: str
    end_date: str
    tile_urls: list[SliceTileUrlCreate] = []


class CollectionStacConfigCreate(BaseModel):
    registration_url: str
    search_body: str


class ImageryCollectionCreate(BaseModel):
    name: str
    cover_slice_index: int = 0
    slices: list[ImagerySliceCreate]
    stac_config: CollectionStacConfigCreate | None = None


class VisualizationTemplateCreate(BaseModel):
    name: str


class ImagerySourceCreate(BaseModel):
    name: str
    crosshair_hex6: str = "ff0000"
    default_zoom: int = 14
    visualizations: list[VisualizationTemplateCreate]
    collections: list[ImageryCollectionCreate]


class BasemapCreate(BaseModel):
    name: str
    url: str


class ViewCollectionRefCreate(BaseModel):
    collection_id: str  # frontend temp id - mapped by service
    source_id: str  # frontend temp id - mapped by service
    show_as_window: bool = True


class ImageryViewCreate(BaseModel):
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

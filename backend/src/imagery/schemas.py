from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationInfo,
    model_validator,
)

from src.canvas.schemas import CanvasLayoutOut, viewer_layouts
from src.planet.schemas import PlanetScenesGenerationConfig
from src.storage_access import StorageAccessCreate, StorageAccessOut

# ============================================================================
# Slice / Collection / Source - Output Schemas
# ============================================================================


class SliceTileOut(BaseModel):
    visualization_id: int
    url: str
    # "mpc", a hosted tiler's name, or None for a template a provider serves.
    tiler: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ImagerySliceOut(BaseModel):
    id: int
    name: str
    start_date: str
    end_date: str
    display_order: int
    # The visualizations that can be drawn now; one still registering is absent.
    tiles: list[SliceTileOut]

    model_config = ConfigDict(from_attributes=True)


class CollectionSearchOut(BaseModel):
    catalog_url: str
    stac_collection_id: str
    # null => default tiler.
    tiler: str | None = None
    search_query: dict | None = None
    cover_search_query: dict | None = None
    internal_storage: bool = False
    # The private catalog's access, as its kind and expiry only - never the secret.
    storage_access: StorageAccessOut | None = None

    model_config = ConfigDict(from_attributes=True)


class CollectionVisualizationOut(BaseModel):
    visualization_id: int
    params: dict
    cover_params: dict | None = None

    model_config = ConfigDict(from_attributes=True)


class ImageryCollectionOut(BaseModel):
    id: int
    name: str
    cover_slice_index: int
    has_dedicated_cover: bool = False
    display_order: int
    generation_series_id: int | None = None
    slices: list[ImagerySliceOut]
    # Null for a collection whose slices are given by URL templates.
    search: CollectionSearchOut | None = None
    visualizations: list[CollectionVisualizationOut] = []

    model_config = ConfigDict(from_attributes=True)


class VisualizationOut(BaseModel):
    id: int
    name: str
    display_order: int

    model_config = ConfigDict(from_attributes=True)


class StacGenerationConfig(BaseModel):
    """What the temporal generator was asked for: the period it covers and how it
    cut that period into windows and slices. Only what nothing else stores - the
    search and the visualizations live on each generated collection, where they can
    be edited one window at a time."""

    kind: Literal["stac"]
    collection_title: str
    # Whether the catalog's items carry eo:cloud_cover, which decides whether the
    # generator offers a cloud filter at all.
    has_cloud_cover: bool
    start_date: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    end_date: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    collection_period_interval: int = Field(ge=1)
    collection_period_unit: Literal["weeks", "months", "years"]
    slice_period_interval: int = Field(ge=1)
    slice_period_unit: Literal["days", "weeks", "months", "years"]
    cover_mode: Literal["nth", "custom"]
    cover_slice_nth: int = Field(ge=1)

    model_config = ConfigDict(extra="forbid")


GenerationConfig = Annotated[
    StacGenerationConfig | PlanetScenesGenerationConfig, Field(discriminator="kind")
]


class ImageryGenerationSeriesOut(BaseModel):
    id: int
    config: GenerationConfig

    model_config = ConfigDict(from_attributes=True)


class ImagerySourceOut(BaseModel):
    id: int
    name: str
    crosshair_hex6: str
    default_zoom: int
    max_native_zoom: int | None = None
    display_order: int
    visualizations: list[VisualizationOut]
    collections: list[ImageryCollectionOut]
    generation_series: list[ImageryGenerationSeriesOut] = []
    # Whether a provider API key is configured (drives the admin UI), and which
    # shared org key it is when the source uses one. The key value/ciphertext is
    # never serialized.
    has_api_key: bool = False
    organization_api_key_id: int | None = None
    # Per-source registration, read off the rows themselves: how much of this
    # source an annotator can actually see, and whether re-searching its
    # catalog could bring in newer imagery.
    slice_count: int = 0
    registered_slice_count: int = 0
    refreshable: bool = False

    model_config = ConfigDict(from_attributes=True)


class BasemapOut(BaseModel):
    id: int
    name: str
    url: str
    max_native_zoom: int | None = None
    has_api_key: bool = False
    organization_api_key_id: int | None = None

    model_config = ConfigDict(from_attributes=True)


class ProviderKeyCreate(BaseModel):
    """Where a layer's provider key comes from, set in the same save as the layer:
    one of the owning organization's shared keys, or a value encrypted on arrival.
    Write-only - a stored value is never read back, so an entry naming neither
    keeps whatever key the layer already has."""

    organization_api_key_id: int | None = None
    api_key: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def one_key_source_at_most(self) -> "ProviderKeyCreate":
        if self.api_key is not None and self.organization_api_key_id is not None:
            raise ValueError("Set at most one of api_key or organization_api_key_id")
        return self


class ImageryViewOut(BaseModel):
    id: int
    name: str
    display_order: int
    source_ids: list[int]

    # The view's default layout and the viewer's own (validation context user_id).
    default_canvas_layout: CanvasLayoutOut | None = None
    personal_canvas_layout: CanvasLayoutOut | None = None

    @model_validator(mode="wrap")
    @classmethod
    def _layouts(cls, data: Any, handler, info: ValidationInfo) -> "ImageryViewOut":
        out: ImageryViewOut = handler(data)
        if hasattr(data, "canvas_layouts"):
            out.default_canvas_layout, out.personal_canvas_layout = viewer_layouts(
                data.canvas_layouts, info
            )
        return out

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# Create Schemas
# ============================================================================


class SliceTemplateCreate(BaseModel):
    # A visualization of the same source, by name.
    visualization: str
    url: str


class ImagerySliceCreate(BaseModel):
    id: int | None = None
    name: str = ""
    start_date: str
    end_date: str
    # A manual slice's tile template per visualization; a STAC slice has none.
    templates: list[SliceTemplateCreate] = []


class RenderParams(BaseModel):
    """How a tiler draws a visualization of a STAC search."""

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


class CollectionVisualizationCreate(BaseModel):
    # A visualization of the same source, by name.
    visualization: str
    params: RenderParams
    cover_params: RenderParams | None = None


class CollectionSearchCreate(BaseModel):
    catalog_url: str
    stac_collection_id: str
    tiler: str | None = None  # hosted tiler name; null => DEFAULT_TILER
    search_query: dict | None = None
    cover_search_query: dict | None = None
    internal_storage: bool = False
    # A private catalog's access, write-only. Left out, a saved collection keeps its own.
    storage_access: StorageAccessCreate | None = None


class ImageryCollectionCreate(BaseModel):
    id: int | None = None
    name: str
    cover_slice_index: int = 0
    has_dedicated_cover: bool = False
    generation_series_key: str | None = None
    slices: list[ImagerySliceCreate]
    search: CollectionSearchCreate | None = None
    # A STAC collection's parameters for every visualization of its source.
    visualizations: list[CollectionVisualizationCreate] = []


class ImageryGenerationSeriesCreate(BaseModel):
    """One source-level series in the full-editor write model.

    ``key`` is a request-local identity used by collections in the same
    payload. ``id`` preserves an existing database row when editing.
    """

    key: str = Field(min_length=1)
    id: int | None = None
    config: GenerationConfig


class VisualizationCreate(BaseModel):
    """A visualization of the source. ``id`` keeps a stored one, so renaming it keeps its
    parameters; the name is what the rest of the payload refers to it by."""

    id: int | None = None
    name: str = Field(min_length=1)


class ImagerySourceCreate(ProviderKeyCreate):
    id: int | None = None
    name: str
    # Reaches the frontend as a colour, so it stays six hex digits and nothing else.
    crosshair_hex6: str = Field(default="ff0000", pattern=r"^[0-9a-fA-F]{6}$")
    default_zoom: int = 15
    max_native_zoom: int | None = Field(default=None, ge=0, le=22)
    visualizations: list[VisualizationCreate]
    generation_series: list[ImageryGenerationSeriesCreate] = []
    collections: list[ImageryCollectionCreate]

    @model_validator(mode="after")
    def visualizations_are_consistent(self) -> "ImagerySourceCreate":
        names = [r.name for r in self.visualizations]
        if len(names) != len(set(names)):
            raise ValueError("visualization names must be unique per source")
        ids = [r.id for r in self.visualizations if r.id is not None]
        if len(ids) != len(set(ids)):
            raise ValueError("visualization ids must be unique per source")
        for col in self.collections:
            drawn = [r.visualization for r in col.visualizations]
            if col.search is not None and sorted(drawn) != sorted(names):
                raise ValueError(
                    f"collection '{col.name}' must give parameters for each visualization once"
                )
            if col.search is None and drawn:
                raise ValueError(f"collection '{col.name}' has no search to render")
            for sl in col.slices:
                templated = [t.visualization for t in sl.templates]
                if col.search is not None and templated:
                    raise ValueError(f"STAC collection '{col.name}' takes no tile templates")
                if len(templated) != len(set(templated)) or not set(templated) <= set(names):
                    raise ValueError(f"slice templates of '{col.name}' name unknown visualizations")
        return self

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


class BasemapCreate(ProviderKeyCreate):
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

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from src.custom_layers.schemas import RenderConfig


class VisualizerImageryCreate(BaseModel):
    source_id: int


class VisualizerOverlayCreate(BaseModel):
    custom_map_id: int | None = None
    vector_layer_id: int | None = None
    visible: bool = True
    opacity: float = Field(default=1.0, ge=0, le=1)


class VisualizerCamera(BaseModel):
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    zoom: float = Field(ge=0, le=24)


class VisualizerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    is_public: bool = False
    camera: VisualizerCamera | None = None
    imagery: list[VisualizerImageryCreate] = Field(default_factory=list)
    overlays: list[VisualizerOverlayCreate] = Field(default_factory=list)


class VisualizerUpdate(BaseModel):
    """Absent fields stay as they are; a present list replaces the stored one."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    is_public: bool | None = None
    camera: VisualizerCamera | None = None
    imagery: list[VisualizerImageryCreate] | None = None
    overlays: list[VisualizerOverlayCreate] | None = None


class VisualizerListItemOut(BaseModel):
    id: int
    slug: str
    name: str
    description: str | None
    is_public: bool
    imagery_count: int
    overlay_count: int


class VisualizerTileOut(BaseModel):
    url: str
    # "mpc", a hosted tiler name, or null for a direct XYZ template. Decides
    # whether the browser must send its tiler cookie with the tile request.
    provider: str | None


class VisualizerStepOut(BaseModel):
    slice_id: int
    label: str
    start_date: str
    end_date: str
    tiles: dict[str, VisualizerTileOut]


class VisualizerImageryOut(BaseModel):
    source_id: int
    campaign_id: int
    name: str
    visualizations: list[str]
    default_zoom: int
    max_native_zoom: int | None
    has_api_key: bool
    steps: list[VisualizerStepOut]


class OverlayOutBase(BaseModel):
    id: int
    name: str
    visible: bool
    opacity: float


class RasterOverlayOut(OverlayOutBase):
    kind: Literal["raster"] = "raster"
    campaign_id: int
    tile_url: str | None
    render_config: RenderConfig
    max_native_zoom: int | None
    status: str
    mlops_url: str | None


class VectorOverlayOut(OverlayOutBase):
    kind: Literal["vector"] = "vector"
    pmtiles_url: str
    source_layer: str | None
    color: str


VisualizerOverlayOut = Annotated[RasterOverlayOut | VectorOverlayOut, Field(discriminator="kind")]


class VisualizerViewOut(BaseModel):
    """Everything the viewer page draws, and nothing about how it was authored."""

    id: int
    slug: str
    name: str
    description: str | None
    is_public: bool
    project_id: int
    project_name: str
    camera: VisualizerCamera | None
    imagery: list[VisualizerImageryOut]
    overlays: list[VisualizerOverlayOut]
    can_edit: bool


class VisualizerConfigOut(BaseModel):
    """The stored configuration, as the editor needs it back."""

    id: int
    slug: str
    project_id: int
    name: str
    description: str | None
    is_public: bool
    camera: VisualizerCamera | None
    imagery: list[VisualizerImageryCreate]
    overlays: list[VisualizerOverlayCreate]


class SourceOptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    step_count: int
    visualizations: list[str]
    start_date: str | None
    end_date: str | None


class OverlayOptionOut(BaseModel):
    id: int
    name: str
    status: str


class CampaignOptionsOut(BaseModel):
    campaign_id: int
    campaign_name: str
    sources: list[SourceOptionOut]
    raster_overlays: list[OverlayOptionOut]
    vector_overlays: list[OverlayOptionOut]


class VisualizerOptionsOut(BaseModel):
    """What this project has available to put on a visualizer."""

    campaigns: list[CampaignOptionsOut]


class TilerSessionOut(BaseModel):
    expires_in: int

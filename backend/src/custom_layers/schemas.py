from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

HEX_COLOR = r"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$"


class CategoricalEntry(BaseModel):
    value: int
    color: str = Field(pattern=r"^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")
    label: str = ""


# The one set of colormaps supported end to end: the tiler renders them (rio-tiler
# names) AND the frontend legend can draw their gradient. Growing this set means
# adding stops in frontend customMapColormaps.ts too, or legends stop matching tiles.
ColormapName = Literal[
    "viridis", "plasma", "magma", "inferno", "cividis", "turbo", "rdylgn", "rdbu"
]


class RenderConfig(BaseModel):
    mode: Literal["continuous", "categorical"]
    band: int = 1
    nodata: float | None = None
    colormap_name: ColormapName | None = None
    rescale: tuple[float, float] | None = None
    # Capped because the colormap is baked into every tile URL (uint8 class rasters
    # cannot exceed 256 values anyway).
    entries: list[CategoricalEntry] | None = Field(default=None, max_length=256)


class CustomMapCreate(BaseModel):
    name: str = Field(min_length=1)
    cog_url: str = Field(min_length=1)
    render_config: RenderConfig
    max_native_zoom: int | None = Field(default=None, ge=0, le=24)
    mlops_url: str | None = None
    internal_storage: bool = False


class CustomMapUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    cog_url: str | None = Field(default=None, min_length=1)
    render_config: RenderConfig | None = None
    max_native_zoom: int | None = Field(default=None, ge=0, le=24)
    display_order: int | None = None
    mlops_url: str | None = None
    internal_storage: bool | None = None


class CustomMapOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    campaign_id: int
    name: str
    cog_url: str
    render_config: RenderConfig
    max_native_zoom: int | None
    status: str
    status_error: dict | None
    tile_url: str | None
    mosaic_id: str | None
    display_order: int
    mlops_url: str | None
    internal_storage: bool


class VectorLayerCreate(BaseModel):
    name: str = Field(min_length=1)
    pmtiles_url: str = Field(min_length=1)
    source_layer: str | None = None
    color: str = Field(default="#3b82f6", pattern=HEX_COLOR)


class VectorLayerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    pmtiles_url: str | None = Field(default=None, min_length=1)
    source_layer: str | None = None
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    display_order: int | None = None


class VectorLayerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    campaign_id: int
    name: str
    pmtiles_url: str
    source_layer: str | None
    color: str
    display_order: int

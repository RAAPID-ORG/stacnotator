from typing import Literal
from urllib.parse import parse_qs, urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from src.custom_layers.render import build_viz_params
from src.storage_access import StorageAccessCreate, StorageAccessOut, check_url

HEX_COLOR = r"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$"
COLOR_BLUE = "#3b82f6"


class CategoricalEntry(BaseModel):
    value: int
    color: str = Field(pattern=r"^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")
    label: str = ""


# If extended must update customMapColormaps.ts too
ColormapName = Literal[
    "viridis", "plasma", "magma", "inferno", "cividis", "turbo", "rdylgn", "rdbu"
]


class RenderConfig(BaseModel):
    mode: Literal["continuous", "categorical"]
    band: int = 1
    nodata: float | None = None
    colormap_name: ColormapName | None = None
    rescale: tuple[float, float] | None = None
    entries: list[CategoricalEntry] | None = Field(default=None, max_length=256)

    @model_validator(mode="after")
    def _renderable(self) -> "RenderConfig":
        """build_viz_params is the authority on what can actually render; an
        unrenderable config never parses (stored rows conform since migration
        aa8rendfix)."""
        build_viz_params(self.model_dump(mode="json"))
        return self


class CustomMapAccess(BaseModel):
    storage_access: StorageAccessCreate | None = None

    @field_validator("cog_url", check_fields=False)
    @classmethod
    def no_inline_sas(cls, value: str | None) -> str | None:
        if value and "sig" in parse_qs(urlparse(value).query):
            raise ValueError("Paste the SAS token in storage_access, not in the COG URL")
        return value


class CustomMapCreate(CustomMapAccess):
    name: str = Field(min_length=1)
    cog_url: str = Field(min_length=1)
    render_config: RenderConfig
    max_native_zoom: int | None = Field(default=None, ge=0, le=24)
    mlops_url: str | None = None
    internal_storage: bool = False

    @model_validator(mode="after")
    def valid_storage_access(self) -> "CustomMapCreate":
        if self.storage_access is not None:
            check_url(self.cog_url)
            if self.internal_storage:
                raise ValueError("Choose either a SAS token or internal storage, not both")
        return self


class CustomMapUpdate(CustomMapAccess):
    name: str | None = Field(default=None, min_length=1)
    cog_url: str | None = Field(default=None, min_length=1)
    render_config: RenderConfig | None = None
    max_native_zoom: int | None = Field(default=None, ge=0, le=24)
    display_order: int | None = None
    mlops_url: str | None = None
    internal_storage: bool | None = None

    @model_validator(mode="after")
    def valid_storage_access(self) -> "CustomMapUpdate":
        if self.storage_access is not None:
            if self.cog_url is not None:
                check_url(self.cog_url)
            if self.internal_storage:
                raise ValueError("Choose either a SAS token or internal storage, not both")
        return self


class CustomMapOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    # A custom map belongs to a campaign or a visualizer, never both, so each id is
    # optional. Requiring campaign_id made listing a visualizer's own maps fail
    # validation on the way out - a 500 on a plain read.
    campaign_id: int | None = None
    visualizer_id: int | None = None
    name: str
    cog_url: str
    render_config: RenderConfig
    max_native_zoom: int | None
    status: str
    status_errors: list[dict] | None
    tile_url: str | None
    mosaic_id: str | None
    display_order: int
    mlops_url: str | None
    internal_storage: bool
    storage_access: StorageAccessOut | None = None


class VectorLayerCreate(BaseModel):
    name: str = Field(min_length=1)
    pmtiles_url: str = Field(min_length=1)
    source_layer: str | None = None
    color: str = Field(default=COLOR_BLUE, pattern=HEX_COLOR)


class VectorLayerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    pmtiles_url: str | None = Field(default=None, min_length=1)
    source_layer: str | None = None
    color: str | None = Field(default=None, pattern=HEX_COLOR)
    display_order: int | None = None


class VectorLayerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    # As CustomMapOut: owned by a campaign or a visualizer, so neither id is required.
    campaign_id: int | None = None
    visualizer_id: int | None = None
    name: str
    pmtiles_url: str
    source_layer: str | None
    color: str
    display_order: int

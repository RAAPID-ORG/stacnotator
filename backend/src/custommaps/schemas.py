from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CategoricalEntry(BaseModel):
    value: int
    color: str = Field(pattern=r"^#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")
    label: str = ""


class RenderConfig(BaseModel):
    mode: Literal["continuous", "categorical"]
    band: int = 1
    nodata: float | None = None
    colormap_name: str | None = None
    rescale: tuple[float, float] | None = None
    entries: list[CategoricalEntry] | None = None


class CustomMapCreate(BaseModel):
    name: str = Field(min_length=1)
    cog_url: str = Field(min_length=1)
    render_config: RenderConfig
    opacity: int = Field(default=100, ge=0, le=100)
    max_native_zoom: int | None = Field(default=None, ge=0, le=24)


class CustomMapUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    cog_url: str | None = Field(default=None, min_length=1)
    render_config: RenderConfig | None = None
    opacity: int | None = Field(default=None, ge=0, le=100)
    max_native_zoom: int | None = Field(default=None, ge=0, le=24)
    display_order: int | None = None


class CustomMapOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    campaign_id: int
    name: str
    cog_url: str
    render_config: RenderConfig
    opacity: int
    max_native_zoom: int | None
    status: str
    status_error: dict | None
    tile_url: str | None
    mosaic_id: str | None
    display_order: int

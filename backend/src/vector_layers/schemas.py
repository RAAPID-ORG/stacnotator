from pydantic import BaseModel, ConfigDict, Field

HEX_COLOR = r"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$"


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

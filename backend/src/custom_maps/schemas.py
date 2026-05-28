from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CustomMapCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    original_filename: str = Field(min_length=1, max_length=255)


class CustomMapUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    display_order: int | None = None
    viz_params: dict | None = None


class CustomMapOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    campaign_id: int
    name: str
    status: str
    display_order: int
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    band_count: int | None = None
    min_value: float | None = None
    max_value: float | None = None
    viz_params: dict | None = None
    # Frontend prefixes this with VITE_TILER_BASE_URL. Null until status=ready.
    tile_url_template: str | None = None


class CustomMapUploadOut(BaseModel):
    custom_map: CustomMapOut
    upload_url: str
    upload_path: str
    expires_in: int

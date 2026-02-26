import json
import re
from uuid import UUID

from pydantic import BaseModel, ValidationInfo, computed_field, field_validator

# ============================================================================
# Imagery Related Schemas
# ============================================================================


class ImageryVisualizationUrlTemplateOut(BaseModel):
    """
    TiTiler visualization URL template for imagery.
    """

    id: int
    name: str
    visualization_url: str

    class Config:
        from_attributes = True


class ImageryVisualizationUrlTemplateCreate(BaseModel):
    """
    Defines a (TiTiler) visualization URL template for imagery.
    The URL must contain {z}, {x}, {y} placeholders for tile access and {searchId} for the search ID.
    """

    name: str
    visualization_url: str

    @field_validator("visualization_url")
    @classmethod
    def validate_url_template(cls, v):
        # Basic validation to ensure required placeholders are present
        required_placeholders = ["{z}", "{x}", "{y}", "{searchId}"]
        for placeholder in required_placeholders:
            if placeholder not in v:
                raise ValueError(f"visualization_url must contain the placeholder {placeholder}")
        return v


class CanvasLayoutOut(BaseModel):
    """
    Frontend Canvas layout configuration.

    Can be either personal or might be the default for the campaign.
    Typically one layout is either the general section or imagery specific.
    """

    id: int
    user_id: UUID | None
    layout_data: list

    class Config:
        from_attributes = True


class CanvasLayoutCreate(BaseModel):
    """
    Request body to create or update a canvas layout.
    """

    main_layout_data: list
    imagery_layout_data: list | None = None
    imagery_id: int | None = None


class ImageryOut(BaseModel):
    """
    Represents an imagery dataset configuration within a campaign.

    Windows define time-windows for seperate visualization chunks of the
    start and end year-month range. The windows are defined by the window_interval
    and window_unit fields. For example, a window_interval of 3 and window_unit of
    'months' would create 3-month windows within the overall date range.

    Slicing defines how the imagery data is further sliced within each window. Tjis
    is often useful to e.g see all imagery within a month. The slicing_interval and slicing_unit
    fields define this behavior. For example, a slicing_interval of 1 and slicing_unit of
    'week' would slice the data into weekly chunks within each window.
    """

    id: int
    name: str
    start_ym: str
    end_ym: str
    crosshair_hex6: str
    default_zoom: int
    window_interval: int | None
    window_unit: str | None
    slicing_interval: int | None
    slicing_unit: str | None
    registration_url: str
    search_body: dict
    visualization_url_templates: list[ImageryVisualizationUrlTemplateOut]

    class Config:
        from_attributes = True


class ImageryCreate(BaseModel):
    name: str
    start_ym: str
    end_ym: str
    crosshair_hex6: str
    default_zoom: int
    window_interval: int | None = None
    window_unit: str | None = None
    slicing_interval: int | None = None
    slicing_unit: str | None = None
    registration_url: str
    search_body: str
    visualization_url_templates: list[ImageryVisualizationUrlTemplateCreate]

    # enforce that if window interval is set unit is set
    @field_validator("window_unit")
    @classmethod
    def check_window_unit(cls, v, info: ValidationInfo):
        if info.data.get("window_interval") is not None and v is None:
            raise ValueError("window_unit must be set if window_interval is set")
        return v

    @field_validator("slicing_unit")
    @classmethod
    def check_slicing_unit(cls, v, info: ValidationInfo):
        if info.data.get("slicing_interval") is not None and v is None:
            raise ValueError("slicing_unit must be set if slicing_interval is set")
        return v

    @field_validator("start_ym", "end_ym", mode="before")
    @classmethod
    def normalize_ym(cls, v: str) -> str:
        if not isinstance(v, str):
            raise ValueError("Year-month must be a string")

        # Accept YYYY-MM
        if re.fullmatch(r"\d{4}-\d{2}", v):
            return v.replace("-", "")

        # Accept YYYYMM
        if re.fullmatch(r"\d{6}", v):
            return v

        raise ValueError("Year-month must be in YYYY-MM or YYYYMM format")

    @field_validator("search_body", mode="before")
    @classmethod
    def validate_search_body(cls, v):
        if isinstance(v, dict):
            return json.dumps(v)  # Convert dict to string
        if isinstance(v, str):
            # Validate JSON validity
            try:
                json.loads(v)
            except json.JSONDecodeError as e:
                raise ValueError("search_body must be valid JSON string") from e
        return v


class ImageryUpdate(BaseModel):
    """
    Update schema for imagery - excludes temporal fields that cannot be changed
    after creation (start_ym, end_ym, window_interval, window_unit, slicing_interval, slicing_unit).
    """

    name: str | None = None
    crosshair_hex6: str | None = None
    default_zoom: int | None = None
    registration_url: str | None = None
    search_body: str | None = None
    visualization_url_templates: list[ImageryVisualizationUrlTemplateCreate] | None = None

    @field_validator("search_body", mode="before")
    @classmethod
    def validate_search_body(cls, v):
        if v is None:
            return v
        if isinstance(v, dict):
            return json.dumps(v)  # Convert dict to string
        if isinstance(v, str):
            # Validate JSON validity
            try:
                json.loads(v)
            except json.JSONDecodeError as e:
                raise ValueError("search_body must be valid JSON string") from e
        return v


class ImageryBulkCreate(BaseModel):
    items: list[ImageryCreate]


class ImageryWindowOut(BaseModel):
    window_start_date: str
    window_end_date: str
    id: int
    window_index: int

    class Config:
        from_attributes = True


class ImageryWithWindowsOut(ImageryOut):
    """
    Imagery with associated time-windows.
    """

    default_main_window_id: int
    windows: list[ImageryWindowOut]

    @computed_field
    @property
    def default_canvas_layout(self) -> CanvasLayoutOut | None:
        """Get the default canvas layout for this imagery."""
        if hasattr(self, "_default_canvas_layout"):
            return self._default_canvas_layout
        return None

    @computed_field
    @property
    def personal_canvas_layout(self) -> CanvasLayoutOut | None:
        """Get the personal canvas layout for the current user."""
        if hasattr(self, "_personal_canvas_layout"):
            return self._personal_canvas_layout
        return None

    @classmethod
    def from_orm(cls, obj, user_id: UUID | None = None):
        """Override from_orm to extract default and personal layouts from canvas_layouts."""
        # Find the default and personal canvas layouts for this imagery
        default_layout = None
        personal_layout = None

        if hasattr(obj, "canvas_layouts"):
            for layout in obj.canvas_layouts:
                if layout.is_default and layout.user_id is None:
                    default_layout = CanvasLayoutOut.model_validate(layout)
                elif user_id and layout.user_id == user_id:
                    personal_layout = CanvasLayoutOut.model_validate(layout)

        # Build dict from ORM object - use parent class's fields
        base_data = {
            "id": obj.id,
            "name": obj.name,
            "start_ym": obj.start_ym,
            "end_ym": obj.end_ym,
            "crosshair_hex6": obj.crosshair_hex6,
            "default_zoom": obj.default_zoom,
            "window_interval": obj.window_interval,
            "window_unit": obj.window_unit,
            "slicing_interval": obj.slicing_interval,
            "slicing_unit": obj.slicing_unit,
            "registration_url": obj.registration_url,
            "search_body": obj.search_body,
            "visualization_url_templates": obj.visualization_url_templates,
            "default_main_window_id": obj.default_main_window_id,
            "windows": obj.windows,
        }

        # Create instance
        instance = cls.model_validate(base_data)
        # Store the layouts
        instance._default_canvas_layout = default_layout
        instance._personal_canvas_layout = personal_layout
        return instance


# ============================================================================
# Specific Request / Response Schemas
# ============================================================================


class CanvasLayoutCreateRequest(BaseModel):
    layout: CanvasLayoutCreate
    should_be_default: bool = False  # Then it is a personal layout
    imagery_id: int


class CreateImageryResponse(BaseModel):
    new_items: list[ImageryOut]

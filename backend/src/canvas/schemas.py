from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CanvasLayoutItem(BaseModel):
    """One react-grid-layout tile: grid id and position/size in grid units."""

    i: str
    x: int
    y: int
    w: int
    h: int
    orientation: Literal["horizontal", "vertical"] | None = None
    expanded_sections: (
        list[Literal["sources", "visualizations", "collections", "slices"]] | None
    ) = None
    slice_navigation: bool | None = None


class CanvasLayoutOut(BaseModel):
    id: int
    user_id: UUID | None
    layout_data: list[CanvasLayoutItem]

    model_config = ConfigDict(from_attributes=True)


class CanvasLayoutCreate(BaseModel):
    main_layout_data: list[CanvasLayoutItem]
    view_layout_data: list[CanvasLayoutItem] | None = None


class CanvasLayoutCreateRequest(BaseModel):
    layout: CanvasLayoutCreate
    should_be_default: bool = False
    view_id: int

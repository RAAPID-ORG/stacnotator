from collections.abc import Iterable
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, ValidationInfo


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


def viewer_layouts(
    layouts: Iterable[Any], info: ValidationInfo
) -> tuple[CanvasLayoutOut | None, CanvasLayoutOut | None]:
    """The default layout among `layouts`, and the personal one of the viewer
    named by the validation context's user_id."""
    user_id = (info.context or {}).get("user_id")
    default = personal = None
    for layout in layouts:
        if layout.is_default and layout.user_id is None:
            default = CanvasLayoutOut.model_validate(layout)
        elif user_id is not None and layout.user_id == user_id:
            personal = CanvasLayoutOut.model_validate(layout)
    return default, personal


class CanvasLayoutCreate(BaseModel):
    main_layout_data: list[CanvasLayoutItem]
    view_layout_data: list[CanvasLayoutItem] | None = None


class CanvasLayoutCreateRequest(BaseModel):
    layout: CanvasLayoutCreate
    should_be_default: bool = False
    view_id: int

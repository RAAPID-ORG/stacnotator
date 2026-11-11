"""An edit to how a visualization is drawn, applied to the parameters each collection
already gives it.

An edit names only the fields it changes, so collections that draw the same
visualization with their own band ranges or a dedicated cover keep everything else.
It never touches what decides the provider (compositing, masking), so applying one
needs no mosaic registered again.
"""

from src.imagery.schemas import RenderParams


def patched(params: dict, patch: dict) -> dict:
    """``params`` with ``patch`` applied: a value replaces, a null clears."""
    merged = dict(params)
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    rendered = RenderParams.model_validate(merged)
    if not (rendered.assets or rendered.expression):
        raise ValueError("the edited visualization has no bands selected")
    return rendered.model_dump(exclude_none=True)

"""Who a layer belongs to.

Campaigns and visualizers both own imagery, basemaps and overlays. Every
table that can hang off either carries this pair and derives its tile scope
from it, so the rule lives in one place rather than four.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class LayerOwner:
    """Who a layer belongs to, and the scope its tiles are served under.

    Imagery sources, basemaps and overlays all hang off either a campaign or a
    visualizer, because both set layers up the same way. The scope is the string
    the tiler and the tile proxy match a request against: a campaign keeps its
    bare id, which is what every search registered so far is stamped with, and a
    visualizer takes a prefixed one, so the two can never be confused for each
    other.
    """

    campaign_id: int | None = None
    visualizer_id: int | None = None

    @property
    def tile_scope(self) -> str:
        if self.campaign_id is not None:
            return str(self.campaign_id)
        return f"visualizer:{self.visualizer_id}"

    def as_columns(self) -> dict[str, int | None]:
        return {"campaign_id": self.campaign_id, "visualizer_id": self.visualizer_id}

"""Who a layer belongs to.

Campaigns and visualizers both own imagery, basemaps and overlays. Every
table that can hang off either carries this pair and derives its tile scope
from it, so the rule lives in one place rather than four. The layers a tiler
registers (imagery sources and custom maps) also name themselves with a
``tile_layer``, so a token can grant one of them without its owner.
"""

from dataclasses import dataclass
from typing import Annotated
from urllib.parse import urlparse

from pydantic import AfterValidator
from sqlalchemy import CheckConstraint, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column


@dataclass(frozen=True)
class LayerOwner:
    """Who a layer belongs to, and the scope its tiles are served under.

    Imagery sources, basemaps and overlays all hang off either a campaign or a
    visualizer, because both set layers up the same way. The scope is the string
    the tiler and the tile proxy match a request's ``owners`` against: a campaign
    keeps its bare id and a visualizer takes a prefixed one, so the two can never
    be confused for each other.
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


class OwnedLayer:
    """The owner columns of a layer table. Exactly one is set; each table states that
    with ``one_owner_check``."""

    campaign_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"), nullable=True
    )
    visualizer_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.visualizers.id", ondelete="CASCADE"), nullable=True
    )

    @property
    def owner(self) -> LayerOwner:
        return LayerOwner(campaign_id=self.campaign_id, visualizer_id=self.visualizer_id)


def one_owner_check(table: str) -> CheckConstraint:
    return CheckConstraint(
        "(campaign_id IS NULL) <> (visualizer_id IS NULL)", name=f"{table}_one_owner_check"
    )


def _http_url(value: str) -> str:
    parsed = urlparse(value.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("Must be an http(s) URL")
    return value


# A tile template keeps its {z}/{x}/{y} placeholders, so this checks the shape only.
HttpUrl = Annotated[str, AfterValidator(_http_url)]

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.database import Base

if TYPE_CHECKING:
    from src.campaigns.models import Campaign
    from src.imagery.models import ImageryView


class CanvasLayout(Base):
    """
    Stores UI canvas layout configuration for views or campaign settings.
    Can be user-specific (personal layout) or serve as a default layout (is_default=True).

    Layout types:
    - Campaign main layout: campaign_id set, view_id NULL
    - View-specific layout: campaign_id set, view_id set
    """

    __tablename__ = "canvas_layouts"
    __table_args__ = (
        CheckConstraint(
            "(is_default = false) OR (is_default = true AND user_id IS NULL)",
            name="canvas_layouts_default_check",
        ),
        Index("idx_canvas_layouts_campaign_id", "campaign_id"),
        Index("idx_canvas_layouts_user_id", "user_id"),
        Index("idx_canvas_layouts_view_id", "view_id"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    user_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=True,
    )

    campaign_id: Mapped[int] = mapped_column(
        ForeignKey("data.campaigns.id", ondelete="CASCADE"),
        nullable=False,
    )

    view_id: Mapped[int | None] = mapped_column(
        ForeignKey("data.imagery_views.id", ondelete="CASCADE"),
        nullable=True,
    )

    is_default: Mapped[bool] = mapped_column(
        server_default="false",
        nullable=False,
    )

    layout_data: Mapped[list] = mapped_column(
        JSONB,
        server_default="[]",
        nullable=False,
    )

    campaign: Mapped["Campaign"] = relationship(
        back_populates="canvas_layouts",
    )
    imagery_view: Mapped["ImageryView | None"] = relationship(
        back_populates="canvas_layouts",
    )

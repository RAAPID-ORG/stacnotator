"""Verify ORM column annotations for user_id match the actual UUID DB schema."""

import typing
from uuid import UUID

from src.campaigns.models import CampaignUser
from src.canvas.models import CanvasLayout


def _get_mapped_inner(annotation):
    """Extract the inner type from a Mapped[T] annotation string or object."""
    # annotation may be a string (forward ref) or a real type
    # For Mapped[UUID | None], get_args returns (UUID | None,)
    args = typing.get_args(annotation)
    return args[0] if args else None


def test_canvas_layout_user_id_is_uuid_mapped():
    """CanvasLayout.user_id Mapped annotation must reference UUID, not int."""
    annotation = CanvasLayout.__annotations__.get("user_id")
    inner = _get_mapped_inner(annotation)
    inner_args = typing.get_args(inner)
    assert UUID in inner_args or inner is UUID, (
        f"Expected UUID in CanvasLayout.user_id annotation, got: {annotation}"
    )


def test_campaign_user_user_id_is_uuid_mapped():
    """CampaignUser.user_id Mapped annotation must be UUID, not int."""
    annotation = CampaignUser.__annotations__.get("user_id")
    inner = _get_mapped_inner(annotation)
    assert inner is UUID, f"Expected UUID in CampaignUser.user_id annotation, got: {annotation}"

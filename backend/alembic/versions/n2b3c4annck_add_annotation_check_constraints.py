"""add annotation check constraints: confidence range + flag-comment invariant

Revision ID: n2b3c4annck
Revises: m8a9b0c1d2e3
Create Date: 2026-06-20 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "n2b3c4annck"
down_revision: str | Sequence[str] | None = "m8a9b0c1d2e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_check_constraint(
        "annotations_confidence_range",
        "annotations",
        "confidence IS NULL OR (confidence >= 0 AND confidence <= 10)",
        schema="data",
    )
    op.create_check_constraint(
        "annotations_flag_comment_requires_flag",
        "annotations",
        "flagged_for_review = true OR flag_comment IS NULL",
        schema="data",
    )


def downgrade() -> None:
    op.drop_constraint(
        "annotations_flag_comment_requires_flag",
        "annotations",
        schema="data",
        type_="check",
    )
    op.drop_constraint(
        "annotations_confidence_range",
        "annotations",
        schema="data",
        type_="check",
    )

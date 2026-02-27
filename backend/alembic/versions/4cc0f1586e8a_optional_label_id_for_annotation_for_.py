"""optional label id for annotation for skipping

Revision ID: 4cc0f1586e8a
Revises: 087ef48a2b45
Create Date: 2025-12-23 21:20:44.551713

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4cc0f1586e8a"
down_revision: str | Sequence[str] | None = "087ef48a2b45"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        "annotations",
        "label_id",
        schema="data",
        existing_type=sa.Integer(),
        nullable=True,
    )

    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        "annotations",
        "label_id",
        schema="data",
        existing_type=sa.Integer(),
        nullable=False,
    )
    # ### end Alembic commands ###

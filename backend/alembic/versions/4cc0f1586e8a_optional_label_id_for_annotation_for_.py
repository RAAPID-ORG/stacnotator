"""optional label id for annotation for skipping

Revision ID: 4cc0f1586e8a
Revises: 087ef48a2b45
Create Date: 2025-12-23 21:20:44.551713

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4cc0f1586e8a"
down_revision: Union[str, Sequence[str], None] = "087ef48a2b45"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


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

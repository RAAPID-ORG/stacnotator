"""rename target_classes to labels

Revision ID: ecdf64d23d4e
Revises: cc5e7947d19c
Create Date: 2025-12-18 13:49:11.756401

"""

from collections.abc import Sequence

from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ecdf64d23d4e"
down_revision: str | Sequence[str] | None = "cc5e7947d19c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():
    # Rename column (preserves JSONB data)
    op.alter_column(
        "settings",
        "target_classes",
        new_column_name="labels",
        schema="data",
        existing_type=postgresql.JSONB(),
        existing_nullable=False,
    )


def downgrade():
    # Reverse rename
    op.alter_column(
        "settings",
        "labels",
        new_column_name="target_classes",
        schema="data",
        existing_type=postgresql.JSONB(),
        existing_nullable=False,
    )

"""add_unique_constraint_on_user_email

Revision ID: f5bd1b96c424
Revises: 4cc0f1586e8a
Create Date: 2025-12-25 13:54:12.953638

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f5bd1b96c424"
down_revision: str | Sequence[str] | None = "4cc0f1586e8a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add unique constraint on email column
    op.create_unique_constraint("users_email_uniq", "users", ["email"], schema="auth")


def downgrade() -> None:
    """Downgrade schema."""
    # Remove unique constraint on email column
    op.drop_constraint("users_email_uniq", "users", schema="auth", type_="unique")

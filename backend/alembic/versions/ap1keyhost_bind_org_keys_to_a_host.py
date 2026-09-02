"""bind organization API keys to the host they may be sent to

A shared key is stored by an organization admin and pointed at by campaign admins,
who also write the tile URLs it gets substituted into. The host is what separates
those two powers: the tile proxy sends the key there and refuses anywhere else.

Deliberately not backfilled. The only evidence on hand is the host in the tile URLs
already using each key - which is written by the very people the binding is meant to
constrain, so inferring from it would let a badly-pointed key bind itself to wherever
it was already being sent. Existing rows stay null and serve no tiles until an
organization admin names the host, which is one edit per key in Settings.

Revision ID: ap1keyhost
Revises: ao6vizverdict
Create Date: 2026-09-02 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ap1keyhost"
down_revision: str | Sequence[str] | None = "ao6vizverdict"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "organization_api_keys",
        sa.Column("allowed_tile_host", sa.String(length=255), nullable=True),
        schema="data",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("organization_api_keys", "allowed_tile_host", schema="data")

"""remove Carto default basemaps

Revision ID: ar1nocarto
Revises: aq1agents
Create Date: 2026-09-20 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "ar1nocarto"
down_revision: str | Sequence[str] | None = "aq1agents"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM data.basemaps
        WHERE (name, url) IN (
            (
                'CartoDB Light',
                'https://{a-c}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
            ),
            (
                'Carto Light',
                'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'
            )
        )
        """
    )


def downgrade() -> None:
    # Deleted defaults cannot be distinguished from identical user-created rows.
    pass

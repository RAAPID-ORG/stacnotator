"""Tag every stored generation config with its kind; drop the Planet aoi

STAC generator configs saved before Planet scene sources existed carry no ``kind``,
so the API had to default it and could not discriminate the two shapes. A Planet
scene config's ``aoi`` stopped being read once the search moved to annotation time.

Revision ID: av6genkind
Revises: av5drift
Create Date: 2026-10-23
"""

from collections.abc import Sequence

from alembic import op

revision: str = "av6genkind"
down_revision: str | Sequence[str] | None = "av5drift"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE data.imagery_generation_series
        SET config = config || '{"kind": "stac"}'::jsonb
        WHERE NOT config ? 'kind'
        """
    )
    op.execute(
        """
        UPDATE data.imagery_generation_series
        SET config = config - 'aoi'
        WHERE config ->> 'kind' = 'planet_scenes'
        """
    )


def downgrade() -> None:
    pass

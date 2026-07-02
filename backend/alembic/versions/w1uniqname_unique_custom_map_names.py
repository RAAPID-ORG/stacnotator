"""unique custom map names per campaign

Revision ID: w1uniqname
Revises: v1mlopsurl
Create Date: 2026-07-02 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "w1uniqname"
down_revision: str | Sequence[str] | None = "v1mlopsurl"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE data.custom_maps
        SET name = name || '-' || id
        WHERE id NOT IN (
            SELECT MIN(id) FROM data.custom_maps GROUP BY campaign_id, name
        )
        """
    )
    op.create_unique_constraint(
        "uq_custom_maps_campaign_name",
        "custom_maps",
        ["campaign_id", "name"],
        schema="data",
    )


def downgrade() -> None:
    op.drop_constraint("uq_custom_maps_campaign_name", "custom_maps", schema="data")

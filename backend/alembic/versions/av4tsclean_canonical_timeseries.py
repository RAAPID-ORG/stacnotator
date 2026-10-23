"""Time series store canonical source and index keys, and no provider.

Lookups used to be case- and padding-insensitive so hand-edited rows still
resolved. The rows are normalized instead, and a series naming a source or index
that no longer exists is dropped: it could not be fetched anyway. Earth Engine
is the one provider there has ever been, so the column goes.

Revision ID: av4tsclean
Revises: av3policyaxes
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "av4tsclean"
down_revision: str | Sequence[str] | None = "av3policyaxes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SOURCES = ("SENTINEL2", "LANDSAT", "MODIS")
INDICES = ("NDVI", "EVI2", "GCVI", "NDMI", "TCW", "NBR", "MNDWI", "NDRE")


def upgrade() -> None:
    op.execute(
        "UPDATE data.time_series SET data_source = upper(trim(data_source)), "
        "ts_type = upper(trim(ts_type)), window_name = trim(window_name)"
    )
    op.execute("UPDATE data.time_series SET window_name = 'Time series' WHERE window_name = ''")
    sources = ", ".join(f"'{s}'" for s in SOURCES)
    indices = ", ".join(f"'{i}'" for i in INDICES)
    op.execute(
        f"DELETE FROM data.time_series "
        f"WHERE data_source NOT IN ({sources}) OR ts_type NOT IN ({indices})"
    )
    op.drop_column("time_series", "provider", schema="data")


def downgrade() -> None:
    op.add_column(
        "time_series",
        sa.Column("provider", sa.String(), server_default="EE", nullable=False),
        schema="data",
    )

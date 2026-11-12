from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "avRcustomidx"
down_revision: str | Sequence[str] | None = "avQannundo"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "custom_indices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "campaign_id",
            sa.Integer(),
            sa.ForeignKey("data.campaigns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("expression", sa.String(), nullable=False),
        sa.Column("domain_min", sa.Float(), nullable=False),
        sa.Column("domain_max", sa.Float(), nullable=False),
        sa.Column(
            "reference_lines",
            postgresql.ARRAY(sa.Float()),
            server_default="{}",
            nullable=False,
        ),
        sa.UniqueConstraint("campaign_id", "name", name="uq_custom_indices_campaign_name"),
        schema="data",
    )


def downgrade() -> None:
    # The previous release resolves every series through the built-in indices,
    # so a series plotting a custom one would break its campaign's reads.
    in_use = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT count(*) FROM data.time_series ts JOIN data.custom_indices ci"
                " ON ci.campaign_id = ts.campaign_id AND ci.name = ts.ts_type"
            )
        )
        .scalar_one()
    )
    if in_use:
        raise RuntimeError(
            f"{in_use} time series plot a custom index; remove them before downgrading"
        )
    op.drop_table("custom_indices", schema="data")

"""Normalize legacy bare-string labels to the object format.

Rows written before labels became objects stored {"1": "Forest"}; the current
format is {"1": {"name": "Forest", "geometry_type": "polygon"}}. Rewrites every
string value to {"name": <value>} so the read paths no longer need a legacy
branch.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "aa5labelobj"
down_revision: str | Sequence[str] | None = "aa4viewsrc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE data.settings s
        SET labels = (
            SELECT jsonb_object_agg(
                e.key,
                CASE
                    WHEN jsonb_typeof(e.value) = 'object' THEN e.value
                    ELSE jsonb_build_object('name', e.value #>> '{}')
                END
            )
            FROM jsonb_each(s.labels) e
        )
        WHERE EXISTS (
            SELECT 1 FROM jsonb_each(s.labels) e
            WHERE jsonb_typeof(e.value) <> 'object'
        )
        """
    )


def downgrade() -> None:
    # The normalization is not reversible (the original shape is gone), and the
    # object format is readable by all prior code paths anyway.
    pass

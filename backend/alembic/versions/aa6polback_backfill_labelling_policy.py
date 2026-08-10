"""Backfill empty labelling policies; assert every campaign has settings.

get_labelling_policy loses its legacy default-fallback: every campaign must
have a settings row whose labelling_policy is a full policy object. Rows with
an empty policy (predating the z1labelpolicy backfill semantics) get the
default; a campaign with no settings row at all cannot be repaired here (a
settings row needs a real bbox), so its existence aborts the migration for
manual attention.
"""

from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

revision: str = "aa6polback"
down_revision: str | Sequence[str] | None = "aa5labelobj"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_POLICY = (
    '{"explore": {"kinds": ["members"], "user_ids": []}, '
    '"unassigned_tasks": {"kinds": ["members"], "user_ids": []}, '
    '"assigned_tasks": {"kinds": ["members"], "user_ids": []}, '
    '"complete_assigned": {"kinds": ["assignees", "admins", "authoritative"], "user_ids": []}}'
)


def upgrade() -> None:
    conn = op.get_bind()
    orphans = conn.execute(
        text(
            """
            SELECT count(*) FROM data.campaigns c
            LEFT JOIN data.campaign_settings s ON s.campaign_id = c.id
            WHERE s.campaign_id IS NULL
            """
        )
    ).scalar()
    if orphans:
        raise RuntimeError(
            f"{orphans} campaign(s) have no campaign_settings row; backfill them "
            "manually before this migration (the code no longer tolerates it)."
        )
    conn.execute(
        text(
            "UPDATE data.campaign_settings SET labelling_policy = (:policy)::jsonb "
            "WHERE labelling_policy IS NULL OR labelling_policy = '{}'::jsonb"
        ),
        {"policy": DEFAULT_POLICY},
    )


def downgrade() -> None:
    # The backfilled default is indistinguishable from an explicitly chosen
    # one; nothing to restore.
    pass

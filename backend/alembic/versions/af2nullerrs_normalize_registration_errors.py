"""Normalize campaigns.registration_errors written as JSON null

Clearing the column through the ORM used to persist the JSON scalar 'null'
instead of SQL NULL, which made finish_status_run's `||` append produce arrays
like [null]. Those rows fail CampaignOut validation, so GET /campaigns/{id}
500s. Drop the bad shapes; the model change stops new ones.

Revision ID: af2nullerrs
Revises: af1tasktime
Create Date: 2026-08-14
"""

from alembic import op

revision = "af2nullerrs"
down_revision = "af1tasktime"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE data.campaigns SET registration_errors = NULL "
        "WHERE registration_errors IS NOT NULL "
        "  AND jsonb_typeof(registration_errors) <> 'array'"
    )
    op.execute(
        "UPDATE data.campaigns SET registration_errors = coalesce("
        "    (SELECT jsonb_agg(e) FROM jsonb_array_elements(registration_errors) e "
        "     WHERE jsonb_typeof(e) = 'object'),"
        "    '[]'::jsonb) "
        "WHERE registration_errors IS NOT NULL "
        "  AND EXISTS (SELECT 1 FROM jsonb_array_elements(registration_errors) e "
        "              WHERE jsonb_typeof(e) <> 'object')"
    )


def downgrade() -> None:
    pass

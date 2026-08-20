"""index annotations by (campaign_id, updated_at) for the changes poll

Open-mode annotators poll for each other's work every 20s. Without this the
poll scans every annotation in the campaign, which on a dense campaign is the
most expensive query on the page and runs once per annotator per interval.

Revision ID: am1annotchg
Revises: al1username
Create Date: 2026-08-19
"""

from alembic import op

revision = "am1annotchg"
down_revision = "al1username"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "idx_annotations_campaign_updated_at",
        "annotations",
        ["campaign_id", "updated_at"],
        schema="data",
    )


def downgrade() -> None:
    op.drop_index("idx_annotations_campaign_updated_at", table_name="annotations", schema="data")

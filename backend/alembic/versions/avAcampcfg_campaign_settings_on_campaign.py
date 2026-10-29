"""A campaign's settings live on the campaign

``data.settings`` was a 1:1 table created and deleted with its campaign, with no
lifecycle or permissions of its own. Its columns move onto ``data.campaigns``.
Labels are stored as the list the API speaks
(``[{"id", "name", "geometry_type"}]``) instead of a dict keyed by id, and a
label that never named a geometry type is a polygon, which is what every reader
already assumed.

Revision ID: avAcampcfg
Revises: av9taskrows
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "avAcampcfg"
down_revision: str | Sequence[str] | None = "av9taskrows"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_POLICY = (
    '{"explore":{"kinds":["admins","authoritative","members"],"user_ids":[]},'
    '"unassigned_tasks":{"kinds":["admins","authoritative","members"],"user_ids":[]},'
    '"assigned_tasks":{"kinds":["admins","authoritative","members"],"user_ids":[]},'
    '"complete_assigned":{"kinds":["assignees","admins","authoritative"],"user_ids":[]},'
    '"modify_others":{"kinds":["admins"],"user_ids":[]}}'
)

COPIED = (
    "bbox_west",
    "bbox_south",
    "bbox_east",
    "bbox_north",
    "form_fields",
    "guide_markdown",
    "sample_extent_meters",
    "task_output",
    "embedding_year",
    "research_sharing",
    "labelling_policy",
)

CHECKS = {
    "campaigns_bbox_west_range": "bbox_west BETWEEN -180 AND 180",
    "campaigns_bbox_east_range": "bbox_east BETWEEN -180 AND 180",
    "campaigns_bbox_south_range": "bbox_south BETWEEN -90 AND 90",
    "campaigns_bbox_north_range": "bbox_north BETWEEN -90 AND 90",
    "campaigns_bbox_lon_order": "bbox_west < bbox_east",
    "campaigns_bbox_lat_order": "bbox_south < bbox_north",
    "campaigns_task_output_values": "task_output IN ('classify', 'draw')",
}


def _columns(server_defaults: bool) -> list[sa.Column]:
    def default(value: str) -> sa.TextClause | None:
        return sa.text(value) if server_defaults else None

    return [
        sa.Column("bbox_west", sa.Float(), nullable=True),
        sa.Column("bbox_south", sa.Float(), nullable=True),
        sa.Column("bbox_east", sa.Float(), nullable=True),
        sa.Column("bbox_north", sa.Float(), nullable=True),
        sa.Column("labels", JSONB(), server_default=default("'[]'::jsonb"), nullable=True),
        sa.Column("form_fields", JSONB(), server_default=default("'[]'::jsonb"), nullable=True),
        sa.Column("guide_markdown", sa.String(), nullable=True),
        sa.Column("sample_extent_meters", sa.Float(), nullable=True),
        sa.Column("task_output", sa.String(20), server_default=default("'classify'"), nullable=True),
        sa.Column("embedding_year", sa.Integer(), nullable=True),
        sa.Column("research_sharing", sa.Boolean(), server_default=default("false"), nullable=True),
        sa.Column(
            "labelling_policy",
            JSONB(),
            server_default=default(f"'{DEFAULT_POLICY}'::jsonb"),
            nullable=True,
        ),
    ]


REQUIRED = (
    "bbox_west",
    "bbox_south",
    "bbox_east",
    "bbox_north",
    "labels",
    "form_fields",
    "task_output",
    "research_sharing",
    "labelling_policy",
)


def upgrade() -> None:
    for column in _columns(server_defaults=True):
        op.add_column("campaigns", column, schema="data")
    assignments = ", ".join(f"{c} = s.{c}" for c in COPIED)
    op.execute(
        f"UPDATE data.campaigns c SET {assignments}, labels = COALESCE(("
        "SELECT jsonb_agg(jsonb_build_object("
        "'id', e.key::int, 'name', e.value->>'name', "
        "'geometry_type', COALESCE(e.value->>'geometry_type', 'polygon')"
        ") ORDER BY e.key::int) FROM jsonb_each(s.labels) e), '[]'::jsonb) "
        "FROM data.settings s WHERE s.campaign_id = c.id"
    )
    # A campaign that somehow never got a settings row keeps its data and covers
    # the world until an admin narrows it.
    op.execute(
        "UPDATE data.campaigns SET bbox_west = -180, bbox_south = -90, bbox_east = 180, "
        "bbox_north = 90 WHERE bbox_west IS NULL"
    )
    for column in REQUIRED:
        op.alter_column("campaigns", column, nullable=False, schema="data")
    for name, condition in CHECKS.items():
        op.create_check_constraint(name, "campaigns", condition, schema="data")
    op.drop_table("settings", schema="data")


def downgrade() -> None:
    op.create_table(
        "settings",
        sa.Column(
            "campaign_id",
            sa.Integer(),
            sa.ForeignKey("data.campaigns.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("labels", JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        *(c for c in _columns(server_defaults=True) if c.name != "labels"),
        sa.CheckConstraint("bbox_west BETWEEN -180 AND 180", name="settings_bbox_west_range"),
        sa.CheckConstraint("bbox_east BETWEEN -180 AND 180", name="settings_bbox_east_range"),
        sa.CheckConstraint("bbox_south BETWEEN -90 AND 90", name="settings_bbox_south_range"),
        sa.CheckConstraint("bbox_north BETWEEN -90 AND 90", name="settings_bbox_north_range"),
        sa.CheckConstraint("bbox_west < bbox_east", name="settings_bbox_lon_order"),
        sa.CheckConstraint("bbox_south < bbox_north", name="settings_bbox_lat_order"),
        sa.CheckConstraint(
            "task_output IN ('classify', 'draw')", name="settings_task_output_values"
        ),
        schema="data",
    )
    columns = ", ".join(COPIED)
    op.execute(
        f"INSERT INTO data.settings (campaign_id, labels, {columns}) "
        f"SELECT c.id, COALESCE((SELECT jsonb_object_agg(l->>'id', "
        "jsonb_build_object('name', l->>'name', 'geometry_type', l->>'geometry_type')) "
        f"FROM jsonb_array_elements(c.labels) l), '{{}}'::jsonb), {columns} FROM data.campaigns c"
    )
    for column in REQUIRED:
        if column != "labels":
            op.alter_column("settings", column, nullable=False, schema="data")
    for name in CHECKS:
        op.drop_constraint(name, "campaigns", schema="data")
    for column in _columns(server_defaults=False):
        op.drop_column("campaigns", column.name, schema="data")

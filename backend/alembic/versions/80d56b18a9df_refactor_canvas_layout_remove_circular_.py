"""refactor_canvas_layout_remove_circular_refs

Revision ID: 80d56b18a9df
Revises: 97f7875c837c
Create Date: 2026-01-03 14:48:27.213596

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "80d56b18a9df"
down_revision: str | Sequence[str] | None = "97f7875c837c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Step 1: Add new columns to canvas_layouts (nullable for now)
    op.add_column(
        "canvas_layouts", sa.Column("campaign_id", sa.Integer(), nullable=True), schema="data"
    )
    op.add_column(
        "canvas_layouts", sa.Column("imagery_id", sa.Integer(), nullable=True), schema="data"
    )
    op.add_column(
        "canvas_layouts",
        sa.Column("is_default", sa.Boolean(), server_default="false", nullable=False),
        schema="data",
    )

    # Step 2: Migrate existing data
    # For each campaign, set campaign_id on its default_main_canvas_layout and mark as default
    op.execute("""
        UPDATE data.canvas_layouts cl
        SET campaign_id = c.id,
            is_default = true
        FROM data.campaigns c
        WHERE cl.id = c.default_main_canvas_layout_id
    """)

    # For each imagery, set campaign_id and imagery_id on its default_canvas_layout and mark as default
    op.execute("""
        UPDATE data.canvas_layouts cl
        SET campaign_id = i.campaign_id,
            imagery_id = i.id,
            is_default = true
        FROM data.imagery i
        WHERE cl.id = i.default_canvas_layout_id
    """)

    # Step 3: Add foreign key constraints
    op.drop_constraint(
        op.f("canvas_layouts_user_id_fkey"), "canvas_layouts", schema="data", type_="foreignkey"
    )
    op.create_foreign_key(
        None,
        "canvas_layouts",
        "users",
        ["user_id"],
        ["id"],
        source_schema="data",
        referent_schema="auth",
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        None,
        "canvas_layouts",
        "campaigns",
        ["campaign_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        None,
        "canvas_layouts",
        "imagery",
        ["imagery_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="CASCADE",
    )

    # Step 4: Add check constraint for default layouts
    # Default layouts must have user_id IS NULL (they're not personal)
    op.create_check_constraint(
        "canvas_layouts_default_check",
        "canvas_layouts",
        "(is_default = false) OR (is_default = true AND user_id IS NULL)",
        schema="data",
    )

    # Step 5: Drop old columns from campaigns and imagery
    op.drop_constraint(
        op.f("campaigns_default_main_canvas_layout_id_fkey"),
        "campaigns",
        schema="data",
        type_="foreignkey",
    )
    op.drop_column("campaigns", "default_main_canvas_layout_id", schema="data")

    op.drop_constraint(
        op.f("imagery_default_canvas_layout_id_fkey"), "imagery", schema="data", type_="foreignkey"
    )
    op.drop_column("imagery", "default_canvas_layout_id", schema="data")


def downgrade() -> None:
    """Downgrade schema."""
    # Step 1: Re-add old columns to campaigns and imagery
    op.add_column(
        "campaigns",
        sa.Column(
            "default_main_canvas_layout_id", sa.INTEGER(), autoincrement=False, nullable=True
        ),
        schema="data",
    )
    op.add_column(
        "imagery",
        sa.Column("default_canvas_layout_id", sa.INTEGER(), autoincrement=False, nullable=True),
        schema="data",
    )

    # Step 2: Migrate data back
    # Set default_main_canvas_layout_id on campaigns
    op.execute("""
        UPDATE data.campaigns c
        SET default_main_canvas_layout_id = cl.id
        FROM data.canvas_layouts cl
        WHERE cl.campaign_id = c.id
          AND cl.is_default = true
          AND cl.imagery_id IS NULL
    """)

    # Set default_canvas_layout_id on imagery
    op.execute("""
        UPDATE data.imagery i
        SET default_canvas_layout_id = cl.id
        FROM data.canvas_layouts cl
        WHERE cl.imagery_id = i.id
          AND cl.is_default = true
    """)

    # Step 3: Make columns not nullable now that they're populated
    op.alter_column("campaigns", "default_main_canvas_layout_id", nullable=False, schema="data")
    op.alter_column("imagery", "default_canvas_layout_id", nullable=False, schema="data")

    # Step 4: Re-add foreign keys
    op.create_foreign_key(
        op.f("campaigns_default_main_canvas_layout_id_fkey"),
        "campaigns",
        "canvas_layouts",
        ["default_main_canvas_layout_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        op.f("imagery_default_canvas_layout_id_fkey"),
        "imagery",
        "canvas_layouts",
        ["default_canvas_layout_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="CASCADE",
    )

    # Step 5: Drop new columns and constraints from canvas_layouts
    op.drop_constraint(
        "canvas_layouts_default_check", "canvas_layouts", schema="data", type_="check"
    )
    op.drop_constraint(None, "canvas_layouts", schema="data", type_="foreignkey")
    op.drop_constraint(None, "canvas_layouts", schema="data", type_="foreignkey")
    op.drop_constraint(None, "canvas_layouts", schema="data", type_="foreignkey")
    op.create_foreign_key(
        op.f("canvas_layouts_user_id_fkey"),
        "canvas_layouts",
        "users",
        ["user_id"],
        ["id"],
        source_schema="data",
        referent_schema="auth",
        ondelete="SET NULL",
    )
    op.drop_column("canvas_layouts", "is_default", schema="data")
    op.drop_column("canvas_layouts", "imagery_id", schema="data")
    op.drop_column("canvas_layouts", "campaign_id", schema="data")

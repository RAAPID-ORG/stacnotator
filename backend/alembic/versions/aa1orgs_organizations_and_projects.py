"""organizations and projects: three-level tenancy

Creates the org/project tables, wraps every existing campaign in its own
single-campaign project under a NASA Harvest org (memberships lifted from
campaign_users with roles intact), then drops campaign_users and moves
is_public from campaigns to projects.

Revision ID: aa1orgs
Revises: 25ef6f2bba24
Create Date: 2026-08-05 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import context, op
from src.tilers import registry

revision: str = "aa1orgs"
down_revision: str | Sequence[str] | None = "25ef6f2bba24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LEGACY_ORG_NAME = "NASA Harvest"


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", sa.Integer(), sa.Identity(always=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("allows_internal_storage", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "created_by",
            sa.Uuid(),
            sa.ForeignKey("auth.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="organizations_name_uniq"),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="organizations_status_check",
        ),
        schema="data",
    )
    op.create_table(
        "organization_users",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("data.organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="active", nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("user_id", "organization_id"),
        sa.CheckConstraint(
            "status IN ('pending', 'active')", name="organization_users_status_check"
        ),
        schema="data",
    )
    op.create_index(
        "organization_users_organization_id_idx",
        "organization_users",
        ["organization_id"],
        schema="data",
    )
    op.create_table(
        "organization_tilers",
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("data.organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tiler_name", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("organization_id", "tiler_name"),
        schema="data",
    )
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), sa.Identity(always=True), nullable=False),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("data.organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_public", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "created_by",
            sa.Uuid(),
            sa.ForeignKey("auth.users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        # Temporary bridge for the campaign -> project backfill; dropped below.
        sa.Column("legacy_campaign_id", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="data",
    )
    op.create_index("projects_organization_id_idx", "projects", ["organization_id"], schema="data")
    op.create_table(
        "project_users",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("data.projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("is_authoritative_reviewer", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("user_id", "project_id"),
        schema="data",
    )
    op.create_index("project_users_project_id_idx", "project_users", ["project_id"], schema="data")

    op.add_column("campaigns", sa.Column("project_id", sa.Integer(), nullable=True), schema="data")

    # Backfill. Skipped entirely on a fresh database (no users, no campaigns).
    op.execute(
        f"""
        INSERT INTO data.organizations (name, status, allows_internal_storage, created_by)
        SELECT '{LEGACY_ORG_NAME}', 'approved', true,
               (SELECT user_id FROM auth.user_roles WHERE role = 'admin' LIMIT 1)
        WHERE EXISTS (SELECT 1 FROM auth.users)
           OR EXISTS (SELECT 1 FROM data.campaigns)
        """
    )
    # Approved users become members; platform admins become org admins.
    op.execute(
        f"""
        INSERT INTO data.organization_users (user_id, organization_id, is_admin, status)
        SELECT approved.user_id, o.id,
               EXISTS (
                   SELECT 1 FROM auth.user_roles a
                   WHERE a.user_id = approved.user_id AND a.role = 'admin'
               ),
               'active'
        FROM (SELECT DISTINCT user_id FROM auth.user_roles WHERE role = 'approved') approved
        CROSS JOIN data.organizations o
        WHERE o.name = '{LEGACY_ORG_NAME}'
        """
    )
    if not context.is_offline_mode():
        conn = op.get_bind()
        org_id = conn.execute(
            sa.text("SELECT id FROM data.organizations WHERE name = :n"), {"n": LEGACY_ORG_NAME}
        ).scalar()
        if org_id is not None:
            for tiler_name in registry.all_names():
                conn.execute(
                    sa.text(
                        "INSERT INTO data.organization_tilers (organization_id, tiler_name) "
                        "VALUES (:o, :t)"
                    ),
                    {"o": org_id, "t": tiler_name},
                )
    # One single-campaign project per campaign, carrying name/visibility/age.
    op.execute(
        f"""
        INSERT INTO data.projects
            (organization_id, name, is_public, created_at, legacy_campaign_id)
        SELECT o.id, c.name, c.is_public, c.created_at, c.id
        FROM data.campaigns c
        CROSS JOIN data.organizations o
        WHERE o.name = '{LEGACY_ORG_NAME}'
        """
    )
    op.execute(
        "UPDATE data.campaigns c SET project_id = p.id "
        "FROM data.projects p WHERE p.legacy_campaign_id = c.id"
    )
    op.execute(
        """
        INSERT INTO data.project_users (user_id, project_id, is_admin, is_authoritative_reviewer)
        SELECT cu.user_id, c.project_id, cu.is_admin, cu.is_authoritative_reviewer
        FROM data.campaign_users cu
        JOIN data.campaigns c ON c.id = cu.campaign_id
        """
    )
    op.drop_column("projects", "legacy_campaign_id", schema="data")

    op.alter_column("campaigns", "project_id", nullable=False, schema="data")
    op.create_foreign_key(
        "campaigns_project_id_fkey",
        "campaigns",
        "projects",
        ["project_id"],
        ["id"],
        source_schema="data",
        referent_schema="data",
        ondelete="CASCADE",
    )
    op.create_index("idx_campaigns_project_id", "campaigns", ["project_id"], schema="data")
    op.drop_table("campaign_users", schema="data")
    op.drop_column("campaigns", "is_public", schema="data")


def downgrade() -> None:
    op.add_column(
        "campaigns",
        sa.Column("is_public", sa.Boolean(), server_default="false", nullable=False),
        schema="data",
    )
    op.execute(
        "UPDATE data.campaigns c SET is_public = p.is_public "
        "FROM data.projects p WHERE p.id = c.project_id"
    )
    op.create_table(
        "campaign_users",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "campaign_id",
            sa.Integer(),
            sa.ForeignKey("data.campaigns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("is_authoritative_reviewer", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "campaign_id"),
        schema="data",
    )
    op.create_index(
        "idx_campaign_users_campaign_id", "campaign_users", ["campaign_id"], schema="data"
    )
    op.execute(
        """
        INSERT INTO data.campaign_users (user_id, campaign_id, is_admin, is_authoritative_reviewer)
        SELECT pu.user_id, c.id, pu.is_admin, pu.is_authoritative_reviewer
        FROM data.project_users pu
        JOIN data.campaigns c ON c.project_id = pu.project_id
        """
    )
    op.drop_index("idx_campaigns_project_id", "campaigns", schema="data")
    op.drop_constraint("campaigns_project_id_fkey", "campaigns", schema="data")
    op.drop_column("campaigns", "project_id", schema="data")
    op.drop_index("project_users_project_id_idx", "project_users", schema="data")
    op.drop_table("project_users", schema="data")
    op.drop_index("projects_organization_id_idx", "projects", schema="data")
    op.drop_table("projects", schema="data")
    op.drop_table("organization_tilers", schema="data")
    op.drop_index("organization_users_organization_id_idx", "organization_users", schema="data")
    op.drop_table("organization_users", schema="data")
    op.drop_table("organizations", schema="data")

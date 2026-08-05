"""project visibility scopes and pre-authorization invites

Replaces projects.is_public with a three-scope visibility column
('private' | 'organization' | 'public'; public rows keep their reach,
everything else stays private) and adds the data.invites table: email
pre-authorizations targeting exactly one org or project, consumed silently
at registration.

Downgrade collapses 'organization' into is_public=false (org-public reach is
not representable in the boolean model) and drops the invites table.

Revision ID: aa3visinv
Revises: aa2roles
Create Date: 2026-08-05 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "aa3visinv"
down_revision: str | Sequence[str] | None = "aa2roles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("visibility", sa.String(length=20), server_default="private", nullable=False),
        schema="data",
    )
    op.execute("UPDATE data.projects SET visibility = 'public' WHERE is_public")
    op.create_check_constraint(
        "projects_visibility_check",
        "projects",
        "visibility IN ('private', 'organization', 'public')",
        schema="data",
    )
    op.drop_column("projects", "is_public", schema="data")

    op.create_table(
        "invites",
        sa.Column("id", sa.Integer(), sa.Identity(always=True), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("data.organizations.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "project_id",
            sa.Integer(),
            sa.ForeignKey("data.projects.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "invited_by",
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
        sa.Column("consumed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("consumed_by", sa.Uuid(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "(organization_id IS NULL) != (project_id IS NULL)",
            name="invites_exactly_one_target_check",
        ),
        schema="data",
    )
    op.create_index("invites_email_idx", "invites", ["email"], schema="data")


def downgrade() -> None:
    op.drop_index("invites_email_idx", "invites", schema="data")
    op.drop_table("invites", schema="data")

    op.add_column(
        "projects",
        sa.Column("is_public", sa.Boolean(), server_default="false", nullable=False),
        schema="data",
    )
    op.execute("UPDATE data.projects SET is_public = true WHERE visibility = 'public'")
    op.drop_constraint("projects_visibility_check", "projects", schema="data")
    op.drop_column("projects", "visibility", schema="data")

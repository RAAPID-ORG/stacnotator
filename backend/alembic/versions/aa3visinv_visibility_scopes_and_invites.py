"""project visibility scopes

Replaces projects.is_public with a three-scope visibility column
('private' | 'organization' | 'public'; public rows keep their reach,
everything else stays private).

Downgrade collapses 'organization' into is_public=false (org-public reach is
not representable in the boolean model).

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


def downgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("is_public", sa.Boolean(), server_default="false", nullable=False),
        schema="data",
    )
    op.execute("UPDATE data.projects SET is_public = true WHERE visibility = 'public'")
    op.drop_constraint("projects_visibility_check", "projects", schema="data")
    op.drop_column("projects", "visibility", schema="data")

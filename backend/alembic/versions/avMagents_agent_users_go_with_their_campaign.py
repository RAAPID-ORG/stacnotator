"""Agent users left behind by deleted campaigns are removed

A labelling agent is a user made for one campaign. Deleting the campaign
removed its labelling_agents row but kept the user and its project membership,
so a project listed workers that no longer existed. Campaign deletion now
deletes them; this removes the ones already left behind.

Revision ID: avMagents
Revises: avLtidy
Create Date: 2026-10-24
"""

from collections.abc import Sequence

from alembic import op

revision: str = "avMagents"
down_revision: str | Sequence[str] | None = "avLtidy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM auth.users u
        WHERE u.issuer = 'agent'
          AND NOT EXISTS (SELECT 1 FROM data.labelling_agents a WHERE a.user_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM data.annotations n WHERE n.created_by_user_id = u.id)
        """
    )


def downgrade() -> None:
    """The deleted users held nothing but a membership; there is nothing to restore."""

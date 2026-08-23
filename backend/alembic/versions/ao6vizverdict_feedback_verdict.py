"""a one-click read on the area, beside the note

Feedback that only ever arrives as prose has to be read one item at a time.
A verdict makes a pile of it countable, and is enough on its own: the
"say something" constraint now accepts a verdict as well as a class or a note.

Revision ID: ao6vizverdict
Revises: ao5vizov
Create Date: 2026-08-23
"""

import sqlalchemy as sa

from alembic import op

revision = "ao6vizverdict"
down_revision = "ao5vizov"
branch_labels = None
depends_on = None

SAYS_SOMETHING = "feedback_says_something_check"


def upgrade() -> None:
    op.add_column(
        "visualizer_feedback",
        sa.Column("verdict", sa.String(length=16), nullable=True),
        schema="data",
    )
    op.create_check_constraint(
        "feedback_verdict_values",
        "visualizer_feedback",
        "verdict IN ('good', 'wrong')",
        schema="data",
    )
    op.drop_constraint(SAYS_SOMETHING, "visualizer_feedback", schema="data")
    op.create_check_constraint(
        SAYS_SOMETHING,
        "visualizer_feedback",
        "verdict IS NOT NULL OR suggested_label IS NOT NULL OR note IS NOT NULL",
        schema="data",
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM data.visualizer_feedback WHERE suggested_label IS NULL AND note IS NULL"
    )
    op.drop_constraint(SAYS_SOMETHING, "visualizer_feedback", schema="data")
    op.create_check_constraint(
        SAYS_SOMETHING,
        "visualizer_feedback",
        "suggested_label IS NOT NULL OR note IS NOT NULL",
        schema="data",
    )
    op.drop_constraint("feedback_verdict_values", "visualizer_feedback", schema="data")
    op.drop_column("visualizer_feedback", "verdict", schema="data")

"""make display names unique usernames

The display name is the one name people are known by, so two accounts must not
share it. Existing names are kept as they are - only exact case-insensitive
collisions are suffixed - because renaming people would be worse than a slightly
odd handle. New accounts start with no name at all: the client asks for one.

Revision ID: al1username
Revises: ak1research
"""

from collections.abc import Sequence

from alembic import op

revision: str = "al1username"
down_revision: str | Sequence[str] | None = "ak1research"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # A name-less existing account would be prompted for a username on its next
    # sign-in; seeding from the email keeps everyone who is already in place.
    op.execute(
        """
        UPDATE auth.users
        SET display_name = split_part(email, '@', 1)
        WHERE display_name IS NULL OR btrim(display_name) = ''
        """
    )
    # Oldest account keeps the name; every later collision gets a numeric suffix.
    op.execute(
        """
        WITH ranked AS (
            SELECT id,
                   display_name,
                   row_number() OVER (
                       PARTITION BY lower(display_name) ORDER BY created_at, id
                   ) AS position
            FROM auth.users
        )
        UPDATE auth.users AS u
        SET display_name = ranked.display_name || '-' || ranked.position
        FROM ranked
        WHERE u.id = ranked.id AND ranked.position > 1
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX users_display_name_lower_uniq ON auth.users (lower(display_name))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX auth.users_display_name_lower_uniq")

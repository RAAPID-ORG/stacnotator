"""Username rules.

A username is the one name other people see, so it has to be unique and
readable. This module owns the shape; uniqueness is the database's answer
(a unique index on the lowercased name), not this module's.
"""

import re

MIN_LENGTH = 3
MAX_LENGTH = 30
_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")

RULES = "Use letters, digits, dots, underscores or hyphens, starting with a letter or digit"


def username_error(username: str) -> str | None:
    """Why this username cannot be used, or None when it is well formed."""
    if len(username) < MIN_LENGTH:
        return f"Username must be at least {MIN_LENGTH} characters"
    if len(username) > MAX_LENGTH:
        return f"Username must be at most {MAX_LENGTH} characters"
    if not _PATTERN.match(username):
        return RULES
    return None

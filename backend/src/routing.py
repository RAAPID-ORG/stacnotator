"""FastAPI plumbing shared by every router: operation IDs and download headers.

Operation IDs are derived from endpoint function names (snake_case -> camelCase)
so the generated frontend client (frontend/src/api/client) gets stable
function/type names across regenerations.
"""

import re
import unicodedata

from fastapi.routing import APIRoute

_UNSAFE_IN_FILENAME = re.compile(r"[^a-zA-Z0-9]+")
_MAX_STEM = 100


def snake_to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def generate_unique_id(route: APIRoute) -> str:
    """OpenAPI operation ID from the endpoint function name."""
    return snake_to_camel(route.endpoint.__name__)


def attachment_headers(name: str, extension: str) -> dict[str, str]:
    """``Content-Disposition`` for a download, with the name made safe.

    Export names are built from campaign names, which are user-supplied and
    would otherwise reach the header verbatim: they are normalised to ASCII and
    stripped of everything that would need quoting or escaping there.
    """
    stem = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    stem = _UNSAFE_IN_FILENAME.sub("_", stem).strip("_").lower()[:_MAX_STEM]
    return {"Content-Disposition": f'attachment; filename="{stem}.{extension}"'}

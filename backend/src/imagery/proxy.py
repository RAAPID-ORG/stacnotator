"""Pure helpers for the backend tile proxy (no DB / network / framework).

The browser always requests the proxy as ``.../tiles/{z}/{x}/{y}``; this module turns the
stored provider template (which may use ``{api_key}``, ``{z}/{x}/{y}``, ``{q}`` quadkey, or
``{a-c}``-style subdomain placeholders) into the concrete upstream URL to fetch.
"""

import re

_PLACEHOLDER = re.compile(r"\{([^{}]+)\}")


def quadkey(x: int, y: int, z: int) -> str:
    """Bing/quadkey encoding of an XYZ tile coordinate (for ``{q}`` templates)."""
    digits = []
    for i in range(z, 0, -1):
        digit = 0
        mask = 1 << (i - 1)
        if x & mask:
            digit += 1
        if y & mask:
            digit += 2
        digits.append(str(digit))
    return "".join(digits)


def build_upstream_tile_url(template: str, z: int, x: int, y: int, api_key: str) -> str:
    """Substitute tile coords + the API key into a provider URL template.

    Unknown placeholders are left intact; ``{a-c}``/``{1-3}`` subdomain ranges resolve to
    their first option (the proxy fetches a single deterministic upstream URL)."""

    def repl(match: re.Match) -> str:
        name = match.group(1)
        if name == "z":
            return str(z)
        if name == "x":
            return str(x)
        if name == "y":
            return str(y)
        if name == "q":
            return quadkey(x, y, z)
        if name == "api_key":
            return api_key
        if "-" in name:  # subdomain range, e.g. {a-c} or {1-3}
            return name.split("-", 1)[0]
        return match.group(0)

    return _PLACEHOLDER.sub(repl, template)

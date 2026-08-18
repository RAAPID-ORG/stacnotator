"""Unified registry of which tilers exist. MPC and hosted tilers are presented uniformly
(one ``Tiler`` shape, one allow-set per organization); MPC is special-cased only in routing
(``providers.py``), not here.

Imports ``src.config`` ONLY (no providers/router), so ``auth.models`` can use it without
an import cycle.
"""

from collections.abc import Collection
from dataclasses import dataclass
from urllib.parse import urlparse

from src.config import get_settings

MPC = "mpc"
HOSTED = "hosted"
MPC_STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"


def is_mpc_url(url: str) -> bool:
    """Whether ``url`` points at the Microsoft Planetary Computer."""
    host = (urlparse(url).hostname or "").lower()
    return host == "planetarycomputer.microsoft.com" or host.endswith(
        ".planetarycomputer.microsoft.com"
    )


def origin(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}".lower()


@dataclass(frozen=True)
class Tiler:
    name: str
    kind: str  # MPC | HOSTED
    url: str | None  # hosted only; None for MPC
    is_default: bool  # default hosted pick for non-MPC collections
    default_access: bool  # seeded (pre-ticked) for new users
    stac_url: str | None  # browsable STAC catalog; None => not browsable
    title: str | None = None  # human-friendly catalog name for the wizard (falls back to name)
    allows_ingest: bool = False  # can pull an arbitrary external STAC catalog into its pgstac


def all_tilers() -> list[Tiler]:
    """Every tiler the system knows: MPC plus each configured hosted tiler.

    ``default_access`` (seeded for every organization) = MPC + the configured
    ``DEFAULT_TILER``. Every other hosted tiler is an "extra" a platform admin has to
    put on an organization's allowlist explicitly.
    """
    settings = get_settings()
    tilers = [
        Tiler(
            name=MPC,
            kind=MPC,
            url=None,
            is_default=False,
            default_access=True,
            stac_url=MPC_STAC_URL,
        )
    ]
    for name, cfg in settings.TILERS.items():
        is_default = name == settings.DEFAULT_TILER
        tilers.append(
            Tiler(
                name=name,
                kind=HOSTED,
                url=cfg.url,
                is_default=is_default,
                default_access=is_default,
                stac_url=cfg.stac_url,
                title=cfg.title,
                allows_ingest=cfg.allows_ingest,
            )
        )
    return tilers


def default_access_names() -> set[str]:
    """Tilers seeded on a newly approved organization: MPC + the default hosted tiler."""
    return {t.name for t in all_tilers() if t.default_access}


def all_names() -> list[str]:
    """Every configured tiler name (the full set an admin can put on an org allowlist)."""
    return [t.name for t in all_tilers()]


def browsable_tilers() -> list[Tiler]:
    """Tilers that advertise a browsable STAC catalog (``stac_url`` set)."""
    return [t for t in all_tilers() if t.stac_url]


def is_known(name: str) -> bool:
    """Whether ``name`` is a configured tiler (MPC or a hosted TILERS key)."""
    return any(t.name == name for t in all_tilers())


def get(name: str | None) -> Tiler | None:
    """Look up a tiler by name."""
    return next((t for t in all_tilers() if t.name == name), None)


def tiler_of_catalog(catalog_url: str) -> Tiler | None:
    """The hosted tiler whose own STAC API this URL points at, if any. Its items are
    already in that tiler's pgstac, so it needs no ingest to serve them. MPC is a public
    catalog, not a platform one, so it never matches here."""
    catalog_origin = origin(catalog_url)
    for tiler in all_tilers():
        if tiler.kind != MPC and tiler.stac_url and origin(tiler.stac_url) == catalog_origin:
            return tiler
    return None


def serving_tiler(catalog_url: str, pinned: str | None, allowed: Collection[str]) -> Tiler | None:
    """The hosted tiler that would render tiles for ``catalog_url``, or None when the
    organization has none that can.

    A catalog hosted on a platform tiler is served by that tiler. Anything else (MPC,
    StacIndex, a user-supplied URL) has to be ingested first, so it needs a tiler that
    allows ingest - falling back off a pinned tiler that cannot, since the pin follows the
    catalog while the need for a tiler comes from the visualization (compositing/masking).
    """
    allowed_names = set(allowed)
    own = tiler_of_catalog(catalog_url)
    if own is not None and own.name in allowed_names:
        return own
    candidates = [
        t for t in all_tilers() if t.kind == HOSTED and t.allows_ingest and t.name in allowed_names
    ]
    pinned_tiler = next((t for t in candidates if t.name == pinned), None)
    default_tiler = next((t for t in candidates if t.is_default), None)
    return pinned_tiler or default_tiler or (candidates[0] if candidates else None)

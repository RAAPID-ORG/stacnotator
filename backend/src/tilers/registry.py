"""Unified registry of which tilers exist. MPC and hosted tilers are presented uniformly
(one ``Tiler`` shape, one allow-set per user); MPC is special-cased only in routing
(``providers.py``), not here.

Imports ``src.config`` ONLY (no providers/router), so ``auth.models`` can use it without
an import cycle.
"""

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


@dataclass(frozen=True)
class Tiler:
    name: str
    kind: str  # MPC | HOSTED
    url: str | None  # hosted only; None for MPC
    is_default: bool  # default hosted pick for non-MPC collections
    default_access: bool  # seeded (pre-ticked) for new users
    stac_url: str | None  # browsable STAC catalog; None => not browsable
    title: str | None = None  # human-friendly catalog name for the wizard (falls back to name)


def all_tilers() -> list[Tiler]:
    """Every tiler the system knows: MPC plus each configured hosted tiler.

    ``default_access`` (auto-granted to all users) = MPC + the configured ``DEFAULT_TILER``.
    Every other hosted tiler is an "extra" that requires an explicit per-user grant.
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
            )
        )
    return tilers


def default_access_names() -> set[str]:
    """Tilers seeded (pre-ticked) for new users: MPC + the default hosted tiler."""
    return {t.name for t in all_tilers() if t.default_access}


def all_names() -> list[str]:
    """Every configured tiler name (the full set an admin can toggle per user)."""
    return [t.name for t in all_tilers()]


def browsable_tilers() -> list[Tiler]:
    """Tilers that advertise a browsable STAC catalog (``stac_url`` set)."""
    return [t for t in all_tilers() if t.stac_url]


def is_known(name: str) -> bool:
    """Whether ``name`` is a configured tiler (MPC or a hosted TILERS key)."""
    return any(t.name == name for t in all_tilers())

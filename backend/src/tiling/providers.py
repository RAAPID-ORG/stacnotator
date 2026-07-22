"""Tile provider routing: pick a provider, build its tile URL, register/ingest a search.

Two providers (the `self_hosted` mosaic_items tiler is retired):

  * ``mpc``    - Microsoft Planetary Computer's own tiler (direct, free egress). The only
                 tiler special-cased in code. Used when the catalog is MPC *and* the viz is
                 MPC-eligible (first/no compositing, no masking).
  * ``hosted`` - a titiler-pgstac tiler resolved **from config by name** (``Settings.TILERS``).
                 STACNotator is unaware of where it's hosted; the tiler's URL and whether it
                 can ingest come from config only.
"""

import httpx

from src.config import TilerCfg, get_settings
from src.tiling.registry import HOSTED as PROVIDER_HOSTED
from src.tiling.registry import MPC as PROVIDER_MPC
from src.tiling.router import build_viz_query_string
from src.tiling.stac_client import _is_mpc
from src.tiling.tiler_token import mint as mint_tiler_token

MPC_TILES_BASE = (
    "https://planetarycomputer.microsoft.com/api/data/v1/mosaic/"
    "{searchId}/tiles/WebMercatorQuad/{z}/{x}/{y}"
)


def mpc_eligible(viz_params: dict) -> bool:
    """MPC can serve a viz only with first-valid compositing and no masking."""
    compositing = viz_params.get("compositing")
    return (not compositing or compositing == "first") and not viz_params.get("mask_layer")


def select_provider(catalog_url: str | None, viz_params: dict) -> str:
    """Return ``"mpc"`` for MPC-eligible MPC catalogs, else ``"hosted"``."""
    if _is_mpc(catalog_url or "") and mpc_eligible(viz_params):
        return PROVIDER_MPC
    return PROVIDER_HOSTED


def build_tile_url(
    provider: str,
    ref: str,
    viz_params: dict,
    *,
    tiler: TilerCfg | None = None,
    collection_id: str | None = None,
) -> str:
    """Build an absolute XYZ tile-URL template for a registered search.

    ``ref`` is the provider's search id (MPC ``searchid`` / titiler-pgstac ``id``).
    """
    if provider == PROVIDER_MPC:
        url = (
            MPC_TILES_BASE.replace("{searchId}", ref)
            + f"?collection={collection_id}&pixel_selection=first"
        )
        qs = build_viz_query_string(viz_params, for_mpc=True)
        return f"{url}&{qs}" if qs else url

    base = tiler.url.rstrip("/")
    url = f"{base}/searches/{ref}/tiles/WebMercatorQuad/{{z}}/{{x}}/{{y}}.png"
    qs = build_viz_query_string(viz_params)
    return f"{url}?{qs}" if qs else url


def resolve_tiler(name: str | None) -> TilerCfg:
    """Look up a tiler in the config registry by name (or the configured default)."""
    settings = get_settings()
    name = name or settings.DEFAULT_TILER
    cfg = settings.TILERS.get(name) if name else None
    if cfg is None:
        raise ValueError(f"No tiler configured under name '{name}' (set Settings.TILERS)")
    return cfg


def _register_base(tiler: TilerCfg) -> str:
    """Backend->tiler base (internal URL if given, else the public URL)."""
    return (tiler.internal_url or tiler.url).rstrip("/")


def ingest_on_tiler(
    tiler: TilerCfg,
    catalog_url: str,
    collection: str,
    bbox: list[float] | None,
    datetime_range: str | None,
    max_cloud: float | None = None,
    limit: int = 500,
) -> int:
    """Trigger an AOI ingest on a hosted tiler (its decoupled `POST /ingest`).

    The tiler runs the STAC-API search and upserts into its own pgstac; the backend never
    writes to the tiler DB. Returns the number of items ingested. Raises if the configured
    tiler doesn't allow ingest.
    """
    if not tiler.allows_ingest:
        raise ValueError("Configured tiler does not allow STAC-API ingest")
    body = {
        "catalog_url": catalog_url,
        "collection": collection,
        "bbox": bbox,
        "datetime": datetime_range,
        "max_cloud": max_cloud,
        "limit": limit,
    }
    token = mint_tiler_token("backend", [], scope=["searches:write"], ttl=300)
    resp = httpx.post(
        f"{_register_base(tiler)}/ingest",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=300,
    )
    resp.raise_for_status()
    return resp.json()["ingested"]


def register_cog_on_tiler(
    tiler: TilerCfg, cog_url: str, campaign_id, internal_storage: bool = False
) -> str:
    """Register a single COG as a campaign-scoped pgstac search on the hosted tiler.

    ``internal_storage`` marks the search so the tiler reads its assets with the managed
    identity. Returns the tiler search id, used to build the tile-URL template.
    """
    token = mint_tiler_token("backend", [], scope=["searches:write"], ttl=300)
    resp = httpx.post(
        f"{_register_base(tiler)}/searches/register-cog",
        json={
            "cog_url": cog_url,
            "campaign_id": str(campaign_id),
            "internal_storage": internal_storage,
        },
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["id"]


# Wire contract with the tiler (its `azure.ASSET_SIGNER_MANAGED_IDENTITY`): a search stamped
# with this reads its assets via the tiler's Azure managed identity.
ASSET_SIGNER_MANAGED_IDENTITY = "azure_managed_identity"


def register_on_tiler(
    tiler: TilerCfg, search_body: dict, campaign_id, internal_storage: bool = False
) -> str:
    """Register a search (CQL2 body) on a hosted titiler-pgstac tiler.

    ``search_body`` must already have bbox/datetime resolved. We stamp the campaign id into
    the search metadata (the tiler enforces campaign access from it), plus an ``asset_signer``
    marker when the collection is internal storage, and authenticate with a short-lived
    ``searches:write`` token. Returns the search id.
    """
    metadata = {"campaign_id": str(campaign_id)}
    if internal_storage:
        metadata["asset_signer"] = ASSET_SIGNER_MANAGED_IDENTITY
    body = {**search_body, "metadata": metadata}
    token = mint_tiler_token("backend", [], scope=["searches:write"], ttl=300)
    resp = httpx.post(
        f"{_register_base(tiler)}/searches/register",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["id"]

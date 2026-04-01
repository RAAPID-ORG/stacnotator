from titiler.core.factory import MultiBaseTilerFactory, TilerFactory

from src.tiling.stac_reader import PCSignedSTACReader


def create_tiler_routers():
    """Create and return TiTiler routers for STAC items and COGs.

    Returns (stac_router, cog_router) - both are FastAPI APIRouters.
    """
    stac_tiler = MultiBaseTilerFactory(
        reader=PCSignedSTACReader,
        router_prefix="/stac",
    )

    cog_tiler = TilerFactory(
        router_prefix="/cog",
    )

    return stac_tiler.router, cog_tiler.router

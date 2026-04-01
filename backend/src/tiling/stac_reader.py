"""Custom STAC reader that signs MPC asset URLs before rasterio access."""

import logging
from typing import Any

import planetary_computer as pc
from rio_tiler.io import STACReader

from src.tiling.token_manager import is_planetary_computer

logger = logging.getLogger(__name__)


class PCSignedSTACReader(STACReader):
    """STACReader subclass that signs asset URLs via planetary_computer.

    When TiTiler's STAC endpoint receives a STAC item URL, the STACReader
    fetches the item JSON and accesses the asset COG URLs. For MPC, those
    URLs need SAS tokens. This reader intercepts the item after fetch and
    signs all asset URLs.

    Non-MPC items are left unsigned.
    """

    def __init__(self, input: str, *args: Any, **kwargs: Any):
        super().__init__(input, *args, **kwargs)

        if self.item and is_planetary_computer(input):
            try:
                self.item = pc.sign(self.item)
            except Exception as e:
                logger.warning("Failed to sign STAC item: %s", e)

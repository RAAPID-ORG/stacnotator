"""Custom STAC reader with MPC signing and item caching."""

import logging
import threading
import time
from typing import Any

import planetary_computer as pc
from rio_tiler.io import STACReader

logger = logging.getLogger(__name__)

ITEM_CACHE_TTL = 300  # 5 minutes - SAS tokens are valid for ~1 hour
ITEM_CACHE_MAX = 500

_item_cache: dict[str, tuple[dict, float]] = {}
_cache_lock = threading.Lock()


def _is_mpc(url: str) -> bool:
    return "planetarycomputer.microsoft.com" in url


def _get_cached_item(href: str) -> dict | None:
    with _cache_lock:
        entry = _item_cache.get(href)
        if entry and (time.monotonic() - entry[1]) < ITEM_CACHE_TTL:
            return entry[0]
        _item_cache.pop(href, None)
        return None


def _put_cached_item(href: str, item: dict) -> None:
    with _cache_lock:
        if len(_item_cache) >= ITEM_CACHE_MAX:
            oldest = min(_item_cache, key=lambda k: _item_cache[k][1])
            del _item_cache[oldest]
        _item_cache[href] = (item, time.monotonic())


class PCSignedSTACReader(STACReader):
    """STACReader that signs MPC asset URLs and caches signed items."""

    def __init__(self, input: str, *args: Any, **kwargs: Any):
        cached = _get_cached_item(input)
        if cached:
            kwargs["item"] = cached
        super().__init__(input, *args, **kwargs)

        if not cached and self.item:
            if _is_mpc(input):
                try:
                    self.item = pc.sign(self.item)
                except Exception as e:
                    logger.warning("Failed to sign STAC item: %s", e)
            _put_cached_item(input, self.item)

"""Custom STAC reader with MPC signing and item caching."""

import logging
import threading
import time
from typing import Any

import planetary_computer as pc
from rio_tiler.io import STACReader

logger = logging.getLogger(__name__)


ITEM_CACHE_TTL = 3000
ITEM_CACHE_MAX = 2000
SIGN_RETRY_ATTEMPTS = 3
SIGN_RETRY_BACKOFF = 0.25

_item_cache: dict[str, tuple[dict, float]] = {}
_cache_lock = threading.Lock()


def _is_mpc(url: str) -> bool:
    return "planetarycomputer.microsoft.com" in url


def _get_cached_item(href: str) -> dict | None:
    with _cache_lock:
        entry = _item_cache.get(href)
        if entry and (time.monotonic() - entry[1]) < ITEM_CACHE_TTL:
            return entry[0]
        if entry:
            _item_cache.pop(href, None)
        return None


def _put_cached_item(href: str, item: dict) -> None:
    with _cache_lock:
        if len(_item_cache) >= ITEM_CACHE_MAX:
            oldest = min(_item_cache, key=lambda k: _item_cache[k][1])
            del _item_cache[oldest]
        _item_cache[href] = (item, time.monotonic())


def _sign_with_retry(item: dict) -> dict:
    last_exc: Exception | None = None
    for attempt in range(SIGN_RETRY_ATTEMPTS):
        try:
            return pc.sign(item)
        except Exception as e:
            last_exc = e
            if attempt < SIGN_RETRY_ATTEMPTS - 1:
                time.sleep(SIGN_RETRY_BACKOFF * (2**attempt))
    assert last_exc is not None
    raise last_exc


class PCSignedSTACReader(STACReader):
    """STACReader that signs MPC asset URLs and caches signed items.

    Sign failures (after retries) propagate to the caller - rio-tiler's
    mosaic_reader skips failed items and continues with the rest. The
    unsigned item is NOT cached, so the next request retries from scratch.
    """

    def __init__(self, input: str, *args: Any, **kwargs: Any):
        # Cache holds already-signed items: prefer it over a caller-supplied
        # unsigned dict so we avoid re-signing.
        cached = _get_cached_item(input)
        if cached:
            kwargs["item"] = cached
            super().__init__(input, *args, **kwargs)
            return

        # No cache hit. STACReader will use kwargs["item"] if the caller
        # passed one; otherwise it fetches the item JSON from the source catalog over HTTP.
        super().__init__(input, *args, **kwargs)
        if not self.item:
            return

        if _is_mpc(input):
            self.item = _sign_with_retry(self.item)
        _put_cached_item(input, self.item)

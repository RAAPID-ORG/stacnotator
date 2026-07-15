"""Caps how much of the DB pool tile traffic can hold at once.

Tiles are the burstiest thing this app serves: task mode renders one map per
collection card and each fetches a viewport of tiles at once. Uncapped, that
burst takes every pooled connection and unrelated endpoints (``/api/auth/me``,
campaign loads) fail at ``pool.connect()``. The app must stay usable while tiles
degrade, never the other way round.

The wait is deliberately async. Sync routes and sync dependencies share one anyio
threadpool, so parking tile requests on a ``threading.Semaphore`` would starve the
app of *threads* instead of *connections* - the same outage, moved. Queued tiles
must cost nothing while they wait.

The semaphore is per-process, matching the engine's pool (also per-process), so
gunicorn workers each get their own budget.
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from src.config import get_settings


class TileCapacityError(Exception):
    """Raised when a tile request waited too long for a DB slot.

    Handled centrally in ``main.py`` as a 503; the frontend's tile loader already
    renders a failed tile as empty, so this degrades to a blank tile that refills
    on the next pan/zoom.
    """


_slots: asyncio.Semaphore | None = None


def _semaphore() -> asyncio.Semaphore:
    # Built lazily: asyncio primitives must be created on the running loop, which
    # does not exist at import time under gunicorn's fork-then-serve startup.
    global _slots
    if _slots is None:
        _slots = asyncio.Semaphore(get_settings().TILE_DB_SLOTS)
    return _slots


def reset_for_tests() -> None:
    global _slots
    _slots = None


@asynccontextmanager
async def tile_db_slot() -> AsyncIterator[None]:
    """Hold a tile DB slot for the duration of the block."""
    settings = get_settings()
    try:
        await asyncio.wait_for(_semaphore().acquire(), timeout=settings.DB_TILE_QUEUE_TIMEOUT)
    except TimeoutError as exc:
        raise TileCapacityError("timed out waiting for a tile DB slot") from exc
    try:
        yield
    finally:
        _semaphore().release()


async def tile_slot() -> AsyncIterator[None]:
    """FastAPI dependency form of :func:`tile_db_slot`.

    Declare it as the route's *first* dependency: FastAPI resolves route-level
    ``dependencies`` before parameter defaults, so it wraps DB-backed access checks
    (which open their own session) rather than just the endpoint body.
    """
    async with tile_db_slot():
        yield

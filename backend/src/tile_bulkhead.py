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
_upstream_slots: asyncio.Semaphore | None = None


def _semaphore() -> asyncio.Semaphore:
    # Built lazily: asyncio primitives must be created on the running loop, which
    # does not exist at import time under gunicorn's fork-then-serve startup.
    global _slots
    if _slots is None:
        _slots = asyncio.Semaphore(get_settings().TILE_DB_SLOTS)
    return _slots


def _upstream_semaphore() -> asyncio.Semaphore:
    global _upstream_slots
    if _upstream_slots is None:
        _upstream_slots = asyncio.Semaphore(get_settings().TILE_UPSTREAM_MAX_CONCURRENCY)
    return _upstream_slots


def reset_for_tests() -> None:
    global _slots, _upstream_slots, _lag_watch, _loop_lag_ms
    _slots = None
    _upstream_slots = None
    _lag_watch = None
    _loop_lag_ms = 0.0


# How late this worker's event loop runs. A late loop means the worker is out of CPU,
# and then every request on it waits, the API included. Tiles are the one load that can
# get there and the one that degrades gracefully, so they are refused while it lasts.
# A count cap cannot stand in for this: whether 100 tiles in flight is too many depends
# on the CPU and on how slow the provider is that day.
_LAG_SAMPLE_S = 0.05
_lag_watch: asyncio.Task | None = None
_loop_lag_ms = 0.0


async def _watch_loop_lag() -> None:
    global _loop_lag_ms
    loop = asyncio.get_running_loop()
    while True:
        started = loop.time()
        await asyncio.sleep(_LAG_SAMPLE_S)
        late_ms = (loop.time() - started - _LAG_SAMPLE_S) * 1000
        # Rises at once, falls over a few samples, so one quick sample in the middle of
        # an overload does not reopen the gate.
        _loop_lag_ms = max(late_ms, _loop_lag_ms * 0.7)


def loop_overloaded() -> bool:
    """Whether new tiles should be refused because this worker is out of CPU."""
    global _lag_watch
    loop = asyncio.get_running_loop()
    if _lag_watch is None or _lag_watch.done() or _lag_watch.get_loop() is not loop:
        _lag_watch = loop.create_task(_watch_loop_lag())
    limit = get_settings().TILE_SHED_LOOP_LAG_MS
    return bool(limit) and _loop_lag_ms > limit


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


@asynccontextmanager
async def tile_upstream_slot() -> AsyncIterator[None]:
    """Hold a provider-fetch slot for the duration of the block.

    Separate from the database budget on purpose. A proxied tile spends almost all of
    its life waiting on someone else's server while holding no connection of ours, so
    the two need very different ceilings: the DB budget is small because connections are
    scarce, this one is large because idle sockets are cheap. Bounding it at all is what
    stops a tile storm from exhausting file descriptors.
    """
    settings = get_settings()
    try:
        await asyncio.wait_for(
            _upstream_semaphore().acquire(), timeout=settings.TILE_UPSTREAM_QUEUE_TIMEOUT
        )
    except TimeoutError as exc:
        raise TileCapacityError("timed out waiting for a tile upstream slot") from exc
    try:
        yield
    finally:
        _upstream_semaphore().release()

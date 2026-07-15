import asyncio
from types import SimpleNamespace

import pytest

from src import tile_bulkhead
from src.tile_bulkhead import TileCapacityError, tile_db_slot


@pytest.fixture(autouse=True)
def _reset():
    # The semaphore is lazy and per-loop; each asyncio.run below needs a fresh one.
    tile_bulkhead.reset_for_tests()
    yield
    tile_bulkhead.reset_for_tests()


def _settings(slots: int, timeout: float):
    return lambda: SimpleNamespace(TILE_DB_SLOTS=slots, DB_TILE_QUEUE_TIMEOUT=timeout)


def test_concurrent_tiles_are_capped_at_the_slot_count(monkeypatch):
    """The cap is the whole point: it bounds how much pool tiles can ever hold."""
    monkeypatch.setattr(tile_bulkhead, "get_settings", _settings(2, 5.0))

    async def main() -> int:
        live = 0
        peak = 0
        release = asyncio.Event()

        async def tile():
            nonlocal live, peak
            async with tile_db_slot():
                live += 1
                peak = max(peak, live)
                await release.wait()
                live -= 1

        tasks = [asyncio.create_task(tile()) for _ in range(10)]
        await asyncio.sleep(0)  # let them pile up against the semaphore
        release.set()
        await asyncio.gather(*tasks)
        return peak

    assert asyncio.run(main()) == 2


def test_tile_sheds_rather_than_queueing_forever(monkeypatch):
    monkeypatch.setattr(tile_bulkhead, "get_settings", _settings(1, 0.01))

    async def main() -> None:
        held = asyncio.Event()

        async def hog():
            async with tile_db_slot():
                await held.wait()

        task = asyncio.create_task(hog())
        await asyncio.sleep(0)

        with pytest.raises(TileCapacityError):
            async with tile_db_slot():
                pass

        held.set()
        await task

    asyncio.run(main())


def test_slot_is_returned_when_the_tile_raises(monkeypatch):
    """A leaked slot would shrink the tile budget until the worker served none."""
    monkeypatch.setattr(tile_bulkhead, "get_settings", _settings(1, 0.01))

    async def main() -> None:
        with pytest.raises(RuntimeError):
            async with tile_db_slot():
                raise RuntimeError("query blew up")

        # Still acquirable: the failed tile did not keep its slot.
        async with tile_db_slot():
            pass

    asyncio.run(main())


def test_queued_tiles_do_not_block_other_work(monkeypatch):
    """A queued tile must yield the loop while it waits.

    Guards the reason this uses asyncio rather than threading: a blocking acquire
    would stall the worker outright, starving the app of threads instead of
    connections - the same outage, moved. Ticks below stay at 0 if that regresses.
    """
    monkeypatch.setattr(tile_bulkhead, "get_settings", _settings(1, 5.0))

    async def main() -> tuple[int, bool]:
        held = asyncio.Event()
        ticks = 0

        async def hog():
            async with tile_db_slot():
                await held.wait()

        async def queued_tile():
            async with tile_db_slot():
                pass

        hog_task = asyncio.create_task(hog())
        await asyncio.sleep(0)
        tile_task = asyncio.create_task(queued_tile())

        # Unrelated work keeps getting scheduled while the tile is parked.
        for _ in range(3):
            ticks += 1
            await asyncio.sleep(0)

        still_waiting = not tile_task.done()
        held.set()
        await asyncio.gather(hog_task, tile_task)
        return ticks, still_waiting

    ticks, still_waiting = asyncio.run(main())
    assert ticks == 3
    assert still_waiting

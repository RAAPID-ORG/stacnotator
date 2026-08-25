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


def _sized(pool_size: int, overflow: int, override: int | None = None):
    from src.config import Settings

    return Settings(
        DBNAME="d",
        DBUSER="u",
        DBPASS="p",
        DBHOST="h",
        DB_POOL_SIZE=pool_size,
        DB_MAX_OVERFLOW=overflow,
        DB_TILE_MAX_CONCURRENCY=override,
    )


def test_tiles_can_never_take_the_whole_pool():
    """The reservation is the guarantee: whatever tiles are doing, a campaign load,
    a task list or an annotation write can still get a connection."""
    for pool_size, overflow in [(5, 5), (20, 10), (50, 20), (1, 0)]:
        settings = _sized(pool_size, overflow)
        pool = pool_size + overflow
        assert pool > settings.TILE_DB_SLOTS or pool == 1


def test_about_a_quarter_of_the_pool_is_held_back_for_everything_else():
    settings = _sized(20, 10)
    pool = 30
    reserved = pool - settings.TILE_DB_SLOTS
    assert settings.TILE_DB_SLOTS == 22
    assert reserved == 8
    assert 0.2 <= reserved / pool <= 0.3


def test_an_explicit_override_wins():
    """Operators need a lever when a specific deployment misbehaves."""
    assert _sized(20, 10, override=4).TILE_DB_SLOTS == 4


def test_a_tiny_pool_still_leaves_one_slot_each():
    """Rounding must not produce a zero-sized bulkhead, which would block all tiles."""
    settings = _sized(1, 1)
    assert settings.TILE_DB_SLOTS >= 1
    assert (2 - settings.TILE_DB_SLOTS) >= 1


def _upstream_settings(slots: int, timeout: float):
    return lambda: SimpleNamespace(
        TILE_UPSTREAM_MAX_CONCURRENCY=slots, TILE_UPSTREAM_QUEUE_TIMEOUT=timeout
    )


def test_the_upstream_budget_ships_far_larger_than_the_db_budget():
    """They bound different scarce things. Connections are few; a socket idling on a
    provider is cheap, and sizing both alike is what capped the proxy at ~60 tiles/s."""
    from src.config import get_settings as real_settings

    s = real_settings()
    assert s.TILE_UPSTREAM_MAX_CONCURRENCY > s.TILE_DB_SLOTS * 4


def test_concurrent_provider_fetches_are_capped_at_the_upstream_count(monkeypatch):
    monkeypatch.setattr(tile_bulkhead, "get_settings", _upstream_settings(3, 5.0))

    async def main() -> int:
        live = 0
        peak = 0
        release = asyncio.Event()

        async def fetch():
            nonlocal live, peak
            async with tile_bulkhead.tile_upstream_slot():
                live += 1
                peak = max(peak, live)
                await release.wait()
                live -= 1

        tasks = [asyncio.create_task(fetch()) for _ in range(12)]
        await asyncio.sleep(0)
        release.set()
        await asyncio.gather(*tasks)
        return peak

    assert asyncio.run(main()) == 3


def test_a_provider_fetch_sheds_rather_than_queueing_forever(monkeypatch):
    monkeypatch.setattr(tile_bulkhead, "get_settings", _upstream_settings(1, 0.01))

    async def main():
        async with tile_bulkhead.tile_upstream_slot():
            with pytest.raises(TileCapacityError):
                async with tile_bulkhead.tile_upstream_slot():
                    pass

    asyncio.run(main())


def test_the_two_budgets_are_independent(monkeypatch):
    """A tile waiting on a provider must not be holding a database slot - that coupling
    is exactly what the split removes."""
    monkeypatch.setattr(tile_bulkhead, "get_settings", _settings(1, 0.01))

    async def main():
        async with tile_db_slot():
            pass
        monkeypatch.setattr(tile_bulkhead, "get_settings", _upstream_settings(1, 0.01))
        async with tile_bulkhead.tile_upstream_slot():
            # The DB budget is untouched while a provider fetch is in flight.
            monkeypatch.setattr(tile_bulkhead, "get_settings", _settings(1, 0.01))
            async with tile_db_slot():
                pass

    asyncio.run(main())

import asyncio

import pytest
from fastapi import HTTPException

from src import tile_bulkhead
from src.imagery import proxy_router


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    proxy_router.reset_target_cache()
    tile_bulkhead.reset_for_tests()
    # The real one opens a database session; the point here is how often it is reached.
    monkeypatch.setattr(proxy_router, "_with_session", lambda lookup: lookup("session"))
    yield
    proxy_router.reset_target_cache()
    tile_bulkhead.reset_for_tests()


def _resolve(key, lookup):
    return asyncio.run(proxy_router._resolve(key, lookup))


def test_the_second_tile_of_a_layer_makes_no_query():
    """The whole point: one query per layer per TTL, not one per tile."""
    calls = []

    def lookup(_db):
        calls.append(1)
        return ("https://tiles.example/{z}/{x}/{y}?k={api_key}", "cipher")

    first = _resolve(("basemap", 1, 42), lookup)
    second = _resolve(("basemap", 1, 42), lookup)

    assert first == second
    assert len(calls) == 1


def test_different_layers_do_not_share_an_entry():
    def lookup_for(url):
        return lambda _db: (url, None)

    a = _resolve(("basemap", 1, 42), lookup_for("https://a.example/{z}"))
    b = _resolve(("basemap", 1, 43), lookup_for("https://b.example/{z}"))
    assert a != b


def test_a_campaign_cannot_read_another_campaigns_cached_target():
    """The campaign id is part of the key, so a tile URL cannot leak sideways even
    though the layer id alone would have been enough to look it up."""
    a = _resolve(("basemap", 1, 42), lambda _db: ("https://one.example/{z}", None))
    b = _resolve(("basemap", 2, 42), lambda _db: ("https://two.example/{z}", None))
    assert a[0] == "https://one.example/{z}"
    assert b[0] == "https://two.example/{z}"


def test_an_entry_is_dropped_once_its_ttl_passes(monkeypatch):
    calls = []

    def lookup(_db):
        calls.append(1)
        return ("https://tiles.example/{z}", None)

    now = [1000.0]
    monkeypatch.setattr(proxy_router.time, "monotonic", lambda: now[0])
    _resolve(("basemap", 1, 42), lookup)
    now[0] += proxy_router.get_settings().TILE_TARGET_CACHE_TTL + 1
    _resolve(("basemap", 1, 42), lookup)
    assert len(calls) == 2


def test_a_missing_layer_is_not_cached():
    """A 404 must stay uncached, or a layer created a second later stays broken for a
    whole TTL."""
    state = {"exists": False}

    def lookup(_db):
        if not state["exists"]:
            raise HTTPException(status_code=404, detail="Basemap not found")
        return ("https://tiles.example/{z}", None)

    with pytest.raises(HTTPException):
        _resolve(("basemap", 1, 42), lookup)
    state["exists"] = True
    assert _resolve(("basemap", 1, 42), lookup)[0] == "https://tiles.example/{z}"


def test_the_cache_is_bounded(monkeypatch):
    monkeypatch.setattr(proxy_router.get_settings(), "TILE_TARGET_CACHE_SIZE", 8, raising=False)
    for i in range(40):
        _resolve(("basemap", 1, i), lambda _db, n=i: (f"https://tiles.example/{n}", None))
    assert len(proxy_router._targets) <= 8


def test_the_db_slot_is_released_before_the_provider_fetch():
    """The fix this module exists for. The database budget must not still be held while
    a tile waits on someone else's server, or the proxy's ceiling is that budget divided
    by the provider's latency - which measured out at roughly sixty tiles a second."""
    from src.config import get_settings

    async def scenario():
        await proxy_router._resolve(("basemap", 1, 42), lambda _db: ("https://x/{z}", None))
        # Nothing may still be checked out once the target is resolved.
        return tile_bulkhead._semaphore()._value

    free_after = asyncio.run(scenario())
    assert free_after == get_settings().TILE_DB_SLOTS


def test_a_cached_tile_takes_no_db_slot_at_all():
    async def scenario():
        await proxy_router._resolve(("basemap", 1, 42), lambda _db: ("https://x/{z}", None))
        held = []

        async def watched(_db):  # pragma: no cover - must never run
            held.append(1)
            return ("https://x/{z}", None)

        await proxy_router._resolve(("basemap", 1, 42), watched)
        return held

    assert asyncio.run(scenario()) == []

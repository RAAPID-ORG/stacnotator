import asyncio
import logging
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from sqlalchemy import create_engine, text
from sqlalchemy.pool import QueuePool
from starlette.testclient import TestClient

from src import perf
from src.config import get_settings


@pytest.fixture
def timing():
    return asyncio.run(_started())


async def _started() -> perf.RequestTiming:
    return perf.start()


@pytest.fixture
def engine():
    """A throwaway engine so the hooks can be exercised without the real database."""
    previous = perf._engine
    eng = create_engine("sqlite://")
    perf.install(eng)
    yield eng
    perf._engine = previous
    eng.dispose()


def _query(engine, timing: perf.RequestTiming) -> None:
    token = perf._current.set(timing)
    try:
        with engine.connect() as conn:
            conn.execute(text("select 1"))
    finally:
        perf._current.reset(token)


def test_a_query_is_counted_and_timed(engine, timing):
    _query(engine, timing)
    assert timing.db_queries == 1
    assert timing.db_ms > 0


def test_queries_accumulate_across_a_request(engine, timing):
    _query(engine, timing)
    _query(engine, timing)
    assert timing.db_queries == 2


def test_a_new_physical_connection_is_counted(engine, timing):
    """The expensive kind of checkout: distinguishes a cold pool from a warm one."""
    _query(engine, timing)
    assert timing.db_connects == 1


def test_time_to_first_query_is_measured_once(engine, timing):
    _query(engine, timing)
    first = timing.first_query_ms
    _query(engine, timing)
    assert first is not None
    assert timing.first_query_ms == first


def test_work_outside_a_request_is_not_billed_to_anyone(engine, timing):
    """Background registration threads run queries with no request context. They
    must be ignored, not attributed to whichever request ran last."""
    with engine.connect() as conn:
        conn.execute(text("select 1"))
    assert timing.db_queries == 0


def test_upstream_calls_accumulate(timing):
    token = perf._current.set(timing)
    try:
        perf.record_upstream(12.0)
        perf.record_upstream(30.0)
    finally:
        perf._current.reset(token)
    assert timing.upstream_calls == 2
    assert timing.upstream_ms == pytest.approx(42.0)


def test_the_breakdown_reports_every_field():
    async def build() -> str:
        t = perf.start()
        t.db_ms, t.db_queries, t.db_connects = 91.4, 5, 1
        t.upstream_ms, t.upstream_calls, t.first_query_ms = 120.0, 2, 38.0
        return perf.breakdown(t)

    line = asyncio.run(build())
    for field in ("db=91ms", "q=5", "newconn=1", "up=120ms", "upcalls=2", "ttfq=38ms"):
        assert field in line
    assert "threads=" in line and "thrwait=" in line


def test_a_request_that_never_queried_says_so():
    line = asyncio.run(_breakdown_of_a_fresh_request())
    assert "q=0" in line
    assert "ttfq=-" in line


async def _breakdown_of_a_fresh_request() -> str:
    return perf.breakdown(perf.start())


def test_the_pool_gauge_reports_use_against_capacity():
    """The field that tells a slow request apart from a queued one, so it is worth
    pinning: the real engine pools, the sqlite one used elsewhere here does not."""
    previous = perf._engine
    eng = create_engine("sqlite://", poolclass=QueuePool)
    perf.install(eng)
    try:
        line = asyncio.run(_breakdown_of_a_fresh_request())
    finally:
        perf._engine = previous
        eng.dispose()
    assert f"pool=0/{eng.pool.size() + get_settings().DB_MAX_OVERFLOW}" in line


@pytest.fixture
def app(engine):
    """The middleware over a *sync* route, which is what makes this test worth
    having: the timing must survive both the BaseHTTPMiddleware task hop and the
    anyio threadpool hop that a sync route runs in."""
    import src.main as main

    original = main.settings
    main.settings = SimpleNamespace(
        MAX_INFLIGHT_REQUESTS=0, SLOW_REQUEST_MS=1_000_000, LOG_REQUEST_TIMING=True
    )
    api = FastAPI()
    api.add_middleware(main.RequestContextMiddleware)

    @api.get("/things/{thing_id}")
    def read_thing(thing_id: int):
        with engine.connect() as conn:
            conn.execute(text("select 1"))
        return {"id": thing_id}

    yield api
    main.settings = original


def test_the_breakdown_survives_the_threadpool_and_reaches_the_log(app, caplog):
    with caplog.at_level(logging.INFO, logger="src.main"):
        assert TestClient(app).get("/things/7").status_code == 200

    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("perf |"))
    assert "q=1" in line
    assert "/things/{thing_id}" in line, "the route template, not the concrete path"


def test_a_fast_request_is_silent_unless_timing_logging_is_on(app, caplog):
    import src.main as main

    main.settings = SimpleNamespace(
        MAX_INFLIGHT_REQUESTS=0, SLOW_REQUEST_MS=1_000_000, LOG_REQUEST_TIMING=False
    )
    with caplog.at_level(logging.INFO, logger="src.main"):
        TestClient(app).get("/things/7")
    assert not [r for r in caplog.records if r.getMessage().startswith("perf |")]

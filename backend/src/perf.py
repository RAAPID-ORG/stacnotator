"""Where a request's time actually went.

A total duration cannot separate a slow query from a saturated pool from a slow
upstream, and under load those three need different fixes. Each request
accumulates a breakdown here and the request middleware logs it as one line.

The accumulator is a mutable object behind a ContextVar rather than a set of
plain ContextVars: sync routes run in the anyio threadpool, which *copies* the
context, so a value assigned inside the thread is never seen by the middleware
that logs it. Mutating one shared object crosses that boundary. Work with no
request behind it (background registration threads) starts with an empty context
and is therefore ignored rather than billed to whoever ran last.
"""

import logging
from contextvars import ContextVar
from dataclasses import dataclass
from time import perf_counter

from anyio import to_thread
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.pool import QueuePool

from src.config import get_settings

logger = logging.getLogger(__name__)

_QUERY_STARTED = "_perf_query_started"


@dataclass
class RequestTiming:
    started: float
    db_ms: float = 0.0
    db_queries: int = 0
    db_connects: int = 0
    upstream_ms: float = 0.0
    upstream_calls: int = 0
    first_query_ms: float | None = None


_current: ContextVar[RequestTiming | None] = ContextVar("request_timing", default=None)
_engine: Engine | None = None


def start() -> RequestTiming:
    timing = RequestTiming(started=perf_counter())
    _current.set(timing)
    return timing


def record_upstream(elapsed_ms: float) -> None:
    """Time spent on an outbound call (STAC, tiler, provider tiles), so a slow
    provider is never read as a slow backend."""
    timing = _current.get()
    if timing is None:
        return
    timing.upstream_ms += elapsed_ms
    timing.upstream_calls += 1


def install(engine: Engine) -> None:
    global _engine
    _engine = engine
    event.listen(engine, "before_cursor_execute", _on_query_start)
    event.listen(engine, "after_cursor_execute", _on_query_end)
    event.listen(engine, "connect", _on_connect)


def _on_query_start(conn, cursor, statement, parameters, context, executemany) -> None:
    conn.info[_QUERY_STARTED] = perf_counter()


def _on_query_end(conn, cursor, statement, parameters, context, executemany) -> None:
    started = conn.info.pop(_QUERY_STARTED, None)
    timing = _current.get()
    if started is None or timing is None:
        return
    timing.db_ms += (perf_counter() - started) * 1000
    timing.db_queries += 1
    if timing.first_query_ms is None:
        # Measured to the query's *start*, so it carries the pool checkout wait
        # along with auth and threadpool scheduling.
        timing.first_query_ms = (started - timing.started) * 1000


def _on_connect(dbapi_connection, connection_record) -> None:
    """A new physical connection, not a reused one. Each is a fresh TCP and TLS
    handshake to the database, which is the expensive kind of checkout."""
    timing = _current.get()
    if timing is not None:
        timing.db_connects += 1


def breakdown(timing: RequestTiming) -> str:
    """The timing fields as one space-separated key=value run, for log queries."""
    ttfq = "-" if timing.first_query_ms is None else f"{timing.first_query_ms:.0f}ms"
    fields = [
        f"db={timing.db_ms:.0f}ms",
        f"q={timing.db_queries}",
        f"newconn={timing.db_connects}",
        f"up={timing.upstream_ms:.0f}ms",
        f"upcalls={timing.upstream_calls}",
        f"ttfq={ttfq}",
    ]
    fields.extend(_saturation_gauges())
    return " ".join(fields)


def _saturation_gauges() -> list[str]:
    """Process-wide contention at the moment the request finished. Without these a
    slow request cannot be told apart from a request that was merely queued behind
    others."""
    gauges = []
    pool = _engine.pool if _engine is not None else None
    if isinstance(pool, QueuePool):
        gauges.append(f"pool={pool.checkedout()}/{pool.size() + get_settings().DB_MAX_OVERFLOW}")
    limiter = to_thread.current_default_thread_limiter()
    stats = limiter.statistics()
    gauges.append(f"threads={stats.borrowed_tokens:.0f}/{stats.total_tokens:.0f}")
    gauges.append(f"thrwait={stats.tasks_waiting}")
    return gauges

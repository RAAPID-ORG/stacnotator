import logging

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from src import perf
from src.config import get_settings

# Set up logging
logger = logging.getLogger(__name__)

settings = get_settings()


# Base class for all ORM models
class Base(DeclarativeBase):
    pass


# Create synchronous engine.
# pool_recycle is set below Azure's ~4 min idle-connection drop so the pool
# proactively rotates stale connections. TCP keepalives are a backstop for
# connections that die mid-pool.
#
# pool_pre_ping stays on despite costing a round trip per checkout. Turning it off
# traded that round trip for 3,686 failed requests in a single load test: this link
# drops connections that keepalives and pool_recycle do not catch, and LIFO makes it
# worse by design, keeping a hot set at the top of the stack while the rest go cold.
#
# LIFO keeps that small hot set alive and lets the rest age out, instead of cycling the
# whole pool and keeping every connection marginally warm.
engine = create_engine(
    settings.DATABASE_URL,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_recycle=240,
    pool_pre_ping=True,
    pool_use_lifo=True,
    pool_timeout=settings.DB_POOL_TIMEOUT,
    connect_args={
        "application_name": "stacnotator-backend",
        # Postgres-side backstop: reap a session left idle-in-transaction (e.g. a
        # dependency whose cleanup was skipped under load) so the pooled connection
        # returns to service instead of wedging the pool permanently.
        "options": f"-c idle_in_transaction_session_timeout={settings.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS}",
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 3,
    },
)


# Per-request query counts and timings. Registered here so every session,
# including the ones opened outside a request, uses the same instrumented engine.
perf.install(engine)


# Session factory
SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
)


# Dependency for FastAPI routes
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def release(db: Session) -> None:
    """Return this request's connection to the pool now, before the response is built.

    ``get_db`` otherwise holds it until the dependency's ``finally``, which FastAPI runs
    *after* serializing the response - so a request that finished its queries in 154ms
    can occupy a connection for 250ms. Under load the pool is the scarcest thing in the
    system and hold time is what decides how much of it a request costs, so that tail is
    worth giving back on the busiest reads.

    Only safe once the response has been materialized away from the ORM. Anything that
    lazy-loads after this raises ``DetachedInstanceError``; the session itself stays
    usable, and a later query simply checks a connection out again.
    """
    db.close()

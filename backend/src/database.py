import logging

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

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
# connections that die mid-pool. pool_pre_ping stays on for reliability.
engine = create_engine(
    settings.DATABASE_URL,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_recycle=240,
    pool_pre_ping=True,
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

import logging

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from src.config import get_settings

# Set up logging
logger = logging.getLogger(__name__)

settings = get_settings()

db_url_masked = (
    settings.DATABASE_URL.replace(settings.DBPASS, "***MASKED***")
    if settings.DBPASS
    else settings.DATABASE_URL
)


# Base class for all ORM models
class Base(DeclarativeBase):
    pass


# Create synchronous engine
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
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

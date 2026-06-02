from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from src.config import get_settings


class Base(DeclarativeBase):
    pass


def make_session() -> Session:
    settings = get_settings()
    engine = create_engine(settings.DATABASE_URL)
    factory = sessionmaker(bind=engine)
    return factory()

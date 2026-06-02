import os
from functools import lru_cache
from urllib.parse import quote_plus

from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DBNAME: str
    DBUSER: str
    DBPASS: str
    DBHOST: str
    DBPORT: int

    DBSCHEME: str = "postgresql"
    DBDRIVER: str = "psycopg2"

    STORAGE_PROVIDER: str = "local"
    STORAGE_LOCAL_PATH: str = "/app/uploads"
    AZURE_STORAGE_ACCOUNT_URL: str | None = None
    AZURE_STORAGE_CONTAINER: str = "custom-maps"

    POLL_INTERVAL_S: int = 30

    @computed_field
    @property
    def DATABASE_URL(self) -> str:
        return (
            f"{self.DBSCHEME}+{self.DBDRIVER}://"
            f"{quote_plus(self.DBUSER)}:{quote_plus(self.DBPASS)}"
            f"@{self.DBHOST}:{self.DBPORT}"
            f"/{self.DBNAME}"
        )

    model_config = SettingsConfigDict(
        env_file="config/.env" if os.path.exists("config/.env") else None,
        env_file_encoding="utf-8",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()

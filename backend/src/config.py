import json
import os
from functools import lru_cache
from urllib.parse import quote_plus

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DBNAME: str
    DBUSER: str
    DBPASS: str
    DBHOST: str
    DBPORT: int

    DBSCHEME: str = "postgresql"
    DBDRIVER: str = "psycopg2"

    ENVIRONMENT: str = "development"  # "development" | "production"

    AUTH_PROVIDER: str = "firebase"

    # Firebase credentials: can be either a file path or direct JSON content
    FIREBASE_CREDENTIALS_PATH: str | None = None
    FIREBASE_CREDENTIALS: str | None = None  # Direct JSON content in env (alternative to path)

    # Store as string to avoid automatic JSON parsing by pydantic-settings
    cors_origins_raw: str | list[str] = Field(
        default="http://localhost:3000,http://localhost:5173", validation_alias="CORS_ORIGINS"
    )

    # Shared secret for signing tiler access tokens (HMAC)
    TILER_TOKEN_SECRET: str = "dev-tiler-secret-change-in-production"

    EE_SERVICE_ACCOUNT: str | None = None
    EE_PRIVATE_KEY_PATH: str | None = None
    EE_PRIVATE_KEY: str | None = None  # Direct key content (alternative to path)

    @property
    def CORS_ORIGINS(self) -> list[str]:
        """Parse CORS origins from various formats."""
        v = self.cors_origins_raw
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            # Skip empty strings
            if not v.strip():
                return [
                    "http://localhost:3000",
                    "http://localhost:5173",
                ]
            # Try to parse as JSON first
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return parsed
            except (json.JSONDecodeError, ValueError):
                pass
            # Handle comma-separated string
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return [
            "http://localhost:3000",
            "http://localhost:5173",
        ]

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
        # Only use .env file in local development, not in production
        # Environment variables always take precedence
        env_file="config/.env" if os.path.exists("config/.env") else None,
        env_file_encoding="utf-8",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()

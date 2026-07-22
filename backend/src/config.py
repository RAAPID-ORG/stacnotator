import json
import os
from functools import lru_cache
from urllib.parse import quote_plus

from pydantic import BaseModel, Field, computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class TilerCfg(BaseModel):
    """A titiler-pgstac tiler endpoint.

    ``url`` is browser-facing; ``internal_url`` (optional) is the backend->tiler base for
    register/ingest; ``allows_ingest`` says whether this tiler exposes ``POST /ingest``.
    ``stac_url`` (optional) is a browsable STAC API over this tiler's catalog; when set, the
    tiler shows up as a browsable "Platform catalog" in the wizard and its collections are
    auto-tiled by this tiler. ``title`` (optional) is the human-friendly catalog name shown
    in the wizard; the registry key stays the internal routing/auth id.
    """

    url: str
    internal_url: str | None = None
    stac_url: str | None = None
    title: str | None = None
    allows_ingest: bool = False


class Settings(BaseSettings):
    DBNAME: str
    DBUSER: str
    DBPASS: str
    DBHOST: str
    DBPORT: int

    DBSCHEME: str = "postgresql"
    DBDRIVER: str = "psycopg2"

    # SQLAlchemy pool sizing. Total backend connections = (DB_POOL_SIZE +
    # DB_MAX_OVERFLOW) x gunicorn workers; keep that (plus the tiler's pool) under
    # the Postgres server's max_connections. Lower these on small DB SKUs.
    DB_POOL_SIZE: int = 15
    DB_MAX_OVERFLOW: int = 20
    # Fail a request fast if no pooled connection frees up in this many seconds,
    # instead of hanging (and piling up) when the DB is saturated.
    DB_POOL_TIMEOUT: int = 10
    # Postgres reaps a connection left idle-in-transaction this long (ms), so a
    # leaked session self-heals back into the pool instead of wedging it forever.
    DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: int = 15000

    # Bulkhead: the most DB sessions tile requests may hold at once, per worker.
    # Tiles are the burstiest traffic (one map per collection card, each fetching a
    # viewport of tiles), so without a cap they drain the pool and 500 unrelated
    # endpoints. Non-tile requests are therefore always left
    # (DB_POOL_SIZE + DB_MAX_OVERFLOW) - this many connections. Unset = half the pool.
    DB_TILE_MAX_CONCURRENCY: int | None = None
    # How long a tile waits for a slot before degrading to an empty tile. Slow tiles
    # are fine; queued-forever tiles are not (they hold sockets and pile up).
    DB_TILE_QUEUE_TIMEOUT: float = 10.0

    # AnyIO threadpool size for sync routes. Must exceed (DB_POOL_SIZE +
    # DB_MAX_OVERFLOW) so a sync `get_db` dependency's cleanup is never starved of a
    # thread under load (which leaks the connection). The DB pool — not this — stays
    # the hard cap on concurrent DB work, keeping small/burstable DBs safe.
    THREAD_POOL_MAX: int = 96

    # Below this zoom the annotation MVT endpoint returns an empty tile instead of
    # encoding thousands of features (a whole-country view of dense parcels is a
    # multi-MB, multi-hundred-ms query). Keeps low-zoom panning cheap and bounded.
    ANNOTATION_TILE_MIN_ZOOM: int = 11

    ENVIRONMENT: str = "development"  # "development" | "production"

    AUTH_PROVIDER: str = "firebase"

    # Firebase credentials: can be either a file path or direct JSON content
    FIREBASE_CREDENTIALS_PATH: str | None = None
    FIREBASE_CREDENTIALS: str | None = None  # Direct JSON content in env (alternative to path)

    # Store as string to avoid automatic JSON parsing by pydantic-settings
    cors_origins_raw: str | list[str] = Field(
        default="http://localhost:3000,http://localhost:5173", validation_alias="CORS_ORIGINS"
    )

    # Shared secret for signing tiler access tokens (HS256 JWT). Must match the tilers.
    TILER_TOKEN_SECRET: str = "dev-tiler-secret-change-in-production"

    # AES-256-GCM master key for encrypting imagery provider API keys at rest (base64 of 32 bytes).
    # On Azure this App Setting is a Key Vault reference so the real key lives in Key Vault.
    APIKEY_ENCRYPTION_SECRET: str = "dev-apikey-secret-change-in-production"

    # tiler_token cookie attributes. For sibling-subdomain deployments set
    # TILER_COOKIE_DOMAIN=".example.com" so the cookie reaches the tiler subdomains.
    TILER_COOKIE_DOMAIN: str | None = None
    TILER_COOKIE_SAMESITE: str = "lax"
    TILER_COOKIE_SECURE: bool = True

    # tiler registry: name -> tiler. Stored as a raw string (like CORS_ORIGINS) so an empty
    # TILERS env value means "no tilers" instead of a JSON-parse error - that's the default,
    # single-machine deploy (db+backend+frontend, MPC only). Set the env to enable a tiler:
    # TILERS='{"hosted":{"url":"https://t1","allows_ingest":true}}'
    tilers_raw: str = Field(default="", validation_alias="TILERS")
    DEFAULT_TILER: str | None = None  # Tiler used when a collection doesn't name one.

    @property
    def TILERS(self) -> dict[str, TilerCfg]:
        if not self.tilers_raw.strip():
            return {}
        return {name: TilerCfg(**cfg) for name, cfg in json.loads(self.tilers_raw).items()}

    @field_validator("DEFAULT_TILER", mode="after")
    @classmethod
    def _blank_default_tiler_is_none(cls, v: str | None) -> str | None:
        # `DEFAULT_TILER=` (empty) from compose means "no default", not the tiler named "".
        return v or None

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
    def TILE_DB_SLOTS(self) -> int:
        """Resolved tile bulkhead size: the explicit override, else half the pool."""
        if self.DB_TILE_MAX_CONCURRENCY is not None:
            return max(1, self.DB_TILE_MAX_CONCURRENCY)
        return max(1, (self.DB_POOL_SIZE + self.DB_MAX_OVERFLOW) // 2)

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

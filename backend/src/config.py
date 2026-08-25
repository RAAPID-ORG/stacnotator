import base64
import binascii
import json
import os
from functools import lru_cache
from typing import Literal
from urllib.parse import quote_plus

from pydantic import BaseModel, Field, computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_CORS_ORIGINS = ["http://localhost:3000", "http://localhost:5173"]

# Placeholders that let a fresh checkout boot without any secret material. Production
# refuses to start on either (see _validate_production_config), which only works while
# the guard and the default are the same string - so they are named here once and both
# sides read the name.
DEV_TILER_TOKEN_SECRET = "dev-tiler-secret-change-in-production"  # noqa: S105
# Spelled as base64 of a readable 32-byte phrase because AES-256 needs exactly that, and
# a placeholder that cannot satisfy the format is not a placeholder - it just moves the
# failure to the first request that tries to encrypt a provider key.
DEV_APIKEY_ENCRYPTION_SECRET = base64.b64encode(b"stacnotator-dev-insecure-key-32b").decode()


def _parse_origins(v: str | list[str]) -> list[str]:
    """CORS_ORIGINS as a JSON array, a comma-separated string, or already a list."""
    if isinstance(v, list):
        return v
    if not v.strip():
        return _DEFAULT_CORS_ORIGINS
    try:
        parsed = json.loads(v)
        if isinstance(parsed, list):
            return parsed
    except (json.JSONDecodeError, ValueError):
        pass
    return [origin.strip() for origin in v.split(",") if origin.strip()]


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


# Share of the pool kept out of tiles' reach. Tiles are the burstiest traffic by an
# order of magnitude; without a reservation they take the pool and the pages a person
# is actually waiting on stop answering.
NON_TILE_POOL_RESERVE = 0.25


class Settings(BaseSettings):
    DBNAME: str
    DBUSER: str
    DBPASS: str
    DBHOST: str

    DBPORT: int = 5432
    DBSCHEME: str = "postgresql"
    DBDRIVER: str = "psycopg2"

    # SQLAlchemy pool sizing. Total backend connections = (DB_POOL_SIZE +
    # DB_MAX_OVERFLOW) x gunicorn workers; keep that (plus the tiler's pool) under
    # the Postgres server's max_connections. Lower these on small DB SKUs.
    #
    # Favour the steady pool over the overflow: connections up to DB_POOL_SIZE are
    # reused, everything above is rebuilt per checkout, and over a network hop that
    # rebuild can cost more than the query. Size it for throughput x how long a request
    # holds a connection, which with `get_db` is the whole request.
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 10
    # Fail a request fast if no pooled connection frees up in this many seconds.
    # Deliberately short: a waiting request holds a worker thread and an in-flight slot
    # for the whole wait, so patience here consumes the very capacity that would let
    # the queue drain. Under load nearly every waiter times out anyway, and a fast 500
    # frees the thread for a request that can actually be served.
    DB_POOL_TIMEOUT: int = 3
    # Postgres reaps a connection left idle-in-transaction this long (ms), so a
    # leaked session self-heals back into the pool instead of wedging it forever.
    DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: int = 15000

    # Bulkhead: the most tile requests in flight at once, per worker. A tile holds its
    # slot for the whole request, so this also bounds how much of the pool tiles can
    # ever hold. Unset = all but NON_TILE_POOL_RESERVE.
    DB_TILE_MAX_CONCURRENCY: int | None = None
    # How long a tile waits for a slot before degrading to an empty tile. A waiting
    # tile also occupies an in-flight slot, and a blank tile refills on the next pan,
    # so patience here is expensive and worth little.
    DB_TILE_QUEUE_TIMEOUT: float = 5.0

    # AnyIO threadpool size for sync routes. Must exceed (DB_POOL_SIZE +
    # DB_MAX_OVERFLOW) so a sync `get_db` dependency's cleanup is never starved of a
    # thread under load (which leaks the connection). The DB pool -not this -stays
    # the hard cap on concurrent DB work, keeping small/burstable DBs safe.
    #
    # Sized just above the pool, not far above it: a thread waiting for a connection
    # still competes with the event loop for the GIL, and that loop answers gunicorn's
    # heartbeat. Too many threads starve it into killing the worker as unresponsive.
    THREAD_POOL_MAX: int = 40

    # Most requests one worker will accept at once before shedding with 503. Just above
    # the pool: past that a request cannot get a connection anyway, so admitting it only
    # turns a fast failure into a slow one that also holds a thread. This is per worker,
    # so the replica's real ceiling is this times WORKERS. 0 disables shedding.
    MAX_INFLIGHT_REQUESTS: int = 32

    # Requests at or above this get one WARNING line with their duration and the
    # number of requests in flight at the time. Per-request INFO logging would
    # drown in tile traffic, and the interesting question under load is which
    # requests got slow and how contended the process was when they did.
    SLOW_REQUEST_MS: float = 1000.0

    # Every hardening decision keys off this - docs are hidden, dev-default secrets are
    # rejected, AUTH_PROVIDER=local is refused - and each of those tests for "production"
    # exactly. A typo like "prod" would silently turn all of them off, so the set is closed
    # and an unrecognised value fails startup.
    ENVIRONMENT: Literal["development", "testing", "production"] = "development"

    AUTH_PROVIDER: str = "firebase"

    # Firebase credentials: can be either a file path or direct JSON content
    FIREBASE_CREDENTIALS_PATH: str | None = None
    FIREBASE_CREDENTIALS: str | None = None  # Direct JSON content in env (alternative to path)

    # Store as string to avoid automatic JSON parsing by pydantic-settings
    cors_origins_raw: str | list[str] = Field(
        default="http://localhost:3000,http://localhost:5173", validation_alias="CORS_ORIGINS"
    )

    @field_validator("cors_origins_raw", mode="after")
    @classmethod
    def _reject_wildcard_origin(cls, v: str | list[str]) -> str | list[str]:
        # Every browser call carries credentials, and Starlette answers a wildcard
        # allow-list by echoing back whichever Origin asked while still sending
        # Access-Control-Allow-Credentials - so "*" hands any site on the internet
        # authenticated access. There is no environment where it is the right value,
        # so it is rejected at startup rather than left to differ between dev and prod.
        if "*" in _parse_origins(v):
            raise ValueError("CORS_ORIGINS must list explicit origins; '*' is not allowed")
        return v

    # Shared secret for signing tiler access tokens (HS256 JWT). Must match the tilers.
    TILER_TOKEN_SECRET: str = DEV_TILER_TOKEN_SECRET

    # AES-256-GCM master key for encrypting imagery provider API keys at rest (base64 of 32 bytes).
    # On Azure this App Setting is a Key Vault reference so the real key lives in Key Vault.
    APIKEY_ENCRYPTION_SECRET: str = DEV_APIKEY_ENCRYPTION_SECRET

    @field_validator("APIKEY_ENCRYPTION_SECRET", mode="after")
    @classmethod
    def _key_must_be_aes256(cls, v: str) -> str:
        # A key of the wrong shape is only noticed by whichever request first encrypts a
        # provider key, which surfaces as a 500 rather than as bad configuration. Check it
        # here so an unusable key is a boot failure with the reason attached.
        try:
            key = base64.b64decode(v, validate=True)
        except binascii.Error as exc:
            raise ValueError("APIKEY_ENCRYPTION_SECRET must be valid base64") from exc
        if len(key) != 32:
            raise ValueError(
                "APIKEY_ENCRYPTION_SECRET must be base64 of exactly 32 bytes (AES-256), "
                f"got {len(key)}"
            )
        return v

    # tiler_token cookie attributes. For sibling-subdomain deployments set
    # TILER_COOKIE_DOMAIN=".example.com" so the cookie reaches the tiler subdomains.
    TILER_COOKIE_DOMAIN: str | None = None
    # Only the three values a Set-Cookie header accepts; pydantic rejects
    # anything else at startup rather than minting a cookie browsers drop.
    TILER_COOKIE_SAMESITE: Literal["lax", "strict", "none"] = "lax"
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
        return _parse_origins(self.cors_origins_raw)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def TILE_DB_SLOTS(self) -> int:
        """Resolved tile bulkhead size: the explicit override, else the pool minus the
        share reserved for everything that is not a tile."""
        if self.DB_TILE_MAX_CONCURRENCY is not None:
            return max(1, self.DB_TILE_MAX_CONCURRENCY)
        pool = self.DB_POOL_SIZE + self.DB_MAX_OVERFLOW
        reserved = max(1, round(pool * NON_TILE_POOL_RESERVE))
        return max(1, pool - reserved)

    @computed_field  # type: ignore[prop-decorator]
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

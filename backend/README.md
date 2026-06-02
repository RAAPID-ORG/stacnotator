# Backend

FastAPI application. Handles auth, campaigns, annotations, STAC catalog browsing, mosaic registration, and custom map upload coordination.

## Stack

- **FastAPI** + **Uvicorn/Gunicorn**
- **SQLAlchemy 2.0** + **PostgreSQL** (PostGIS, pgvector)
- **Alembic** for migrations
- **pystac-client** for STAC catalog queries
- **Firebase Admin SDK** or local auth

## Structure

```
src/
├── main.py              # App factory, middleware, router registration
├── config.py            # Settings (pydantic-settings, .env file)
├── database.py          # SQLAlchemy engine + session factory
├── models.py            # Re-exports all ORM models for Alembic discovery
├── auth/                # Firebase + local auth, dependencies
├── campaigns/           # Campaign CRUD, background mosaic/embedding threads
├── imagery/             # Imagery sources, collections, STAC configs, custom maps, storage
├── annotation/          # Tasks, annotations, CSV/GeoJSON ingest
├── tiling/              # STAC search, mosaic registration, tile URL building
├── sampling_design/     # Sampling strategies, region upload
└── timeseries/          # Earth Engine time series
```

## Running Migrations

```bash
make dev-migrate          # Apply all pending migrations
make dev-shell-backend    # Shell into the container, then: alembic revision --autogenerate -m "description"
```

Migration files live in `alembic/versions/`. Each file has `upgrade()` and `downgrade()`.

## Configuration

All settings via environment variables (see `.env.example`). Key ones:

| Variable | Description |
|---|---|
| `AUTH_PROVIDER` | `firebase` or `local` |
| `STORAGE_PROVIDER` | `local` or `azure` |
| `AZURE_STORAGE_ACCOUNT_URL` | `https://account.blob.core.windows.net` (prod only) |
| `AZURE_STORAGE_CONTAINER` | Blob container name (default: `custom-maps`) |
| `TILER_TOKEN_SECRET` | Shared HMAC secret with the tiler |
| `EE_SERVICE_ACCOUNT` | Earth Engine service account (optional) |

## Background Jobs

Long-running operations run as daemon threads (not a queue):
- **Mosaic registration** - STAC searches, item storage, tile URL generation
- **Embedding computation** - Earth Engine calls for satellite embeddings

Both track status in the DB (`pending` → `registering` → `ready`/`failed`). Errors stored in `campaign.registration_errors`.

## Tests

```bash
make dev-shell-backend
pytest tests/
```

Tests are unit tests with mock DBs (no real database required). `conftest.py` sets DB env vars and imports all models.

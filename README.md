
# STACNotator

NASA Harvest's geospatial imagery annotation platform.

> [!Important]
> This software is still under development and not yet at a mature stage. It should be considered as a pre-release for alpha testing. The documentation will be released soon.

## Quick Start

### Development Setup (with Hot Reloading)

#### Prerequisites

- Ensure you have `docker` and `docker-compose` installed. Follow the setup instructions for your system [here](https://docs.docker.com/compose/install/#docker-desktop-recommended). The easiest way might be through `Docker Desktop`.

#### Option A - Local Mode (No Firebase, Quickest Setup)

For single-user local usage, no external auth provider is needed. The app runs with a built-in local user that has full admin access.

**Step 1 - Configure Environment**

```bash
cp .env.example .env
nano .env
```

The defaults in `.env.example` already use `AUTH_PROVIDER=local`. You might want to add the earth-engine credentials for timeseries functionality.

**Step 2 - Initialize & Start**

```bash
make dev-init
make dev-up
```

Open http://localhost:5173 and you're in.

> [!Warning]
> Local auth mode is for local development only. It cannot be used with `ENVIRONMENT=production` and should never be exposed to a network.

#### Option B - Firebase Auth (Multi-User Deployments)

For multi-user setups or production deployments, STACNotator uses Firebase for authentication.

You will need a Google Account for the Firebase setup.

**Step 0 - Firebase Setup**

1. Go to [Firebase Console](https://console.firebase.google.com/) and create a new project.
2. Navigate to **Settings > General**:
   - Note your **`FIREBASE_PROJECT_ID`**.
   - Scroll to **Your apps > \<your-app-name\>** and note the **`FIREBASE_API_KEY`** and **`FIREBASE_AUTH_DOMAIN`** from the SDK instructions.
3. Navigate to **Settings > Service Accounts**:
   - Select *Firebase Admin SDK* and click **Generate new private key**. Save the file.

**Step 1 - Configure Environment**

```bash
cp .env.example .env
nano .env
```

Set `AUTH_PROVIDER=firebase` and update the following variables:

| Variable | Description |
|---|---|
| `FIREBASE_CREDENTIALS_PATH_HOST` | Path to the Firebase service account credentials file (from Step 0) |
| `VITE_FIREBASE_API_KEY` | Firebase API key (from Step 0) |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain (from Step 0) |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID (from Step 0) |

For timeseries features, also set these in your `.env`:

| Variable | Description |
|---|---|
| `EE_SERVICE_ACCOUNT` | Email address of your Google Earth Engine service account |
| `EE_PRIVATE_KEY_PATH_HOST` | Path to the GEE service account private key file |

**Step 2 - Create a Firebase User**

1. Go to [Firebase Console](https://console.firebase.google.com/) and select your project.
2. Navigate to the **Authentication** tab.
3. Under **Users**, click **Add user** and follow the prompts.
4. Copy the **UID** of the newly created user.

**Step 3 - Initialize Services & Seed the Database**

```bash
make dev-init FIREBASE_UID="<YOUR-UID>"
```

**Step 4 - Start All Services**

```bash
make dev-up
```

The app will be available at:

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 (auto-reloads) |
| Backend | http://localhost:8000 (auto-reloads) |
| Tiler | http://localhost:8001 (auto-reloads) |
| API Docs | http://localhost:8000/docs |

#### Step 5 - Stop All Services

```bash
make dev-down
```


## Project Structure

```
stacnotator/
├── docker-compose.dev.yml       # Development configuration (standalone)
├── docker-compose.prod.yml      # Production-like local configuration
├── .env.example                 # Configuration template
├── .env.dev                     # Development configuration template
├── Makefile                     # Common commands (dev-* for development)
├── azure_deploy/                # Azure deployment scripts
├── backend/                     # FastAPI application
│   ├── Dockerfile               # Production build
│   ├── Dockerfile.dev           # Development (with reload)
│   ├── src/                     # Application code
│   └── alembic/                 # Database migrations
├── tiler/                       # TiTiler tile serving service
│   ├── Dockerfile               # Production build (GDAL + COG)
│   ├── Dockerfile.dev           # Development (with reload)
│   └── src/                     # Tile server code
└── frontend/                    # React + Vite application
    ├── Dockerfile               # Production build (nginx)
    ├── Dockerfile.dev           # Development server (HMR)
    └── src/                     # Application code
```

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- 4GB+ RAM (If using AI modules GPU required!)
- Firebase credentials file (only if using `AUTH_PROVIDER=firebase`)

## Architecture

**Services:**
- **Frontend**: React app (Vite + OpenLayers). Backend client generated with `openapi-ts`. Deployed as Azure Static Web App in production.
- **Backend**: FastAPI application with Gunicorn workers. Handles auth, campaigns, annotations, STAC catalog browsing, and mosaic registration.
- **Tiler**: Self-hosted tile server (TiTiler + GDAL). Reads COGs from STAC catalogs, composites mosaics, serves PNG tiles. Uses PostGIS spatial index for fast per-tile item lookups.
- **Database**: PostgreSQL 16 with PostGIS (spatial queries), pgvector (embeddings)

## Development

A seperate docker-environment is provided for development that facilitates usage with hot-reloading.

```bash
# Build images for development, setup db and run migrations
make dev-init

# Start with hot-reloading
make dev-up

# Common commands - Check the Makefile for more
make dev-logs-backend      # Backend logs only
make dev-shell-backend     # Backend shell
make dev-migrate           # Run database migrations
make dev-down              # Stop all services
```

### Pre-commit Hooks

The project uses [pre-commit](https://pre-commit.com/) to enforce code quality on every commit.

```bash
# Install hooks (one-time setup)
make pre-commit-install
```

## Production Deployment

STACNotator supports multiple deployment options (or maybe only one at the moment):

- **Azure** (recommended) - Backend + Tiler on Container Apps, Frontend on Static Web App. Self-managed via `deploy-app.sh`. See `azure_deploy/README.md`.
   - Staging: `make staging-up` copies the production DB locally for safe migration testing before deployment.

- **Docker Compose** - For local VPS or bare metal. See `Makefile` for `make build`, `make up`, `make migrate`. May need updates as primary deployment target is Azure and we do not maintain any secure configs for bare metal deployments.

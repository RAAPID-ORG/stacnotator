
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
You can find instructions on how to setup a earth-engine Service account [here](https://developers.google.com/earth-engine/guides/service_account).
Please aware that if you create a campaign with embeddings-support activated or with timeseries, this might lead to errors, if no EE credentials are provided.

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

You can find instructions on how to setup a GEE Service account [here](https://developers.google.com/earth-engine/guides/service_account).

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
├── docker-compose.dev.yml       # Development configuration
├── docker-compose.prod.yml      # Production-like local configuration
├── .env.example                 # Configuration template
├── Makefile                     # Common commands (dev-* for development)
├── azure_deploy/                # Azure deployment scripts
├── backend/                     # FastAPI application
│   ├── src/                     # Application code
│   └── alembic/                 # Database migrations
├── tiler/                       # TiTiler tile-serving service
│   └── src/                     # Tile server code
├── worker/                      # Background COG-conversion worker
│   └── src/                     # Worker code
├── db/                          # PostgreSQL + PostGIS + pgvector image
├── frontend/                    # React + Vite application
│   └── src/                     # Application code
└── docs/                        # Architecture & feature docs
```

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- 4GB+ RAM (If using segment anything module - a GPU will be required! - currently not maintained)
- Firebase credentials file (only if using `AUTH_PROVIDER=firebase`)

## Architecture

**Services:**
- **Frontend**: React + OpenLayers. API client generated with `openapi-ts`. Deployed as Azure Static Web App.
- **Backend**: FastAPI + Gunicorn. Auth, campaigns, annotations, STAC catalog browsing, mosaic registration.
- **Tiler**: TiTiler + GDAL. Reads COGs from STAC catalogs and user-uploaded custom maps, composites mosaics, serves PNG tiles. PostGIS spatial index for per-tile item lookups.
- **Worker**: Lightweight polling service. Converts user-uploaded rasters to COG format (reproject → overviews → LZW COG). Reads/writes from shared object storage (local volume in dev, Azure Blob in prod).
- **Database**: PostgreSQL 16 + PostGIS (spatial queries) + pgvector (embeddings)

See [docs/architecture.md](docs/architecture.md) for a fuller description.

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

Primary target is **Azure**. See [azure_deploy/README.md](azure_deploy/README.md) for the full workflow.

- Backend + Tiler + Worker on **Azure Container Apps** (Managed Identity, no keys)
- Frontend on **Azure Static Web App**
- Database on **Azure Database for PostgreSQL** with private endpoint
- Custom map uploads stored in **Azure Blob Storage** (user-delegation SAS, no account keys)
- Infrastructure (networking, Key Vault, ACR, Container Apps Environment) managed by Terraform
- Application resources (Container Apps, identities, RBAC) managed via `deploy-app.sh`

Quick reference:
```bash
make staging-up        # Copy prod DB locally for safe migration testing
az-deploy-dev          # Deploy to dev environment
az-sync-prod-to-dev    # Sync prod data to dev
```

## Contributing
This project welcomes contributions and proposals. Please open up a issue deiscribing your requirements, proposed solutions or  encountered bugs. Check the [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to contribute.
To familiarize yourself with the project please referr to the [docs](docs/architecture.md).

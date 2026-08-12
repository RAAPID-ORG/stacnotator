
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
   - Note your **project ID**.
   - Scroll to **Your apps > \<your-app-name\>** and note the **API key** and **auth domain** from the SDK instructions (used as the `VITE_FIREBASE_*` variables below).
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
| API Docs | http://localhost:8000/api/docs (disabled in production) |

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
├── Makefile                     # Common commands (dev-* for development)
├── azure_deploy/                # Azure deployment scripts
├── backend/                     # FastAPI application
│   ├── Dockerfile               # Production build
│   ├── Dockerfile.dev           # Development (with reload)
│   ├── src/                     # Application code
│   └── alembic/                 # Database migrations
├── frontend/                    # React + Vite application
│   ├── Dockerfile               # Production build (nginx)
│   ├── Dockerfile.dev           # Development server (HMR)
│   └── src/                     # Application code
└── sdk/                         # Python SDK (active-learning client library)
```

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- 4GB+ RAM
- Firebase credentials file (only if using `AUTH_PROVIDER=firebase`)

## Architecture

**Services:**
- **Frontend**: React app (Vite + OpenLayers). Backend client generated with `openapi-ts`. Deployed as Azure Static Web App in production.
- **Backend**: FastAPI application (Gunicorn workers in production, uvicorn reload in dev). Handles auth, organizations/projects multi-tenancy, campaigns, annotations, STAC catalog browsing, mosaic registration, time series, and sampling design.
- **Tiler** (optional, separate repo: [stacnotator-tiler](https://github.com/RAAPID-ORG/stacnotator-tiler)): self-hosted TiTiler + GDAL tile server. Reads COGs from STAC catalogs into a pgstac index, composites mosaics, serves PNG tiles. Only needed for non-MPC catalogs or compositing/masking - MPC imagery with first-valid compositing is served directly by Planetary Computer.
- **Database**: PostgreSQL 16 with PostGIS (spatial queries), pgvector (embeddings)

More docs: [architecture](docs/architecture.md), [features](docs/features.md), [development workflow](docs/development.md), [tile serving](docs/tile-serving.md), [tilers](docs/tilers.md), [labelling policy](docs/labelling-policy.md).

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
make dev-openapi           # Regenerate the frontend API client from the running backend
make dev-down              # Stop all services

# Quality gates (CI runs the same)
make test                  # backend + SDK + E2E tests
make lint                  # ruff + eslint
make typecheck             # mypy + tsc
make ci-check              # everything above + format checks
```

### Imagery providers locally

By default the dev stack runs **db + backend + frontend** - no tiler. That fully covers
**Microsoft Planetary Computer (MPC) imagery with first-valid compositing**, which is
served straight from MPC (no tiler in the path).

A tiler is only needed for imagery from **outside MPC** (custom STAC catalogs), for
any additional **compositing / masking** (median, mean, NDVI-best, SCL masks), or for
custom-map COG overlays. An optional tiler ships behind a compose profile: set
`COMPOSE_PROFILES=tiler` plus `TILERS` and `DEFAULT_TILER` in your `.env` (the exact
values are in `.env.example`) and the dev stack brings up the tiler + its own pgstac
on `TILER_PORT` (default `8083`). The image is built straight from the
[stacnotator-tiler](https://github.com/RAAPID-ORG/stacnotator-tiler) GitHub repo, so no
separate checkout is needed; override `TILER_CONTEXT` with a local path to build your own.

Without a tiler configured, the backend's tiler registry is empty and non-MPC or
compositing imagery is rejected when you try to add it in campaign setup.

**Local vs deployed networking.** Locally this "just works" because the backend and
tiler share `localhost` (cookies aren't port-scoped). In a **deployed** setup, tile
access is authorized by an HttpOnly cookie the backend sets, so the browser only
sends it to the tiler if the tiler shares a **registrable domain** with the app -
i.e. same-origin behind a reverse proxy, or a sibling subdomain (`tiler.example.com`)
with `TILER_COOKIE_DOMAIN=.example.com`. A tiler on an unrelated domain can't receive
the cookie, so its tiles 401 in the browser even if the registry wiring is correct.
The tiler also shares the backend's `TILER_TOKEN_SECRET` (the backend mints HS256
tokens the tiler verifies), so a tiler is part of one trusted deployment - not a
third-party service you point at across origins. See the tiler repo's
"Production topology" for the exact reverse-proxy / subdomain setup.

### Pre-commit Hooks

The project uses [pre-commit](https://pre-commit.com/) to enforce code quality on every commit.

```bash
# Install hooks (one-time setup)
make pre-commit-install
```

## Production Deployment

STACNotator supports multiple deployment options (or maybe only one at the moment):

- **Azure** (recommended) - Backend + Tiler on Container Apps, Frontend on Static Web App. Self-managed via `azure_deploy/deploy.sh`. See `azure_deploy/README.md`.
   - Deployment: Prod deploys automatically via CI on push to `main` (gated by a `production` GitHub Environment approval); dev deploys via the manual `Deploy Dev` workflow. `deploy.sh` can also be run locally from within VPN as a fallback (`make az-deploy-dev`, followed by `make az-sync-prod-to-dev` to fill the dev db with current prod data).

- **Docker Compose** - For local VPS or bare metal. See `Makefile` for `make build`, `make up`, `make migrate`. May need updates as primary deployment target is Azure and we do not maintain any secure configs for bare metal deployments.

Any production deployment must replace the dev-default secrets: with `ENVIRONMENT=production` the backend refuses to start while `TILER_TOKEN_SECRET` or `APIKEY_ENCRYPTION_SECRET` still hold their dev defaults (on Azure, `bootstrap.sh` generates both).

## Contributing
This project welcomes contributions and proposals. Please open up a issue deiscribing your requirements, proposed solutions or  encountered bugs. Check the [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to contribute.
To familiarize yourself with the project please refer to the [docs](docs/architecture.md). For the development workflow (branching, reviews, CI) see [docs/development.md](docs/development.md).

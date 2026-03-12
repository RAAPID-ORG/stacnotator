
# STACNotator

NASA Harvest's geospatial imagery annotation platform.


## Quick Start

### Development Setup (with Hot Reloading)

#### Step 0 - Firebase Setup

STACNotator uses Firebase for authentication. Set up a project and download credentials:

1. Go to [Firebase Console](https://console.firebase.google.com/) and create a new project.
2. Navigate to **Settings > General**:
   - Note your **`FIREBASE_PROJECT_ID`**.
   - Scroll to **Your apps > \<your-app-name\>** and note the **`FIREBASE_API_KEY`** and **`FIREBASE_AUTH_DOMAIN`** from the SDK instructions.
3. Navigate to **Settings > Service Accounts**:
   - Select *Firebase Admin SDK* and click **Generate new private key**. Save the file.

#### Step 1 - Configure Environment

```bash
cp .env.dev .env
nano .env
```

Update the following variables:

| Variable | Description |
|---|---|
| `EE_SERVICE_ACCOUNT` | Email address of your Google Earth Engine service account (used for timeseries) |
| `EE_PRIVATE_KEY_PATH_HOST` | Path to the GEE service account private key file |
| `FIREBASE_CREDENTIALS_PATH_HOST` | Path to the Firebase service account credentials file (from Step 0) |
| `VITE_FIREBASE_API_KEY` | Firebase API key (from Step 0) |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain (from Step 0) |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID (from Step 0) |

#### Step 2 - Create a Firebase User

1. Go to [Firebase Console](https://console.firebase.google.com/) and select your project.
2. Navigate to the **Authentication** tab.
3. Under **Users**, click **Add user** and follow the prompts.
4. Copy the **UID** of the newly created user.

#### Step 3 - Initialize Services & Seed the Database

```bash
make dev-init FIREBASE_UID="<YOUR-UID>"
```

#### Step 4 - Start All Services

```bash
make dev-up
```

The app will be available at:

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 (auto-reloads) |
| Backend | http://localhost:8000 (auto-reloads) |
| API Docs | http://localhost:8000/docs |

#### Step 5 - Stop All Services

```bash
make dev-down
```


## Project Structure

```
stacnotator/
├── docker-compose.dev.yml       # Development configuration (standalone)
├── docker-compose.prod.yml      # Production configuration (standalone)
├── .env.example                 # Production configuration template
├── .env.dev                     # Development configuration template
├── Makefile                     # Common commands (dev-* for development)
├── DEVELOPMENT.md               # Development workflow guide
├── backend/         # FastAPI application
│   ├── Dockerfile               # Production build
│   ├── Dockerfile.dev           # Development (with reload)
│   ├── src/                     # Application code
│   └── config/                  # Credentials (gitignored)
├── frontend/        # React + Vite application
│   ├── Dockerfile               # Production build
│   ├── Dockerfile.dev           # Development server (HMR)
│   └── app/                     # Application code
└── nginx/                       # Reverse proxy (production only)
    ├── nginx.conf
    └── conf.d/
```

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- 4GB+ RAM (If using AI modules GPU required!)
- Firebase credentials file

## Architecture

**Services:**
- **Frontend**: React app (Served by nginx in bare metal production deployments). Backend Client is generated with `openapi-ts`.
- **Backend**: FastAPI application with Gunicorn workers
- **Database**: PostgreSQL 16 with PostGIS and Vector extension
- **Nginx**: Reverse proxy for production (Not used when deployed on Azure!)

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

The project uses [pre-commit](https://pre-commit.com/) to enforce code quality on every commit. Hooks include trailing whitespace fixes, secret detection (gitleaks), Ruff linting/formatting for the backend, and ESLint + TypeScript checks for the frontend.

```bash
# Install hooks (one-time setup)
make pre-commit-install

# Run all hooks manually against all files
make pre-commit-run
```

## Production Deployment

STACNotator supports multiple deployment options:

- **Docker Compose** - For local VPS or bare metal deployment (See `Makefile` for the "non-dev" commands.)
- **Deploy on Azure** - Cloud hosted version to be deployed in Azure via App Service. Check out `azure_deploy/README.md`.

### Production Checklist

- [ ] Strong `POSTGRES_PASSWORD` generated (32+ characters)
- [ ] Firebase credentials secured (permissions 600)
- [ ] CORS origins restricted to your domain
- [ ] `.env` file excluded from git
- [ ] Workers tuned for your CPU count (see Worker Configuration)
- [ ] Database not exposed publicly (remove `ports:` in docker-compose.prod.yml)
- [ ] Domain DNS pointed to your server
- [ ] Firewall configured (allow ports 80, 443)
- [ ] Do your own security checklist - this is just an initial reccomendation

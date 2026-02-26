
# STACNotator

A tool for annotating imagery from STAC Catalogs.


## Quick Start

### Development Setup (with Hot Reloading)

0. STACNotator uses Firebase to handle authentication. Create a new firebase project and generate firebase credentials.

1. **Copy and edit environment file:**
    ```bash
    cp .env.dev .env
    nano .env  # Add your Firebase credentials and any overrides (see examples)
    ```

2. **Create a user in firebase**
    - We use firebase to handle authentication. Create a firebase project.
    - Go to `https://console.firebase.google.com/`, and select your project.
    - Switch to the authentication tab.
    - Under users, click Add user and follow the promts.
    - Copy the UID of this new user.


3. **Initialize and start all services &  seed the DB with data for your user:**
    ```bash
    make dev-init FIREBASE_UID="<YOUR-UID>"
    ```

4. **Access the app:**
    - Frontend: http://localhost:5173 (auto-reloads)
    - Backend: http://localhost:8000 (auto-reloads)
    - API Docs: http://localhost:8000/docs

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
- **Frontend**: React app served by nginx. Backend Client is generated with `openapi-ts`.
- **Backend**: FastAPI application with Gunicorn workers
- **Database**: PostgreSQL 16 with PostGIS extension
- **Nginx**: Reverse proxy for production (Not used when deployed on Azure!)

## Development

A seperate docker-environment is provided for development that facilitates usage.

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

## Production Deployment

STACNotator supports multiple deployment options:

- **Docker Compose** - For local VPS or bare metal deployment (See `Makefile` for the "non-dev" commands.)
- **Deploy on Azure** - Cloud hosted version to be deployed in Azure via App Service. Check out `azure_deploy/README.md`.

### Production Checklist

- [ ] Strong `POSTGRES_PASSWORD` generated (32+ characters)
- [ ] Firebase credentials secured (permissions 600)
- [ ] CORS origins restricted to your domain
- [ ] `.env` file excluded from git
- [ ] **You are the first user to sign up** (for admin access)
- [ ] Workers tuned for your CPU count (see Worker Configuration)
- [ ] Database not exposed publicly (remove `ports:` in docker-compose.prod.yml)
- [ ] Domain DNS pointed to your server
- [ ] Firewall configured (allow ports 80, 443)


## Common Tasks

```bash
# Create database migration
make migrate-create MSG="add new table"

# View running containers
make ps

# Restart a service
make restart-backend

# Clean up everything
make clean
```
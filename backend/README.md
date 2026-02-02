# backend

Backend API for annotating geospatial imagery from STAC catalogs.

## Development Quick Start

The easiest way to get started is using the Makefile commands from the project root:

```bash
# Initialize and start everything (includes database seeding)
make dev-init

# Or if already initialized, just seed the database
make dev-seed

# Reset database completely (drop, recreate, migrate, seed)
make dev-reset

# Clear seed data only
make dev-seed-clear
```

## Manual Setup

**DEPRECATED NEED TO UPDATE**

## Setup

Install uv:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Install dependencies:
```bash
uv sync
```

Get your Firebase credentials from the Firebase Console (Project Settings > Service Accounts > Generate new private key) and save to the path specified below.

For Earth Engine, create a service account with least privilege permissions in Google Cloud Console Earth Engine access and download the private key.

Setup you local postgres database. If you are unfamiliar with this check out the [postgres docs](https://www.postgresql.org/) or consult your LLM of choice.

Create `config/.env`:
```
DBNAME=your_db_name
DBUSER=your_db_user
DBPASS=your_db_pass
DBHOST=localhost
DBPORT=5432

FIREBASE_CREDENTIALS_PATH=config/firebase-credentials.json

EE_SERVICE_ACCOUNT=your-service-account@project.iam.gserviceaccount.com
EE_PRIVATE_KEY_PATH=config/ee-key.json
```

**Note on Admin Users:**
The first user to sign up will automatically become an admin! Ensure to do this in a secure environment!

Run migrations:
```bash
uv run alembic upgrade head
```

## Running

Start the server:
```bash
uv run uvicorn src.main:app --reload
```

API docs available at `http://localhost:8000/docs`
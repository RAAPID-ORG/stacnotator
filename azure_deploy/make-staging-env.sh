#!/bin/bash
#
# Local Staging Environment
#
# Downloads the production database, spins up an isolated local stack,
# restores the dump, runs pending migrations, and opens the app in
# a browser so you can verify everything works before deploying.
#
# The dev stack (make dev-up) is NOT affected - this runs on separate
# ports and containers.
#
# Prerequisites:
#   - Logged into Azure CLI (az login)
#   - Connected to your organization's VPN
#   - Your IP whitelisted on the Azure Postgres Flexible Server networking
#   - Docker running
#
# Ports used:
#   DB:       5433
#   Backend:  8001
#   Frontend: 5174
#
# Usage:
#   ./azure_deploy/staging.sh           # full run
#   ./azure_deploy/staging.sh --down    # tear down the staging stack

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE="docker compose -p stacnotator-staging -f $PROJECT_ROOT/docker-compose.staging.yml"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Teardown mode (no Azure login needed)
if [[ "${1:-}" == "--down" ]]; then
    echo -e "${YELLOW}Tearing down staging stack...${NC}"
    $COMPOSE down -v --remove-orphans 2>/dev/null || true
    echo -e "${GREEN}✓ Staging stack removed${NC}"
    exit 0
fi

# Load prod config (always pulls from prod)
[ -f "$SCRIPT_DIR/.env.deploy.prod" ] && set -a && source "$SCRIPT_DIR/.env.deploy.prod" && set +a

if ! az account show &>/dev/null; then
    echo -e "${RED}Error: Not logged in to Azure. Run 'az login' first.${NC}"
    exit 1
fi

if [ -z "$RESOURCE_GROUP" ]; then
    echo -e "${RED}Error: RESOURCE_GROUP not set. Check .env.deploy.prod${NC}"
    exit 1
fi

BACKUP_DIR="$PROJECT_ROOT/db/backups"

# Staging DB credentials (must match docker-compose.staging.yml)
STG_USER="stacnotator"
STG_PASS="${STAGING_DB_PASSWORD:-changeme}"
STG_DB="stacnotator"
STG_PORT=5433

echo -e "${GREEN}Local Staging Environment${NC}"
echo -e "${BLUE}This will download the prod DB, run migrations against it,${NC}"
echo -e "${BLUE}and let you test the result at http://localhost:5174${NC}"
echo ""

# Discover Azure Postgres server
echo -e "${YELLOW}Looking up Azure Postgres Flexible Server...${NC}"
PG_SERVER=$(az postgres flexible-server list \
    --resource-group "$RESOURCE_GROUP" \
    --query "[0].name" -o tsv 2>/dev/null || true)

if [ -z "$PG_SERVER" ]; then
    echo -e "${RED}Error: No Postgres Flexible Server found in $RESOURCE_GROUP${NC}"
    exit 1
fi

PG_HOST="${PG_SERVER}.postgres.database.azure.com"
echo -e "${GREEN}✓ Server: ${PG_HOST}${NC}"

# Get DB credentials from Key Vault
echo -e "${YELLOW}Fetching credentials from Key Vault...${NC}"
KV_NAME=$(az keyvault list -g "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null || true)

if [ -z "$KV_NAME" ]; then
    echo -e "${RED}Error: No Key Vault found in $RESOURCE_GROUP${NC}"
    exit 1
fi

PG_PASS=$(az keyvault secret show --vault-name "$KV_NAME" --name "stacnotator-postgres-admin-password" --query "value" -o tsv 2>/dev/null || true)
PG_HOST_FROM_KV=$(az keyvault secret show --vault-name "$KV_NAME" --name "stacnotator-postgres-host" --query "value" -o tsv 2>/dev/null || true)
CONN_STR=$(az keyvault secret show --vault-name "$KV_NAME" --name "stacnotator-db-connection-string" --query "value" -o tsv 2>/dev/null || true)

if [ -n "$CONN_STR" ]; then
    PG_USER=$(echo "$CONN_STR" | sed -n 's|.*://\([^:]*\):.*|\1|p')
    PG_DBNAME=$(echo "$CONN_STR" | sed -n 's|.*/\([^?]*\).*|\1|p')
fi

[ -n "$PG_HOST_FROM_KV" ] && PG_HOST="$PG_HOST_FROM_KV"

# Fallback prompts
if [ -z "$PG_USER" ]; then
    read -p "Enter prod DB username: " PG_USER
fi
if [ -z "$PG_PASS" ]; then
    read -sp "Enter prod DB password: " PG_PASS
    echo ""
fi
if [ -z "$PG_DBNAME" ]; then
    read -p "Enter prod DB name [stacnotator]: " PG_DBNAME
    PG_DBNAME=${PG_DBNAME:-stacnotator}
fi

echo -e "${GREEN}✓ Credentials obtained${NC}"

# Dump production database
mkdir -p "$BACKUP_DIR"
DUMP_FILE="$BACKUP_DIR/prod_$(date +%Y%m%d_%H%M%S).sql"

echo ""
echo -e "${BLUE}Staging Plan${NC}"
echo -e "  Source:   ${YELLOW}${PG_USER}@${PG_HOST}/${PG_DBNAME}${NC}"
echo -e "  Dump:     ${YELLOW}${DUMP_FILE}${NC}"
echo -e "  Target:   ${YELLOW}localhost:${STG_PORT}/${STG_DB}  (isolated container)${NC}"
echo -e "  Frontend: ${YELLOW}http://localhost:5174${NC}"
echo -e "  Backend:  ${YELLOW}http://localhost:8001${NC}"
echo ""

echo -e "${YELLOW}Dumping production database...${NC}"
echo -e "${BLUE}  This may take a moment depending on DB size and network speed.${NC}"

PGPASSWORD="$PG_PASS" pg_dump \
    --host="$PG_HOST" \
    --port=5432 \
    --username="$PG_USER" \
    --dbname="$PG_DBNAME" \
    --no-owner \
    --no-privileges \
    --format=plain \
    > "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo -e "${GREEN}✓ Dump complete (${DUMP_SIZE}): ${DUMP_FILE}${NC}"

# Spin up isolated stack (wipe previous data)
echo ""
echo -e "${YELLOW}Starting staging stack (clean slate)...${NC}"
$COMPOSE down -v --remove-orphans 2>/dev/null || true
$COMPOSE up -d db

# Wait for DB to be healthy
echo -e "${YELLOW}Waiting for database to be ready...${NC}"
for i in $(seq 1 30); do
    if PGPASSWORD="$STG_PASS" psql -h localhost -p "$STG_PORT" -U "$STG_USER" -d "$STG_DB" -c "SELECT 1" &>/dev/null; then
        echo -e "${GREEN}✓ Database ready${NC}"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo -e "${RED}Error: Database did not become ready in time${NC}"
        $COMPOSE logs db
        exit 1
    fi
    sleep 1
done

# Restore prod dump
echo ""
echo -e "${YELLOW}Restoring production dump into staging database...${NC}"

PGPASSWORD="$STG_PASS" psql \
    --host=localhost \
    --port="$STG_PORT" \
    --username="$STG_USER" \
    --dbname="$STG_DB" \
    --set ON_ERROR_STOP=off \
    -f "$DUMP_FILE" \
    2>&1 | grep -iE "error|fatal" | grep -v "already exists" | head -10 || true

echo -e "${GREEN}✓ Restore complete${NC}"

# Show current alembic version (before migration)
echo ""
echo -e "${YELLOW}Current alembic version in prod dump:${NC}"
PGPASSWORD="$STG_PASS" psql \
    --host=localhost \
    --port="$STG_PORT" \
    --username="$STG_USER" \
    --dbname="$STG_DB" \
    -c "SELECT version_num FROM public.alembic_version;" 2>/dev/null || \
    echo -e "${YELLOW}  (no alembic_version table)${NC}"

# Start backend + frontend
echo ""
echo -e "${YELLOW}Starting backend and frontend...${NC}"
$COMPOSE up -d

# Wait for backend health
echo -e "${YELLOW}Waiting for backend to start...${NC}"
for i in $(seq 1 60); do
    if curl -sf http://localhost:8001/api/health &>/dev/null || curl -sf http://localhost:8001/api/docs &>/dev/null; then
        echo -e "${GREEN}✓ Backend is up${NC}"
        break
    fi
    if [ "$i" -eq 60 ]; then
        echo -e "${YELLOW}⚠ Backend may still be starting - check logs below${NC}"
        $COMPOSE logs --tail=20 backend
    fi
    sleep 2
done

# Run migrations
echo ""
echo -e "${YELLOW}Running alembic upgrade head...${NC}"
if $COMPOSE exec -T backend alembic upgrade head; then
    echo -e "${GREEN}✓ Migrations applied successfully${NC}"
else
    echo -e "${RED}✗ Migration FAILED - see output above${NC}"
    echo -e "${YELLOW}  The staging stack is still running so you can debug.${NC}"
    echo -e "${YELLOW}  DB:  psql -h localhost -p $STG_PORT -U $STG_USER -d $STG_DB${NC}"
    echo -e "${YELLOW}  Logs: $COMPOSE logs backend${NC}"
    echo -e "${YELLOW}  Tear down: ./azure_deploy/staging.sh --down${NC}"
    exit 1
fi

# Show new alembic version (after migration)
echo ""
echo -e "${YELLOW}Alembic version after migration:${NC}"
PGPASSWORD="$STG_PASS" psql \
    --host=localhost \
    --port="$STG_PORT" \
    --username="$STG_USER" \
    --dbname="$STG_DB" \
    -c "SELECT version_num FROM public.alembic_version;" 2>/dev/null || true

echo ""
echo -e "${GREEN}Staging Environment Ready!${NC}"
echo ""
echo -e "${BLUE}  Frontend:  ${NC}http://localhost:5174"
echo -e "${BLUE}  Backend:   ${NC}http://localhost:8001"
echo -e "${BLUE}  API Docs:  ${NC}http://localhost:8001/api/docs"
echo -e "${BLUE}  DB:        ${NC}psql -h localhost -p $STG_PORT -U $STG_USER -d $STG_DB"
echo ""
echo -e "${BLUE}  Prod DB dump: ${NC}${DUMP_FILE}"
echo ""
echo -e "${YELLOW}  Test the app in your browser. When satisfied, deploy with:${NC}"
echo -e "${YELLOW}    ./azure_deploy/deploy-app.sh${NC}"
echo ""
echo -e "${YELLOW}  To tear down the staging stack:${NC}"
echo -e "${YELLOW}    ./azure_deploy/staging.sh --down${NC}"
echo ""

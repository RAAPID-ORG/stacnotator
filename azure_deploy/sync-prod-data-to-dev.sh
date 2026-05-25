#!/bin/bash
#
# Sync Production Data to Dev Azure Environment
#
# Dumps the production database and restores it into the dev Azure Postgres,
# then runs migrations so the dev environment matches prod data with the
# latest schema.
#
# IMPORTANT - PROD DATA SAFETY:
#   - The only command run against prod is pg_dump (no writes).
#   - The script aborts if source (prod) host/RG equal target (dev) host/RG.
#   - The target host must look like the dev server (contains "stacnotator-dev").
#   - Dev (target) is ALWAYS the side that gets dropped/recreated, never prod.
#
# Prerequisites:
#   - Logged into Azure CLI (az login)
#   - On VPN, IP whitelisted on BOTH prod and dev Postgres servers
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

abort() { echo -e "${RED}Error: $*${NC}" >&2; exit 1; }

if ! az account show &>/dev/null; then
    abort "Not logged in to Azure. Run 'az login' first."
fi

# Load prod config

[ -f "$SCRIPT_DIR/.env.deploy.prod" ] && set -a && source "$SCRIPT_DIR/.env.deploy.prod" && set +a
PROD_RG="$RESOURCE_GROUP"
[ -z "$PROD_RG" ] && abort "RESOURCE_GROUP not set. Check .env.deploy.prod"

echo -e "${YELLOW}Looking up prod Postgres server...${NC}"
PROD_PG_SERVER=$(az postgres flexible-server list \
    --resource-group "$PROD_RG" --query "[0].name" -o tsv 2>/dev/null || true)
[ -z "$PROD_PG_SERVER" ] && abort "No Postgres Flexible Server found in $PROD_RG"
PROD_PG_HOST="${PROD_PG_SERVER}.postgres.database.azure.com"

PROD_KV_NAME=$(az keyvault list -g "$PROD_RG" --query "[0].name" -o tsv 2>/dev/null || true)
[ -z "$PROD_KV_NAME" ] && abort "No Key Vault found in $PROD_RG"

PROD_PG_PASS=$(az keyvault secret show --vault-name "$PROD_KV_NAME" --name "stacnotator-prod-postgres-admin-password" --query "value" -o tsv 2>/dev/null || true)
PROD_PG_HOST_KV=$(az keyvault secret show --vault-name "$PROD_KV_NAME" --name "stacnotator-prod-postgres-host" --query "value" -o tsv 2>/dev/null || true)
PROD_CONN_STR=$(az keyvault secret show --vault-name "$PROD_KV_NAME" --name "stacnotator-prod-db-connection-string" --query "value" -o tsv 2>/dev/null || true)
if [ -n "$PROD_CONN_STR" ]; then
    PROD_PG_USER=$(echo "$PROD_CONN_STR" | sed -n 's|.*://\([^:]*\):.*|\1|p')
    PROD_PG_DBNAME=$(echo "$PROD_CONN_STR" | sed -n 's|.*/\([^?]*\).*|\1|p')
fi
[ -n "$PROD_PG_HOST_KV" ] && PROD_PG_HOST="$PROD_PG_HOST_KV"

[ -z "$PROD_PG_USER" ] && read -p "Enter prod DB username: " PROD_PG_USER
if [ -z "$PROD_PG_PASS" ]; then
    read -sp "Enter prod DB password: " PROD_PG_PASS
    echo ""
fi
PROD_PG_DBNAME=${PROD_PG_DBNAME:-stacnotator}

# Load dev config

[ -f "$SCRIPT_DIR/.env.deploy.dev" ] && set -a && source "$SCRIPT_DIR/.env.deploy.dev" && set +a
DEV_RG="$RESOURCE_GROUP"
[ -z "$DEV_RG" ] && abort "RESOURCE_GROUP not set. Check .env.deploy.dev"

echo -e "${YELLOW}Looking up dev Postgres server...${NC}"
DEV_PG_SERVER=$(az postgres flexible-server list \
    --resource-group "$DEV_RG" --query "[0].name" -o tsv 2>/dev/null || true)
[ -z "$DEV_PG_SERVER" ] && abort "No Postgres Flexible Server found in $DEV_RG"
DEV_PG_HOST="${DEV_PG_SERVER}.postgres.database.azure.com"

DEV_KV_NAME=$(az keyvault list -g "$DEV_RG" --query "[0].name" -o tsv 2>/dev/null || true)
[ -z "$DEV_KV_NAME" ] && abort "No Key Vault found in $DEV_RG"

DEV_PG_PASS=$(az keyvault secret show --vault-name "$DEV_KV_NAME" --name "stacnotator-dev-postgres-admin-password" --query "value" -o tsv 2>/dev/null || true)
DEV_PG_HOST_KV=$(az keyvault secret show --vault-name "$DEV_KV_NAME" --name "stacnotator-dev-postgres-host" --query "value" -o tsv 2>/dev/null || true)
DEV_CONN_STR=$(az keyvault secret show --vault-name "$DEV_KV_NAME" --name "stacnotator-dev-db-connection-string" --query "value" -o tsv 2>/dev/null || true)
if [ -n "$DEV_CONN_STR" ]; then
    DEV_PG_USER=$(echo "$DEV_CONN_STR" | sed -n 's|.*://\([^:]*\):.*|\1|p')
    DEV_PG_DBNAME=$(echo "$DEV_CONN_STR" | sed -n 's|.*/\([^?]*\).*|\1|p')
fi
[ -n "$DEV_PG_HOST_KV" ] && DEV_PG_HOST="$DEV_PG_HOST_KV"

[ -z "$DEV_PG_USER" ] && DEV_PG_USER="${PROD_PG_USER}"
if [ -z "$DEV_PG_PASS" ]; then
    read -sp "Enter dev DB password: " DEV_PG_PASS
    echo ""
fi
DEV_PG_DBNAME=${DEV_PG_DBNAME:-stacnotator}

# Safety guards - protect prod from any possible mishap

if [ "$PROD_PG_HOST" = "$DEV_PG_HOST" ]; then
    abort "PROD_PG_HOST == DEV_PG_HOST ($PROD_PG_HOST). Refusing to run."
fi
if [ -n "$PROD_RG" ] && [ -n "$DEV_RG" ] && [ "$PROD_RG" = "$DEV_RG" ]; then
    abort "PROD and DEV resource groups are identical ($PROD_RG). Refusing to run."
fi
if [ "$PROD_PG_HOST/$PROD_PG_DBNAME" = "$DEV_PG_HOST/$DEV_PG_DBNAME" ]; then
    abort "Source and target database identifiers are identical. Refusing to run."
fi

case "$DEV_PG_HOST" in
    *stacnotator-dev*) ;;
    *) abort "DEV_PG_HOST ($DEV_PG_HOST) does not look like a dev server. Refusing to run." ;;
esac

echo -e "${GREEN}✓ Source: ${PROD_PG_USER}@${PROD_PG_HOST}/${PROD_PG_DBNAME}${NC}"
echo -e "${GREEN}✓ Target: ${DEV_PG_USER}@${DEV_PG_HOST}/${DEV_PG_DBNAME}${NC}"

# Confirm

DUMP_FILE="${TMPDIR:-/tmp}/stacnotator_prod_to_dev_dump.sql"

echo ""
echo -e "${BLUE}Sync Plan${NC}"
echo -e "  Source (prod): ${YELLOW}${PROD_PG_USER}@${PROD_PG_HOST}/${PROD_PG_DBNAME}${NC}"
echo -e "  Target (dev):  ${YELLOW}${DEV_PG_USER}@${DEV_PG_HOST}/${DEV_PG_DBNAME}${NC}"
echo -e "  Dump file:     ${YELLOW}${DUMP_FILE}${NC}"
echo ""
echo -e "${RED}⚠  This will DESTROY all data in the dev database!${NC}"
read -p "Proceed? (y/N) " CONFIRM
[[ ! "$CONFIRM" =~ ^[Yy]$ ]] && echo "Cancelled." && exit 0

# Dump prod (pg_dump is read-only by nature)

echo ""
echo -e "${YELLOW}Dumping production database...${NC}"
PGPASSWORD="$PROD_PG_PASS" pg_dump \
    --host="$PROD_PG_HOST" --port=5432 \
    --username="$PROD_PG_USER" --dbname="$PROD_PG_DBNAME" \
    --no-owner --no-privileges --format=plain \
    > "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo -e "${GREEN}✓ Dump complete (${DUMP_SIZE})${NC}"

# Restore into dev (target only - prod is untouched from here on)

echo ""
echo -e "${YELLOW}Dropping and recreating dev database...${NC}"
PGPASSWORD="$DEV_PG_PASS" psql \
    --host="$DEV_PG_HOST" --port=5432 \
    --username="$DEV_PG_USER" --dbname=postgres \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DEV_PG_DBNAME' AND pid <> pg_backend_pid();" 2>/dev/null || true

PGPASSWORD="$DEV_PG_PASS" psql \
    --host="$DEV_PG_HOST" --port=5432 \
    --username="$DEV_PG_USER" --dbname=postgres \
    -c "DROP DATABASE IF EXISTS \"$DEV_PG_DBNAME\";"

PGPASSWORD="$DEV_PG_PASS" psql \
    --host="$DEV_PG_HOST" --port=5432 \
    --username="$DEV_PG_USER" --dbname=postgres \
    -c "CREATE DATABASE \"$DEV_PG_DBNAME\";"

echo -e "${YELLOW}Restoring dump into dev database...${NC}"
PGPASSWORD="$DEV_PG_PASS" psql \
    --host="$DEV_PG_HOST" --port=5432 \
    --username="$DEV_PG_USER" --dbname="$DEV_PG_DBNAME" \
    --set ON_ERROR_STOP=off \
    -f "$DUMP_FILE" \
    2>&1 | grep -iE "error|fatal" | grep -v "already exists" | head -10 || true

echo -e "${GREEN}✓ Restore complete${NC}"

# Run migrations (safety net - container startup also runs alembic upgrade head)

echo ""
echo -e "${YELLOW}Running migrations on dev...${NC}"

APP_BACKEND="stacnotator-dev-backend"

if az containerapp show --name "$APP_BACKEND" -g "$DEV_RG" &>/dev/null; then
    REPLICA_NAME=$(az containerapp replica list --name "$APP_BACKEND" -g "$DEV_RG" \
        --query "[0].name" -o tsv 2>/dev/null || echo "")

    if [ -n "$REPLICA_NAME" ]; then
        az containerapp exec --name "$APP_BACKEND" -g "$DEV_RG" \
            --replica "$REPLICA_NAME" --command "alembic upgrade head" 2>&1 || true
        echo -e "${GREEN}✓ Migrations done${NC}"
    else
        echo -e "${YELLOW}⚠ No running replica found. Migrations will run on next deploy.${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Dev backend not deployed yet. Migrations will run when deploy-app.sh dev runs.${NC}"
fi

rm -f "$DUMP_FILE"

echo ""
echo -e "${GREEN}Prod → Dev Sync Complete${NC}"
echo ""

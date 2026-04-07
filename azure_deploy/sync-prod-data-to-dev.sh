#!/bin/bash
#
# Sync Production Data to Dev Azure Environment
#
# Dumps the production database and restores it into the dev Azure Postgres,
# then runs migrations so the dev environment matches prod data with latest schema.
#
# Prerequisites:
#   - Logged into Azure CLI (az login)
#   - Connected to your organization's VPN
#   - Your IP whitelisted on BOTH prod and dev Azure Postgres Flexible Servers
#   - Dev infrastructure deployed via Terraform (RG, DB, KV exist)
#
# Usage:
#   ./azure_deploy/sync-prod-data-to-dev.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

if ! az account show &>/dev/null; then
    echo -e "${RED}Error: Not logged in to Azure. Run 'az login' first.${NC}"
    exit 1
fi

# Load prod config

[ -f "$SCRIPT_DIR/.env.deploy.prod" ] && set -a && source "$SCRIPT_DIR/.env.deploy.prod" && set +a
PROD_RG="$RESOURCE_GROUP"

if [ -z "$PROD_RG" ]; then
    echo -e "${RED}Error: RESOURCE_GROUP not set. Check .env.deploy.prod${NC}"
    exit 1
fi

# Discover prod Postgres
echo -e "${YELLOW}Looking up prod Postgres server...${NC}"
PROD_PG_SERVER=$(az postgres flexible-server list \
    --resource-group "$PROD_RG" \
    --query "[0].name" -o tsv 2>/dev/null || true)

if [ -z "$PROD_PG_SERVER" ]; then
    echo -e "${RED}Error: No Postgres Flexible Server found in $PROD_RG${NC}"
    exit 1
fi

PROD_PG_HOST="${PROD_PG_SERVER}.postgres.database.azure.com"

# Get prod credentials from Key Vault
PROD_KV_NAME=$(az keyvault list -g "$PROD_RG" --query "[0].name" -o tsv 2>/dev/null || true)
[ -z "$PROD_KV_NAME" ] && echo -e "${RED}Error: No Key Vault found in $PROD_RG${NC}" && exit 1

PROD_PG_PASS=$(az keyvault secret show --vault-name "$PROD_KV_NAME" --name "stacnotator-postgres-admin-password" --query "value" -o tsv 2>/dev/null || true)
PROD_PG_HOST_KV=$(az keyvault secret show --vault-name "$PROD_KV_NAME" --name "stacnotator-postgres-host" --query "value" -o tsv 2>/dev/null || true)
PROD_CONN_STR=$(az keyvault secret show --vault-name "$PROD_KV_NAME" --name "stacnotator-db-connection-string" --query "value" -o tsv 2>/dev/null || true)

if [ -n "$PROD_CONN_STR" ]; then
    PROD_PG_USER=$(echo "$PROD_CONN_STR" | sed -n 's|.*://\([^:]*\):.*|\1|p')
    PROD_PG_DBNAME=$(echo "$PROD_CONN_STR" | sed -n 's|.*/\([^?]*\).*|\1|p')
fi

[ -n "$PROD_PG_HOST_KV" ] && PROD_PG_HOST="$PROD_PG_HOST_KV"

# Fallback prompts for prod
[ -z "$PROD_PG_USER" ] && read -p "Enter prod DB username: " PROD_PG_USER
if [ -z "$PROD_PG_PASS" ]; then
    read -sp "Enter prod DB password: " PROD_PG_PASS
    echo ""
fi
PROD_PG_DBNAME=${PROD_PG_DBNAME:-stacnotator}

echo -e "${GREEN}✓ Prod: ${PROD_PG_USER}@${PROD_PG_HOST}/${PROD_PG_DBNAME}${NC}"

# Load dev config

[ -f "$SCRIPT_DIR/.env.deploy.dev" ] && set -a && source "$SCRIPT_DIR/.env.deploy.dev" && set +a
DEV_RG="$RESOURCE_GROUP"

if [ -z "$DEV_RG" ]; then
    echo -e "${RED}Error: RESOURCE_GROUP not set. Check .env.deploy.dev${NC}"
    exit 1
fi

echo -e "${YELLOW}Looking up dev Postgres server...${NC}"
DEV_PG_SERVER=$(az postgres flexible-server list \
    --resource-group "$DEV_RG" \
    --query "[0].name" -o tsv 2>/dev/null || true)

if [ -z "$DEV_PG_SERVER" ]; then
    echo -e "${RED}Error: No Postgres Flexible Server found in $DEV_RG${NC}"
    exit 1
fi

DEV_PG_HOST="${DEV_PG_SERVER}.postgres.database.azure.com"

# Get dev credentials from Key Vault
DEV_KV_NAME=$(az keyvault list -g "$DEV_RG" --query "[0].name" -o tsv 2>/dev/null || true)
[ -z "$DEV_KV_NAME" ] && echo -e "${RED}Error: No Key Vault found in $DEV_RG${NC}" && exit 1

DEV_PG_PASS=$(az keyvault secret show --vault-name "$DEV_KV_NAME" --name "stacnotator-postgres-admin-password" --query "value" -o tsv 2>/dev/null || true)
DEV_PG_HOST_KV=$(az keyvault secret show --vault-name "$DEV_KV_NAME" --name "stacnotator-postgres-host" --query "value" -o tsv 2>/dev/null || true)
DEV_CONN_STR=$(az keyvault secret show --vault-name "$DEV_KV_NAME" --name "stacnotator-db-connection-string" --query "value" -o tsv 2>/dev/null || true)

if [ -n "$DEV_CONN_STR" ]; then
    DEV_PG_USER=$(echo "$DEV_CONN_STR" | sed -n 's|.*://\([^:]*\):.*|\1|p')
    DEV_PG_DBNAME=$(echo "$DEV_CONN_STR" | sed -n 's|.*/\([^?]*\).*|\1|p')
fi

[ -n "$DEV_PG_HOST_KV" ] && DEV_PG_HOST="$DEV_PG_HOST_KV"

# Fallback prompts for dev
[ -z "$DEV_PG_USER" ] && DEV_PG_USER="${PROD_PG_USER}"
if [ -z "$DEV_PG_PASS" ]; then
    read -sp "Enter dev DB password: " DEV_PG_PASS
    echo ""
fi
DEV_PG_DBNAME=${DEV_PG_DBNAME:-stacnotator}

echo -e "${GREEN}✓ Dev:  ${DEV_PG_USER}@${DEV_PG_HOST}/${DEV_PG_DBNAME}${NC}"

# Confirm

DUMP_FILE="/tmp/stacnotator_prod_to_dev_dump.sql"

echo ""
echo -e "${BLUE}Sync Plan${NC}"
echo -e "  Source (prod): ${YELLOW}${PROD_PG_USER}@${PROD_PG_HOST}/${PROD_PG_DBNAME}${NC}"
echo -e "  Target (dev):  ${YELLOW}${DEV_PG_USER}@${DEV_PG_HOST}/${DEV_PG_DBNAME}${NC}"
echo -e "  Dump file:     ${YELLOW}${DUMP_FILE}${NC}"
echo ""
echo -e "${RED}⚠  This will DESTROY all data in the dev database!${NC}"
read -p "Proceed? (y/N) " CONFIRM
[[ ! "$CONFIRM" =~ ^[Yy]$ ]] && echo "Cancelled." && exit 0

# Dump prod

echo ""
echo -e "${YELLOW}Dumping production database...${NC}"
PGPASSWORD="$PROD_PG_PASS" pg_dump \
    --host="$PROD_PG_HOST" \
    --port=5432 \
    --username="$PROD_PG_USER" \
    --dbname="$PROD_PG_DBNAME" \
    --no-owner \
    --no-privileges \
    --format=plain \
    > "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo -e "${GREEN}✓ Dump complete (${DUMP_SIZE})${NC}"

# Restore into dev

echo ""
echo -e "${YELLOW}Dropping and recreating dev database...${NC}"

PGPASSWORD="$DEV_PG_PASS" psql \
    --host="$DEV_PG_HOST" \
    --port=5432 \
    --username="$DEV_PG_USER" \
    --dbname=postgres \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DEV_PG_DBNAME' AND pid <> pg_backend_pid();" 2>/dev/null || true

PGPASSWORD="$DEV_PG_PASS" psql \
    --host="$DEV_PG_HOST" \
    --port=5432 \
    --username="$DEV_PG_USER" \
    --dbname=postgres \
    -c "DROP DATABASE IF EXISTS \"$DEV_PG_DBNAME\";"

PGPASSWORD="$DEV_PG_PASS" psql \
    --host="$DEV_PG_HOST" \
    --port=5432 \
    --username="$DEV_PG_USER" \
    --dbname=postgres \
    -c "CREATE DATABASE \"$DEV_PG_DBNAME\";"

echo -e "${YELLOW}Restoring dump into dev database...${NC}"
PGPASSWORD="$DEV_PG_PASS" psql \
    --host="$DEV_PG_HOST" \
    --port=5432 \
    --username="$DEV_PG_USER" \
    --dbname="$DEV_PG_DBNAME" \
    --set ON_ERROR_STOP=off \
    -f "$DUMP_FILE" \
    2>&1 | grep -iE "error|fatal" | grep -v "already exists" | head -10 || true

echo -e "${GREEN}✓ Restore complete${NC}"

# Run migrations

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
    echo -e "${YELLOW}⚠ Dev backend not deployed yet. Run: ./azure_deploy/deploy-app.sh dev${NC}"
fi

# Cleanup

rm -f "$DUMP_FILE"

echo ""
echo -e "${GREEN}Prod → Dev Sync Complete${NC}"
echo ""

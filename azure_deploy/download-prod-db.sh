#!/bin/bash
#
# Download production database and restore it into the local dev DB.
#
# Prerequisites:
#   - Logged into Azure CLI (az login)
#   - Connected to your organization's VPN
#   - Your IP whitelisted on the Azure Postgres Flexible Server networking settings
#   - Local dev stack running (make dev-up)
#
# Usage:
#   ./azure_deploy/download-prod-db.sh
#
# The script will:
#   - Look up DB credentials from Azure Key Vault
#   - pg_dump the production database
#   - Drop & recreate the local dev database
#   - Restore the dump into the local dev database

set -e

# Auto-load config from .env.deploy if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/.env.deploy" ] && set -a && source "$SCRIPT_DIR/.env.deploy" && set +a

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}Download Production DB to Local Dev${NC}"
echo ""

# Azure login check
if ! az account show &>/dev/null; then
    echo -e "${RED}Error: Not logged in to Azure. Run 'az login' first.${NC}"
    exit 1
fi

# Resource group
if [ -z "$RESOURCE_GROUP" ]; then
    read -p "Enter Azure Resource Group name: " RESOURCE_GROUP
    if [ -z "$RESOURCE_GROUP" ]; then
        echo -e "${RED}Error: RESOURCE_GROUP is required. Set it via env var or enter it when prompted.${NC}"
        exit 1
    fi
fi

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

# Try to get credentials from Key Vault secrets
PG_PASS=$(az keyvault secret show --vault-name "$KV_NAME" --name "stacnotator-postgres-admin-password" --query "value" -o tsv 2>/dev/null || true)
PG_HOST_FROM_KV=$(az keyvault secret show --vault-name "$KV_NAME" --name "stacnotator-postgres-host" --query "value" -o tsv 2>/dev/null || true)

# Parse connection string for DB name and user if available
CONN_STR=$(az keyvault secret show --vault-name "$KV_NAME" --name "stacnotator-db-connection-string" --query "value" -o tsv 2>/dev/null || true)

if [ -n "$CONN_STR" ]; then
    # Connection string format: postgresql://user:pass@host:port/dbname
    PG_USER=$(echo "$CONN_STR" | sed -n 's|.*://\([^:]*\):.*|\1|p')
    PG_DBNAME=$(echo "$CONN_STR" | sed -n 's|.*/\([^?]*\).*|\1|p')
fi

# Use host from KV if discovered server didn't work
if [ -n "$PG_HOST_FROM_KV" ]; then
    PG_HOST="$PG_HOST_FROM_KV"
fi

# Fallback: prompt for anything still missing
if [ -z "$PG_USER" ]; then
    read -p "Enter prod DB username: " PG_USER
fi
if [ -z "$PG_PASS" ]; then
    read -sp "Enter prod DB password (from Azure Portal / Key Vault): " PG_PASS
    echo ""
fi
if [ -z "$PG_DBNAME" ]; then
    read -p "Enter prod DB name [stacnotator]: " PG_DBNAME
    PG_DBNAME=${PG_DBNAME:-stacnotator}
fi

echo -e "${GREEN}✓ Credentials obtained${NC}"

# Read local dev credentials from .env
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

LOCAL_USER="${POSTGRES_USER:-stacnotator}"
LOCAL_PASS="${POSTGRES_PASSWORD:-devpassword}"
LOCAL_DB="${POSTGRES_DB:-stacnotator}"
LOCAL_PORT="${POSTGRES_PORT:-5432}"

# Confirm
DUMP_FILE="/tmp/stacnotator_prod_dump.sql"
BACKUP_DIR="$PROJECT_ROOT/db/backups"
BACKUP_FILE="$BACKUP_DIR/dev_backup_$(date +%Y%m%d_%H%M%S).sql"

echo ""
echo -e "${BLUE}Download Plan${NC}"
echo -e "  Source:  ${YELLOW}${PG_USER}@${PG_HOST}/${PG_DBNAME}${NC}"
echo -e "  Dump:    ${YELLOW}${DUMP_FILE}${NC}"
echo ""
read -p "Download production database? (y/N) " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# Dump production DB (full database: all schemas, extensions, data)
echo ""
echo -e "${YELLOW}Dumping full production database (all schemas, extensions, and data)...${NC}"
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

# Ask whether to restore into local dev DB
echo ""
echo -e "${YELLOW}Also restore into local dev database?${NC}"
echo -e "  Target:  ${YELLOW}${LOCAL_USER}@localhost:${LOCAL_PORT}/${LOCAL_DB}${NC}"
echo -e "${RED}  ⚠  This will DESTROY all data in the local dev database!${NC}"
read -p "Restore into local DB? (y/N) " RESTORE_CONFIRM
if [[ ! "$RESTORE_CONFIRM" =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${GREEN}Done. Dump saved to: ${DUMP_FILE}${NC}"
    echo -e "${BLUE}To restore manually later:${NC}"
    echo -e "  make dev-restore-backup FILE=${DUMP_FILE}"
    exit 0
fi

# Backup current local dev DB
echo ""
echo -e "${YELLOW}Backing up current local dev database...${NC}"
mkdir -p "$BACKUP_DIR"

PGPASSWORD="$LOCAL_PASS" pg_dump \
    --host=localhost \
    --port="$LOCAL_PORT" \
    --username="$LOCAL_USER" \
    --dbname="$LOCAL_DB" \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists \
    --schema=data \
    --schema=auth \
    --schema=public \
    --format=plain \
    > "$BACKUP_FILE" 2>/dev/null || true

if [ -s "$BACKUP_FILE" ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✓ Local backup saved (${BACKUP_SIZE}): ${BACKUP_FILE}${NC}"
else
    echo -e "${YELLOW}⚠ Local DB appears empty, skipping backup${NC}"
    rm -f "$BACKUP_FILE"
fi

# Restore into local dev DB
echo ""
echo -e "${YELLOW}Restoring into local dev database...${NC}"

# Drop and recreate the local database so we start completely clean
PGPASSWORD="$LOCAL_PASS" psql \
    --host=localhost \
    --port="$LOCAL_PORT" \
    --username="$LOCAL_USER" \
    --dbname=postgres \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$LOCAL_DB' AND pid <> pg_backend_pid();"

PGPASSWORD="$LOCAL_PASS" psql \
    --host=localhost \
    --port="$LOCAL_PORT" \
    --username="$LOCAL_USER" \
    --dbname=postgres \
    -c "DROP DATABASE IF EXISTS \"$LOCAL_DB\";"

PGPASSWORD="$LOCAL_PASS" psql \
    --host=localhost \
    --port="$LOCAL_PORT" \
    --username="$LOCAL_USER" \
    --dbname=postgres \
    -c "CREATE DATABASE \"$LOCAL_DB\";"

# Restore the dump (ON_ERROR_STOP shows first real error instead of cascading)
PGPASSWORD="$LOCAL_PASS" psql \
    --host=localhost \
    --port="$LOCAL_PORT" \
    --username="$LOCAL_USER" \
    --dbname="$LOCAL_DB" \
    --set ON_ERROR_STOP=off \
    -f "$DUMP_FILE" \
    2>&1 | grep -i "error\|warning" | head -20

echo -e "${GREEN}✓ Restore complete${NC}"

# Verify
echo ""
echo -e "${YELLOW}Verifying restored data...${NC}"

PGPASSWORD="$LOCAL_PASS" psql \
    --host=localhost \
    --port="$LOCAL_PORT" \
    --username="$LOCAL_USER" \
    --dbname="$LOCAL_DB" \
    -c "\dt data.*"

# Update alembic_version to match prod
echo ""
echo -e "${YELLOW}Checking alembic version...${NC}"
PGPASSWORD="$LOCAL_PASS" psql \
    --host=localhost \
    --port="$LOCAL_PORT" \
    --username="$LOCAL_USER" \
    --dbname="$LOCAL_DB" \
    -c "SELECT * FROM public.alembic_version;" 2>/dev/null || \
    echo -e "${YELLOW}No alembic_version table found (will be created on next migrate)${NC}"

# Cleanup
rm -f "$DUMP_FILE"

echo ""
echo -e "${GREEN}Done! Local dev DB now mirrors prod.${NC}"
echo ""

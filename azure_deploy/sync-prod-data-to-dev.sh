#!/bin/bash
#
# Sync Production Data to Dev Azure Environment
#
# Dumps the production database (via a read-only Postgres role) and restores
# it into the dev Azure Postgres, then runs migrations so the dev environment
# matches prod data with the latest schema.
#
# IMPORTANT - PROD DATA SAFETY:
#   - The dump uses a designated read-only Postgres user on prod.
#   - The script aborts if that user has ANY write/DDL privileges on prod tables.
#   - The script aborts if source (prod) host/RG equal target (dev) host/RG.
#   - Dev (target) is ALWAYS the side that gets dropped/recreated, never prod.
#
# Two modes:
#
#   1) Interactive (default): reads creds from prod Key Vault, prompts to confirm.
#      Used by humans on VPN.
#
#   2) CI (set CI=true): no prompts, no prod KV access, all credentials come
#      from environment variables (the workflow populates them from the dev
#      Key Vault, where prod-readonly creds have been mirrored once).
#
#      Required env vars in CI mode:
#        PROD_PG_HOST, PROD_PG_USER, PROD_PG_PASS, PROD_PG_DBNAME
#        DEV_PG_HOST,  DEV_PG_USER,  DEV_PG_PASS,  DEV_PG_DBNAME
#        RESOURCE_GROUP (dev RG, for the post-restore migration step)
#
# Prerequisites (interactive mode):
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

if [ "$CI" = "true" ]; then
    # ---------------- CI MODE ----------------
    # All credentials must come from the environment. No prod Azure CLI calls.

    for v in PROD_PG_HOST PROD_PG_USER PROD_PG_PASS PROD_PG_DBNAME \
             DEV_PG_HOST DEV_PG_USER DEV_PG_PASS DEV_PG_DBNAME RESOURCE_GROUP; do
        [ -z "${!v}" ] && abort "$v not set (required in CI mode)"
    done

    DEV_RG="$RESOURCE_GROUP"

    # Mask secrets in workflow logs (no-op if not running under Actions).
    for s in "$PROD_PG_PASS" "$DEV_PG_PASS" "$PROD_PG_HOST" "$DEV_PG_HOST" \
             "$PROD_PG_USER" "$DEV_PG_USER"; do
        [ -n "$s" ] && echo "::add-mask::$s"
    done
else
    # ---------------- INTERACTIVE MODE ----------------
    if ! az account show &>/dev/null; then
        abort "Not logged in to Azure. Run 'az login' first."
    fi

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
fi

# =============================================================================
# SAFETY GUARDS - protect prod from any possible mishap
# =============================================================================

# 1. Source and target must not be the same server / DB / RG.
if [ "$PROD_PG_HOST" = "$DEV_PG_HOST" ]; then
    abort "PROD_PG_HOST == DEV_PG_HOST ($PROD_PG_HOST). Refusing to run."
fi
if [ -n "$PROD_RG" ] && [ -n "$DEV_RG" ] && [ "$PROD_RG" = "$DEV_RG" ]; then
    abort "PROD and DEV resource groups are identical ($PROD_RG). Refusing to run."
fi
if [ "$PROD_PG_HOST/$PROD_PG_DBNAME" = "$DEV_PG_HOST/$DEV_PG_DBNAME" ]; then
    abort "Source and target database identifiers are identical. Refusing to run."
fi

# 2. Target (dev) host must look like the dev server (defense in depth against
#    swapped env vars). The dev server name contains "stacnotator-dev".
case "$DEV_PG_HOST" in
    *stacnotator-dev*) ;;
    *) abort "DEV_PG_HOST ($DEV_PG_HOST) does not look like a dev server. Refusing to run." ;;
esac

# 3. Source (prod) user must be read-only. Probe pg_catalog for any write
#    privilege on any table in the target DB. If the user can write, refuse.
echo -e "${YELLOW}Verifying prod user is read-only...${NC}"
WRITE_PRIVS=$(PGPASSWORD="$PROD_PG_PASS" psql \
    --host="$PROD_PG_HOST" --port=5432 \
    --username="$PROD_PG_USER" --dbname="$PROD_PG_DBNAME" \
    -tAc "SELECT count(*) FROM information_schema.table_privileges
          WHERE grantee = current_user
            AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');" 2>/dev/null || echo "ERR")

if [ "$WRITE_PRIVS" = "ERR" ]; then
    abort "Could not connect to prod as $PROD_PG_USER@$PROD_PG_HOST/$PROD_PG_DBNAME"
fi
if [ "$WRITE_PRIVS" != "0" ]; then
    abort "Prod user '$PROD_PG_USER' has $WRITE_PRIVS write privilege(s). Use a SELECT-only role."
fi

# Also refuse if the user has CREATE on the database (could create/drop schemas).
CREATE_PRIV=$(PGPASSWORD="$PROD_PG_PASS" psql \
    --host="$PROD_PG_HOST" --port=5432 \
    --username="$PROD_PG_USER" --dbname="$PROD_PG_DBNAME" \
    -tAc "SELECT has_database_privilege(current_user, current_database(), 'CREATE');" 2>/dev/null || echo "ERR")
if [ "$CREATE_PRIV" = "t" ]; then
    abort "Prod user '$PROD_PG_USER' has CREATE on database. Use a SELECT-only role."
fi

echo -e "${GREEN}✓ Prod user verified read-only${NC}"
echo -e "${GREEN}✓ Source: ${PROD_PG_USER}@${PROD_PG_HOST}/${PROD_PG_DBNAME}${NC}"
echo -e "${GREEN}✓ Target: ${DEV_PG_USER}@${DEV_PG_HOST}/${DEV_PG_DBNAME}${NC}"

DUMP_FILE="${TMPDIR:-/tmp}/stacnotator_prod_to_dev_dump.sql"

if [ "$CI" != "true" ]; then
    echo ""
    echo -e "${BLUE}Sync Plan${NC}"
    echo -e "  Source (prod): ${YELLOW}${PROD_PG_USER}@${PROD_PG_HOST}/${PROD_PG_DBNAME}${NC}"
    echo -e "  Target (dev):  ${YELLOW}${DEV_PG_USER}@${DEV_PG_HOST}/${DEV_PG_DBNAME}${NC}"
    echo -e "  Dump file:     ${YELLOW}${DUMP_FILE}${NC}"
    echo ""
    echo -e "${RED}⚠  This will DESTROY all data in the dev database!${NC}"
    read -p "Proceed? (y/N) " CONFIRM
    [[ ! "$CONFIRM" =~ ^[Yy]$ ]] && echo "Cancelled." && exit 0
fi

# =============================================================================
# DUMP PROD (read-only, no writes possible with the verified user)
# =============================================================================

echo ""
echo -e "${YELLOW}Dumping production database...${NC}"
PGPASSWORD="$PROD_PG_PASS" pg_dump \
    --host="$PROD_PG_HOST" --port=5432 \
    --username="$PROD_PG_USER" --dbname="$PROD_PG_DBNAME" \
    --no-owner --no-privileges --format=plain \
    > "$DUMP_FILE"

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo -e "${GREEN}✓ Dump complete (${DUMP_SIZE})${NC}"

# =============================================================================
# RESTORE INTO DEV (target only - prod is untouched from here on)
# =============================================================================

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

# =============================================================================
# RUN MIGRATIONS (safety net - container startup also runs alembic upgrade head)
# =============================================================================

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

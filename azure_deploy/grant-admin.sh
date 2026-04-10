#!/bin/bash
#
# Grant 'approved' + 'admin' roles to a user, identified by Firebase external_uid.
#
# Idempotent: uses ON CONFLICT DO NOTHING, so re-running is a no-op.
#
# Prerequisites:
#   - az login
#   - VPN connected
#   - Your IP whitelisted on the target Postgres Flexible Server
#
# Usage:
#   ./azure_deploy/grant-admin.sh <prod|dev> <external_uid>
#
# Example:
#   ./azure_deploy/grant-admin.sh prod QcOm0wis3aPEeiBXCeawuGpSvq92
#

set -e

ENV="${1:?Usage: $0 <prod|dev> <external_uid>}"
EXTERNAL_UID="${2:?Usage: $0 <prod|dev> <external_uid>}"

if [[ "$ENV" != "prod" && "$ENV" != "dev" ]]; then
    echo "Error: first argument must be 'prod' or 'dev'" >&2
    exit 1
fi

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

# Load env config
[ -f "$SCRIPT_DIR/.env.deploy.$ENV" ] && set -a && source "$SCRIPT_DIR/.env.deploy.$ENV" && set +a
PG_RG="$RESOURCE_GROUP"

if [ -z "$PG_RG" ]; then
    echo -e "${RED}Error: RESOURCE_GROUP not set. Check .env.deploy.$ENV${NC}"
    exit 1
fi

echo -e "${YELLOW}Looking up $ENV Postgres server...${NC}"
PG_SERVER=$(az postgres flexible-server list \
    --resource-group "$PG_RG" \
    --query "[0].name" -o tsv 2>/dev/null || true)

if [ -z "$PG_SERVER" ]; then
    echo -e "${RED}Error: No Postgres Flexible Server found in $PG_RG${NC}"
    exit 1
fi

PG_HOST="${PG_SERVER}.postgres.database.azure.com"

KV_NAME=$(az keyvault list -g "$PG_RG" --query "[0].name" -o tsv 2>/dev/null || true)
[ -z "$KV_NAME" ] && echo -e "${RED}Error: No Key Vault found in $PG_RG${NC}" && exit 1

# Dev secrets are prefixed differently in sync-prod-data-to-dev.sh
if [ "$ENV" = "dev" ]; then
    PG_PASS=$(az keyvault secret show --vault-name "$KV_NAME" --name "stacnotator-dev-postgres-admin-password" --query "value" -o tsv 2>/dev/null || true)
    PG_HOST_KV=$(az keyvault secret show --vault-name "$KV_NAME" --name "stacnotator-dev-postgres-host" --query "value" -o tsv 2>/dev/null || true)
    CONN_STR=$(az keyvault secret show --vault-name "$KV_NAME" --name "stacnotator-dev-db-connection-string" --query "value" -o tsv 2>/dev/null || true)
else
    PG_PASS=$(az keyvault secret show --vault-name "$KV_NAME" --name "stacnotator-prod-postgres-admin-password" --query "value" -o tsv 2>/dev/null || true)
    PG_HOST_KV=$(az keyvault secret show --vault-name "$KV_NAME" --name "stacnotator-prod-postgres-host" --query "value" -o tsv 2>/dev/null || true)
    CONN_STR=$(az keyvault secret show --vault-name "$KV_NAME" --name "stacnotator-prod-db-connection-string" --query "value" -o tsv 2>/dev/null || true)
fi

if [ -n "$CONN_STR" ]; then
    PG_USER=$(echo "$CONN_STR" | sed -n 's|.*://\([^:]*\):.*|\1|p')
    PG_DBNAME=$(echo "$CONN_STR" | sed -n 's|.*/\([^?]*\).*|\1|p')
fi

[ -n "$PG_HOST_KV" ] && PG_HOST="$PG_HOST_KV"

[ -z "$PG_USER" ] && read -p "Enter $ENV DB username: " PG_USER
if [ -z "$PG_PASS" ]; then
    read -sp "Enter $ENV DB password: " PG_PASS
    echo ""
fi
PG_DBNAME=${PG_DBNAME:-stacnotator}

echo -e "${GREEN}✓ Target: ${PG_USER}@${PG_HOST}/${PG_DBNAME}${NC}"
echo ""
echo -e "${BLUE}Granting 'approved' + 'admin' to external_uid=${EXTERNAL_UID}${NC}"
echo ""

PSQL=(psql --host="$PG_HOST" --port=5432 --username="$PG_USER" --dbname="$PG_DBNAME" -v ON_ERROR_STOP=1)

# Show current state
echo -e "${YELLOW}Current state:${NC}"
PGPASSWORD="$PG_PASS" "${PSQL[@]}" <<SQL
SELECT u.id, u.email, u.external_uid, array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL) AS roles
FROM auth.users u
LEFT JOIN auth.user_roles r ON r.user_id = u.id
WHERE u.external_uid = '${EXTERNAL_UID}'
GROUP BY u.id, u.email, u.external_uid;
SQL

echo ""
if [ "$ENV" = "prod" ]; then
    echo -e "${RED}⚠  This will modify the PROD database.${NC}"
    read -p "Proceed? (y/N) " CONFIRM
    [[ ! "$CONFIRM" =~ ^[Yy]$ ]] && echo "Cancelled." && exit 0
fi

echo ""
echo -e "${YELLOW}Applying role grants in a transaction...${NC}"

PGPASSWORD="$PG_PASS" "${PSQL[@]}" <<SQL
BEGIN;

-- Guard: exactly one user must match
DO \$\$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM auth.users WHERE external_uid = '${EXTERNAL_UID}';
    IF n <> 1 THEN
        RAISE EXCEPTION 'Expected exactly 1 user with external_uid=${EXTERNAL_UID}, found %', n;
    END IF;
END \$\$;

INSERT INTO auth.user_roles (user_id, role)
SELECT id, 'approved' FROM auth.users WHERE external_uid = '${EXTERNAL_UID}'
ON CONFLICT DO NOTHING
RETURNING user_id, role;

INSERT INTO auth.user_roles (user_id, role)
SELECT id, 'admin' FROM auth.users WHERE external_uid = '${EXTERNAL_UID}'
ON CONFLICT DO NOTHING
RETURNING user_id, role;

-- Post-check: both roles present
DO \$\$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n
    FROM auth.user_roles r
    JOIN auth.users u ON u.id = r.user_id
    WHERE u.external_uid = '${EXTERNAL_UID}' AND r.role IN ('approved','admin');
    IF n <> 2 THEN
        RAISE EXCEPTION 'Post-check failed: expected 2 roles (approved,admin), found %', n;
    END IF;
END \$\$;

COMMIT;
SQL

echo ""
echo -e "${YELLOW}Final state:${NC}"
PGPASSWORD="$PG_PASS" "${PSQL[@]}" <<SQL
SELECT u.email, u.external_uid, array_agg(r.role ORDER BY r.role) AS roles
FROM auth.users u
LEFT JOIN auth.user_roles r ON r.user_id = u.id
WHERE u.external_uid = '${EXTERNAL_UID}'
GROUP BY u.email, u.external_uid;
SQL

echo ""
echo -e "${GREEN}✓ Done${NC}"

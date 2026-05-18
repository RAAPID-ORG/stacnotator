#!/bin/bash
#
# Restore a local SQL backup into the dev database
#
# Wipes the dev database, restores the dump, runs alembic migrations,
# and restarts the backend. Same flow as the staging script but runs
# against the dev containers with a local backup file.
#
# Usage:
#   ./scripts/dev-restore-backup.sh <path-to-sql-dump>
#   make dev-restore-backup FILE=db/backups/prod_20260318_150442.sql
#
# The dev stack (make dev-up) must be running.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE="docker compose -f $PROJECT_ROOT/docker-compose.dev.yml"

# Load .env so we pick up the same credentials as docker-compose
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

# Validate input
DUMP_FILE="${1:?Usage: $0 <path-to-sql-dump>}"

if [ ! -f "$DUMP_FILE" ]; then
    echo -e "${RED}Error: File not found: ${DUMP_FILE}${NC}"
    exit 1
fi

DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)

# Read DB credentials (same defaults as docker-compose.dev.yml)
DB_USER="${POSTGRES_USER:-stacnotator}"
DB_NAME="${POSTGRES_DB:-stacnotator}"

echo ""
echo -e "${GREEN}Dev Database Restore${NC}"
echo -e "  Dump file: ${YELLOW}${DUMP_FILE}${NC} (${DUMP_SIZE})"
echo -e "  Target:    ${YELLOW}dev db container / ${DB_NAME}${NC}"
echo ""
read -p "This will WIPE the dev database and replace it with the backup. Continue? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# Ensure the DB container is running
echo ""
echo -e "${YELLOW}Ensuring dev stack is running...${NC}"
if ! $COMPOSE ps db --format '{{.State}}' 2>/dev/null | grep -q running; then
    echo -e "${BLUE}Starting dev stack...${NC}"
    $COMPOSE up -d db
    echo -e "${YELLOW}Waiting for database to be ready...${NC}"
    for i in $(seq 1 30); do
        if $COMPOSE exec -T db pg_isready -U "$DB_USER" -d "$DB_NAME" &>/dev/null; then
            break
        fi
        if [ "$i" -eq 30 ]; then
            echo -e "${RED}Error: Database did not become ready in time${NC}"
            exit 1
        fi
        sleep 1
    done
fi
echo -e "${GREEN}✓ Database container is running${NC}"

# Drop and recreate the database
echo ""
echo -e "${YELLOW}Dropping and recreating database...${NC}"

$COMPOSE exec -T db psql -U "$DB_USER" -d postgres -c "
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();
" >/dev/null 2>&1 || true

$COMPOSE exec -T db psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\";" >/dev/null
$COMPOSE exec -T db psql -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";" >/dev/null
echo -e "${GREEN}✓ Database recreated${NC}"

# Restore the dump
echo ""
echo -e "${YELLOW}Restoring backup into dev database...${NC}"

cat "$DUMP_FILE" | $COMPOSE exec -T db psql -U "$DB_USER" -d "$DB_NAME" \
    --set ON_ERROR_STOP=off \
    2>&1 | grep -iE "error|fatal" | grep -v "already exists" | head -10 || true

echo -e "${GREEN}✓ Restore complete${NC}"

# Show alembic version before migration
echo ""
echo -e "${YELLOW}Alembic version in backup:${NC}"
$COMPOSE exec -T db psql -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT version_num FROM public.alembic_version;" 2>/dev/null || \
    echo -e "${YELLOW}  (no alembic_version table)${NC}"

# Run migrations
echo ""
echo -e "${YELLOW}Running alembic upgrade head...${NC}"

# Make sure backend is up for alembic
if ! $COMPOSE ps backend --format '{{.State}}' 2>/dev/null | grep -q running; then
    $COMPOSE up -d backend
    sleep 5
fi

if $COMPOSE exec -T backend alembic upgrade head; then
    echo -e "${GREEN}✓ Migrations applied successfully${NC}"
else
    echo -e "${RED}✗ Migration FAILED - see output above${NC}"
    echo -e "${YELLOW}  The dev stack is still running so you can debug.${NC}"
    exit 1
fi

# Show alembic version after migration
echo ""
echo -e "${YELLOW}Alembic version after migration:${NC}"
$COMPOSE exec -T db psql -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT version_num FROM public.alembic_version;" 2>/dev/null || true

# Restart backend to pick up fresh DB state
echo ""
echo -e "${YELLOW}Restarting backend...${NC}"
$COMPOSE restart backend
echo -e "${GREEN}✓ Backend restarted${NC}"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Dev database restored from backup!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "  ${BLUE}Frontend:${NC}  http://localhost:5173"
echo -e "  ${BLUE}Backend:${NC}   http://localhost:8000"
echo -e "  ${BLUE}API Docs:${NC}  http://localhost:8000/api/docs"
echo ""

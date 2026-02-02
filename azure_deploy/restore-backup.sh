#!/bin/bash
#
# Database Backup Restore Script
#
# Usage: ./restore-backup.sh <backup-file>
# Example: ./restore-backup.sh backups/stacnotator-backup-20260202-143022-pre-a1b2c3d.sql.gz
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}=== Stacnotator Database Restore ===${NC}"
echo ""

# Check if backup file is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: No backup file specified${NC}"
    echo ""
    echo "Usage: $0 <backup-file>"
    echo ""
    echo "Available backups:"
    ls -lh backups/stacnotator-backup-*.sql.gz 2>/dev/null || echo "  No backups found"
    exit 1
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}Error: Backup file not found: $BACKUP_FILE${NC}"
    exit 1
fi

echo -e "${BLUE}Backup file:${NC} $BACKUP_FILE"
echo -e "${BLUE}File size:${NC}   $(du -h "$BACKUP_FILE" | cut -f1)"
echo ""

# Check Azure login
if ! az account show &>/dev/null; then
    echo -e "${RED}Error: Not logged in to Azure. Run 'az login' first.${NC}"
    exit 1
fi

# Prompt for resource group
if [ -z "$RESOURCE_GROUP" ]; then
    read -p "Enter Azure Resource Group name [rg-stacnotator-prod-westeurope]: " RESOURCE_GROUP
    RESOURCE_GROUP=${RESOURCE_GROUP:-rg-stacnotator-prod-westeurope}
fi

echo -e "${YELLOW}Fetching database credentials from Key Vault...${NC}"

# Get Key Vault name
KV_NAME=$(az keyvault list -g "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)
if [ -z "$KV_NAME" ]; then
    echo -e "${RED}Error: No Key Vault found in resource group $RESOURCE_GROUP${NC}"
    exit 1
fi

# Get database credentials
DB_HOST=$(az keyvault secret show --vault-name "$KV_NAME" --name "db-host" --query "value" -o tsv 2>/dev/null || echo "")
DB_NAME=$(az keyvault secret show --vault-name "$KV_NAME" --name "db-name" --query "value" -o tsv 2>/dev/null || echo "")
DB_USER=$(az keyvault secret show --vault-name "$KV_NAME" --name "db-user" --query "value" -o tsv 2>/dev/null || echo "")
DB_PASSWORD=$(az keyvault secret show --vault-name "$KV_NAME" --name "db-password" --query "value" -o tsv 2>/dev/null || echo "")

if [ -z "$DB_HOST" ] || [ -z "$DB_NAME" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ]; then
    echo -e "${RED}Error: Could not retrieve database credentials from Key Vault${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Database credentials retrieved${NC}"
echo -e "${BLUE}  Database: $DB_NAME on $DB_HOST${NC}"
echo ""

# Warning
echo -e "${RED}========================================${NC}"
echo -e "${RED}           WARNING!${NC}"
echo -e "${RED}========================================${NC}"
echo -e "${YELLOW}This will DROP all existing tables and restore from backup.${NC}"
echo -e "${YELLOW}All current data will be LOST!${NC}"
echo -e "${RED}========================================${NC}"
echo ""

# Confirmation
read -p "Are you absolutely sure you want to continue? (type 'yes' to confirm): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo -e "${YELLOW}Restore cancelled.${NC}"
    exit 0
fi
echo ""

# Perform restore
echo -e "${YELLOW}Restoring database from backup...${NC}"
echo -e "${BLUE}This may take a few minutes...${NC}"
echo ""

# Suppress password-related output for security
if gunzip -c "$BACKUP_FILE" | \
    docker run -i --rm \
        -e PGPASSWORD="$DB_PASSWORD" \
        postgres:15-alpine \
        psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
        --quiet \
        2>&1 | grep -v "password\|PGPASSWORD" | grep -v "^DROP\|^CREATE\|^ALTER\|^COMMENT" > /dev/null; then
    
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}   Database Restored Successfully!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "${YELLOW}Note: You may need to restart the backend container app:${NC}"
    echo -e "  az containerapp restart -n backend -g $RESOURCE_GROUP"
    echo ""
else
    echo ""
    echo -e "${RED}Error: Database restore failed${NC}"
    echo -e "${YELLOW}Check the output above for details${NC}"
    exit 1
fi

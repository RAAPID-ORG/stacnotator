#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}View Container App Logs${NC}"
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

# Prompt for app name
if [ -z "$1" ]; then
    read -p "Enter app name (backend/frontend) [backend]: " APP_NAME
    APP_NAME=${APP_NAME:-backend}
else
    APP_NAME="$1"
fi

echo ""
echo -e "${YELLOW}Resource Group: $RESOURCE_GROUP${NC}"
echo -e "${YELLOW}App Name: $APP_NAME${NC}"
echo ""

# Check if app exists
if ! az containerapp show --name "$APP_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
    echo -e "${RED}Error: Container app '$APP_NAME' not found${NC}"
    exit 1
fi

# Stream logs
echo -e "${GREEN}Streaming logs (Ctrl+C to exit)...${NC}"
echo ""
az containerapp logs show \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --follow

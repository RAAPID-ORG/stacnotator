#!/bin/bash
set -e

# Arguments: <prod|dev> [backend|tiler]
ENV="${1:?Usage: $0 <prod|dev> [backend|tiler]}"
if [[ "$ENV" != "prod" && "$ENV" != "dev" ]]; then
    echo "Error: first argument must be 'prod' or 'dev'" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/.env.deploy.$ENV" ] && set -a && source "$SCRIPT_DIR/.env.deploy.$ENV" && set +a

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if ! az account show &>/dev/null; then
    echo -e "${RED}Error: Not logged in to Azure. Run 'az login' first.${NC}"
    exit 1
fi

if [ -z "$RESOURCE_GROUP" ]; then
    echo -e "${RED}Error: RESOURCE_GROUP not set. Check .env.deploy.$ENV${NC}"
    exit 1
fi

APP_NAME="stacnotator-${ENV}-${2:-backend}"

echo -e "${GREEN}View Container App Logs (${ENV})${NC}"
echo ""

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

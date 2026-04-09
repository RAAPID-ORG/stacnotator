#!/bin/bash
#
# Upload Secrets to Key Vault
#
# This script uploads both backend secrets (Firebase admin, Earth Engine)
# and frontend configuration (Firebase client config) to Key Vault.
#
# Prerequisites:
# - Infrastructure deployed via Terraform
# - Firebase admin service account JSON file
# - Earth Engine service account JSON file
# - Firebase client configuration (API key, auth domain, project ID)
#

set -e

# Environment argument
ENV="${1:?Usage: $0 <prod|dev>}"
if [[ "$ENV" != "prod" && "$ENV" != "dev" ]]; then
    echo "Error: argument must be 'prod' or 'dev'" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/.env.deploy.$ENV" ] && set -a && source "$SCRIPT_DIR/.env.deploy.$ENV" && set +a

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

if ! az account show &>/dev/null; then
    echo -e "${RED}Error: Not logged in to Azure. Run 'az login' first.${NC}"
    exit 1
fi

if [ -z "$RESOURCE_GROUP" ]; then
    echo -e "${RED}Error: RESOURCE_GROUP not set. Check .env.deploy.$ENV${NC}"
    exit 1
fi

echo -e "${GREEN}Upload Secrets to Key Vault (${ENV})${NC}"
echo -e "${BLUE}This uploads both backend secrets and frontend Firebase config${NC}"
echo ""

echo -e "${YELLOW}Resource Group: $RESOURCE_GROUP${NC}"
echo ""

# Get Key Vault name
KV_NAME=$(az keyvault list -g "$RESOURCE_GROUP" --query "[0].name" -o tsv)

if [ -z "$KV_NAME" ]; then
    echo -e "${RED}Error: No Key Vault found in resource group $RESOURCE_GROUP${NC}"
    echo -e "${YELLOW}Deploy infrastructure first: cd raapid-infra/main && ./deploy.sh${NC}"
    exit 1
fi

echo -e "${GREEN}Using Key Vault: $KV_NAME${NC}"
echo ""

# Check required variables (set in .env.deploy.<env>)
if [ -z "$FIREBASE_CREDS" ]; then
    echo -e "${RED}Error: FIREBASE_CREDS not set. Add it to .env.deploy.$ENV${NC}"
    exit 1
fi

if [ -z "$EE_CREDS" ]; then
    echo -e "${RED}Error: EE_CREDS not set. Add it to .env.deploy.$ENV${NC}"
    exit 1
fi

# Upload Firebase credentials
if [ ! -f "$FIREBASE_CREDS" ]; then
    echo -e "${RED}Error: Firebase credentials file not found: $FIREBASE_CREDS${NC}"
    exit 1
fi

echo -e "${YELLOW}Uploading Firebase credentials from: $FIREBASE_CREDS${NC}"
az keyvault secret set \
    --vault-name "$KV_NAME" \
    --name firebase-credentials \
    --file "$FIREBASE_CREDS" \
    --output none
echo -e "${GREEN}✓ Firebase credentials uploaded${NC}"

# Upload Earth Engine credentials
if [ ! -f "$EE_CREDS" ]; then
    echo -e "${RED}Error: Earth Engine credentials file not found: $EE_CREDS${NC}"
    exit 1
fi

echo -e "${YELLOW}Uploading Earth Engine credentials from: $EE_CREDS${NC}"
az keyvault secret set \
    --vault-name "$KV_NAME" \
    --name ee-private-key \
    --file "$EE_CREDS" \
    --output none
echo -e "${GREEN}✓ Earth Engine credentials uploaded${NC}"
echo ""

# Tiler token secret (shared between backend and tiler for HMAC auth)
echo -e "${YELLOW}Generating tiler token secret...${NC}"
EXISTING_TILER_SECRET=$(az keyvault secret show --vault-name "$KV_NAME" --name "tiler-token-secret" --query "value" -o tsv 2>/dev/null || echo "")
if [ -z "$EXISTING_TILER_SECRET" ]; then
    TILER_SECRET=$(openssl rand -hex 32)
    az keyvault secret set \
        --vault-name "$KV_NAME" \
        --name "tiler-token-secret" \
        --value "$TILER_SECRET" \
        --output none
    echo -e "${GREEN}✓ Tiler token secret generated and uploaded${NC}"
else
    echo -e "${GREEN}✓ Tiler token secret already exists${NC}"
fi
echo ""

# Firebase Client Configuration (for frontend) (not actual secrets just env vars)

# Firebase Client Configuration (set in .env.deploy.<env>)
if [ -z "$FIREBASE_API_KEY" ] || [ -z "$FIREBASE_AUTH_DOMAIN" ] || [ -z "$FIREBASE_PROJECT_ID" ]; then
    echo -e "${YELLOW}Skipping Firebase client config (FIREBASE_API_KEY/AUTH_DOMAIN/PROJECT_ID not set in .env.deploy.$ENV)${NC}"
    echo ""
else
    # Upload Firebase client configuration
    echo -e "${YELLOW}Uploading Firebase client configuration...${NC}"

    az keyvault secret set \
        --vault-name "$KV_NAME" \
        --name "firebase-api-key" \
        --value "$FIREBASE_API_KEY" \
        --output none
    echo -e "${GREEN}✓ Firebase API Key uploaded${NC}"

    az keyvault secret set \
        --vault-name "$KV_NAME" \
        --name "firebase-auth-domain" \
        --value "$FIREBASE_AUTH_DOMAIN" \
        --output none
    echo -e "${GREEN}✓ Firebase Auth Domain uploaded${NC}"

    az keyvault secret set \
        --vault-name "$KV_NAME" \
        --name "firebase-project-id" \
        --value "$FIREBASE_PROJECT_ID" \
        --output none
    echo -e "${GREEN}✓ Firebase Project ID uploaded${NC}"
    echo ""
fi

# Summary

echo -e "${GREEN}Secrets Upload Complete!${NC}"
echo ""
echo -e "${BLUE}Uploaded secrets:${NC}"
echo -e "  • Firebase admin credentials (backend)"
echo -e "  • Earth Engine service account (backend)"
if [ -n "$FIREBASE_API_KEY" ]; then
    echo -e "  • Firebase client config (frontend)"
    echo -e "    Project: $FIREBASE_PROJECT_ID"
fi
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo -e "  Deploy your application: ./azure_deploy/deploy-app.sh $ENV"
echo ""

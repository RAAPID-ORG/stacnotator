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

# Auto-load config from .env.deploy if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/.env.deploy" ] && set -a && source "$SCRIPT_DIR/.env.deploy" && set +a

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}Upload Secrets to Key Vault${NC}"
echo -e "${BLUE}This uploads both backend secrets and frontend Firebase config${NC}"
echo ""

# Check Azure login
if ! az account show &>/dev/null; then
    echo -e "${RED}Error: Not logged in to Azure. Run 'az login' first.${NC}"
    exit 1
fi

# Prompt for resource group
if [ -z "$RESOURCE_GROUP" ]; then
    read -p "Enter Azure Resource Group name: " RESOURCE_GROUP
    if [ -z "$RESOURCE_GROUP" ]; then
        echo -e "${RED}Error: RESOURCE_GROUP is required. Set it via env var or enter it when prompted.${NC}"
        exit 1
    fi
fi

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

# Check required environment variables
if [ -z "$FIREBASE_CREDS" ]; then
    echo -e "${RED}Error: FIREBASE_CREDS environment variable not set${NC}"
    echo -e "${YELLOW}Set it to the path of your Firebase admin credentials JSON file${NC}"
    echo -e "  Example: export FIREBASE_CREDS=\"backend/config/firebase-adminsdk.json\"${NC}"
    exit 1
fi

if [ -z "$EE_CREDS" ]; then
    echo -e "${RED}Error: EE_CREDS environment variable not set${NC}"
    echo -e "${YELLOW}Set it to the path of your Earth Engine private key JSON file${NC}"
    echo -e "  Example: export EE_CREDS=\"backend/config/ee-private-key.json\"${NC}"
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

# Firebase Client Configuration (for frontend) (not actual secrets just env vars)

echo -e "${BLUE}Firebase Client Configuration${NC}"
echo ""
echo -e "${YELLOW}Get these values from Firebase Console:${NC}"
echo -e "  https://console.firebase.google.com/"
echo -e "  -> Project Settings -> General -> Your apps -> Web app config"
echo ""

# Prompt for Firebase client configuration
if [ -z "$FIREBASE_API_KEY" ]; then
    read -p "Enter Firebase API Key: " FIREBASE_API_KEY
fi

if [ -z "$FIREBASE_AUTH_DOMAIN" ]; then
    read -p "Enter Firebase Auth Domain (e.g., myapp.firebaseapp.com): " FIREBASE_AUTH_DOMAIN
fi

if [ -z "$FIREBASE_PROJECT_ID" ]; then
    read -p "Enter Firebase Project ID: " FIREBASE_PROJECT_ID
fi

# Validate Firebase client config
if [ -z "$FIREBASE_API_KEY" ] || [ -z "$FIREBASE_AUTH_DOMAIN" ] || [ -z "$FIREBASE_PROJECT_ID" ]; then
    echo -e "${YELLOW}Warning: Firebase client configuration not provided${NC}"
    echo -e "${YELLOW}You can upload it later by setting environment variables and re-running this script${NC}"
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
echo -e "  Configure container app secrets: ./azure_deploy/configure-app-secrets.sh"
echo -e "  Deploy your application: ./azure_deploy/deploy-app.sh"
echo ""
if [ -n "$FIREBASE_PROJECT_ID" ]; then
    echo -e "${YELLOW}Important: Configure authorized domains in Firebase Console${NC}"
    echo -e "  https://console.firebase.google.com/ -> Authentication -> Settings -> Authorized domains"
    echo -e "  Add your Container App domain after deployment"
    echo ""
fi

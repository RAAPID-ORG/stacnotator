#!/bin/bash
#
# Configure Application Secrets in Container Apps
#
# This script should be run ONCE after upload-secrets.sh to add application-specific
# secret references to the container apps. Run this BEFORE the first deploy-app.sh.
#
# Prerequisites:
# - Infrastructure deployed via Terraform
# - Secrets uploaded via upload-secrets.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}=== Configure Application Secrets ===${NC}"
echo -e "${BLUE}This adds Earth Engine and Firebase secret references to the backend container app${NC}"
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

echo -e "${YELLOW}Resource Group: $RESOURCE_GROUP${NC}"
echo ""

# Get Key Vault name
echo -e "${YELLOW}Checking Key Vault...${NC}"
KV_NAME=$(az keyvault list -g "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)

if [ -z "$KV_NAME" ]; then
    echo -e "${RED}Error: No Key Vault found in resource group $RESOURCE_GROUP${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Key Vault found: $KV_NAME${NC}"

# Check if EE secret exists
if ! az keyvault secret show --vault-name "$KV_NAME" --name "ee-private-key" &>/dev/null; then
    echo -e "${RED}Error: ee-private-key secret not found in Key Vault${NC}"
    echo -e "${YELLOW}Please run ./azure_deploy/upload-secrets.sh first${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Earth Engine secret found${NC}"

# Check if Firebase secret exists
if ! az keyvault secret show --vault-name "$KV_NAME" --name "firebase-credentials" &>/dev/null; then
    echo -e "${RED}Error: firebase-credentials secret not found in Key Vault${NC}"
    echo -e "${YELLOW}Please run ./azure_deploy/upload-secrets.sh first${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Firebase credentials secret found${NC}"

# Extract EE service account email from the secret
echo -e "${YELLOW}Extracting Earth Engine service account email...${NC}"
EE_SERVICE_ACCOUNT=$(az keyvault secret show --vault-name "$KV_NAME" --name "ee-private-key" --query "value" -o tsv | jq -r '.client_email')
if [ -z "$EE_SERVICE_ACCOUNT" ] || [ "$EE_SERVICE_ACCOUNT" = "null" ]; then
    echo -e "${RED}Error: Could not extract service account email from ee-private-key${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Service account: $EE_SERVICE_ACCOUNT${NC}"
echo ""

# Get backend container app managed identity
echo -e "${YELLOW}Getting backend managed identity...${NC}"
BACKEND_IDENTITY_ID=$(az containerapp show \
    --name backend \
    --resource-group "$RESOURCE_GROUP" \
    --query "identity.userAssignedIdentities" -o json | \
    jq -r 'keys[0]')

if [ -z "$BACKEND_IDENTITY_ID" ] || [ "$BACKEND_IDENTITY_ID" = "null" ]; then
    echo -e "${RED}Error: Could not find backend managed identity${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Backend identity: ${BACKEND_IDENTITY_ID}${NC}"
echo ""

# Show what will be configured
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Configuration Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "${YELLOW}Resource Group:${NC} $RESOURCE_GROUP"
echo -e "${YELLOW}Key Vault:     ${NC} $KV_NAME"
echo -e "${YELLOW}Backend App:   ${NC} backend"
echo ""
echo -e "${BLUE}Secrets to be configured:${NC}"
echo -e "  • ee-private-key (from Key Vault)"
echo -e "  • firebase-credentials (from Key Vault)"
echo ""
echo -e "${BLUE}Environment variables to be set:${NC}"
echo -e "  • EE_PRIVATE_KEY (secret reference)"
echo -e "  • EE_SERVICE_ACCOUNT=$EE_SERVICE_ACCOUNT"
echo -e "  • FIREBASE_CREDENTIALS (secret reference)"
echo -e "${BLUE}========================================${NC}"
echo ""

# Confirmation prompt (skip if CI environment variable is set)
if [ "$CI" != "true" ]; then
    read -p "Proceed with configuration? (y/N): " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Configuration cancelled.${NC}"
        exit 0
    fi
    echo ""
fi

# Add secrets to backend
echo -e "${YELLOW}Adding secrets to backend container app...${NC}"

# Get the Key Vault URI
KV_URI=$(az keyvault show --name "$KV_NAME" --resource-group "$RESOURCE_GROUP" --query "properties.vaultUri" -o tsv)
if [ -z "$KV_URI" ]; then
    echo -e "${RED}Error: Could not get Key Vault URI${NC}"
    exit 1
fi

# Construct the full secret URLs
EE_SECRET_URL="${KV_URI}secrets/ee-private-key"
FIREBASE_SECRET_URL="${KV_URI}secrets/firebase-credentials"

echo -e "${BLUE}EE Secret URL: ${EE_SECRET_URL}${NC}"
echo -e "${BLUE}Firebase Secret URL: ${FIREBASE_SECRET_URL}${NC}"

# Add the secret references
az containerapp secret set \
    --name backend \
    --resource-group "$RESOURCE_GROUP" \
    --secrets \
        "ee-private-key=keyvaultref:${EE_SECRET_URL},identityref:${BACKEND_IDENTITY_ID}" \
        "firebase-credentials=keyvaultref:${FIREBASE_SECRET_URL},identityref:${BACKEND_IDENTITY_ID}" \
    --output none

echo -e "${GREEN}✓ Secrets added${NC}"

# Add the environment variables that reference the secrets
echo -e "${YELLOW}Setting environment variables...${NC}"
az containerapp update \
    --name backend \
    --resource-group "$RESOURCE_GROUP" \
    --set-env-vars \
        "EE_PRIVATE_KEY=secretref:ee-private-key" \
        "EE_SERVICE_ACCOUNT=$EE_SERVICE_ACCOUNT" \
        "FIREBASE_CREDENTIALS=secretref:firebase-credentials" \
    --output none

echo -e "${GREEN}✓ Environment variables configured${NC}"
echo ""

echo -e "${GREEN}=== Configuration Complete! ===${NC}"
echo ""
echo -e "${BLUE}Configured credentials:${NC}"
echo -e "  • Earth Engine (service account: $EE_SERVICE_ACCOUNT)"
echo -e "  • Firebase authentication"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo -e "1. Deploy your application: ./azure_deploy/deploy-app.sh"
echo -e "2. The backend will now have access to all required credentials"
echo ""

#!/bin/bash
#
# Stacnotator Deployment Script (Terraform-based Infrastructure)
#
# This script is for APPLICATION DEVELOPERS to deploy container images
# after the infrastructure has been created by Platform Engineers via Terraform.
#
# Prerequisites:
# - Infrastructure must be deployed via raapid-infra/main/deploy.sh
# - User must have Contributor access to container apps
# - User must have AcrPush access to the project ACR
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}Stacnotator Application Deployment${NC}"
echo -e "${BLUE}Infrastructure: Managed by Terraform${NC}"
echo -e "${BLUE}Application: Managed by this script${NC}"
echo ""

# Check Azure login
if ! az account show &>/dev/null; then
    echo -e "${RED}Error: Not logged in to Azure. Run 'az login' first.${NC}"
    exit 1
fi

# Prompt for resource group (should already exist from Terraform)
if [ -z "$RESOURCE_GROUP" ]; then
    read -p "Enter Azure Resource Group name: " RESOURCE_GROUP
    if [ -z "$RESOURCE_GROUP" ]; then
        echo -e "${RED}Error: RESOURCE_GROUP is required. Set it via env var or enter it when prompted.${NC}"
        exit 1
    fi
fi

# Auto-generate image tag from git commit SHA if not provided
if [ -z "$IMAGE_TAG" ]; then
    if git rev-parse --git-dir > /dev/null 2>&1; then
        # Check for uncommitted changes (only if not in CI)
        if [ "$CI" != "true" ]; then
            if ! git diff-index --quiet HEAD -- 2>/dev/null; then
                echo -e "${RED}Error: You have uncommitted changes${NC}"
                echo -e "${YELLOW}Please commit your changes before deploying:${NC}"
                echo ""
                git status --short
                echo ""
                echo -e "${YELLOW}To deploy anyway, set IMAGE_TAG manually:${NC}"
                echo -e "  export IMAGE_TAG=\"experimental-$(date +%Y%m%d-%H%M%S)\""
                echo -e "  ./azure_deploy/deploy-app.sh"
                exit 1
            fi
        fi

        # Get short commit SHA
        GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "")
        if [ -n "$GIT_SHA" ]; then
            IMAGE_TAG="$GIT_SHA"
        else
            # Use timestamp if not in a git repo to ensure unique tags
            IMAGE_TAG="v$(date +%Y%m%d-%H%M%S)"
        fi
    else
        # Use timestamp if not in a git repo to ensure unique tags
        IMAGE_TAG="v$(date +%Y%m%d-%H%M%S)"
    fi

    echo -e "${BLUE}Auto-generated image tag:${NC} $IMAGE_TAG"
    echo -e "${YELLOW}Tip: Set IMAGE_TAG environment variable to override${NC}"
fi

# Verify infrastructure exists
echo -e "${YELLOW}Verifying infrastructure...${NC}"

# Check for ACR
ACR_NAME=$(az acr list -g "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)
if [ -z "$ACR_NAME" ]; then
    echo -e "${RED}Error: No ACR found in resource group $RESOURCE_GROUP${NC}"
    echo -e "${YELLOW}Infrastructure must be deployed first by Platform Engineers:${NC}"
    echo -e "${YELLOW}  cd raapid-infra/main && ./deploy.sh${NC}"
    exit 1
fi
echo -e "${GREEN}✓ ACR found: $ACR_NAME${NC}"

# Check for Container Apps Environment
CAE_NAME=$(az containerapp env list -g "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)
if [ -z "$CAE_NAME" ]; then
    echo -e "${RED}Error: No Container Apps Environment found${NC}"
    echo -e "${YELLOW}Infrastructure must be deployed first by Platform Engineers${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Container Apps Environment found: $CAE_NAME${NC}"

# Check for backend container app
if ! az containerapp show --name backend -g "$RESOURCE_GROUP" &>/dev/null; then
    echo -e "${RED}Error: Backend container app not found${NC}"
    echo -e "${YELLOW}Infrastructure must be deployed first by Platform Engineers${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Backend container app found${NC}"

# Check for frontend container app
if ! az containerapp show --name frontend -g "$RESOURCE_GROUP" &>/dev/null; then
    echo -e "${RED}Error: Frontend container app not found${NC}"
    echo -e "${YELLOW}Infrastructure must be deployed first by Platform Engineers${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Frontend container app found${NC}"

echo ""
echo -e "${BLUE}Deployment Configuration${NC}"
echo -e "${YELLOW}Resource Group:${NC} $RESOURCE_GROUP"
echo -e "${YELLOW}Image Tag:     ${NC} $IMAGE_TAG"
echo -e "${YELLOW}ACR:           ${NC} $ACR_NAME"
echo -e "${YELLOW}Environment:   ${NC} $CAE_NAME"
echo ""
echo -e "${BLUE}Images to be built and pushed:${NC}"
echo -e "  • ${ACR_NAME}.azurecr.io/backend:${IMAGE_TAG}"
echo -e "  • ${ACR_NAME}.azurecr.io/frontend:${IMAGE_TAG}"
echo ""
echo -e "${BLUE}Container apps to be updated:${NC}"
echo -e "  • backend  (in $RESOURCE_GROUP)"
echo -e "  • frontend (in $RESOURCE_GROUP)"
echo ""

# Confirmation prompt (skip if CI environment variable is set)
if [ "$CI" != "true" ]; then
    read -p "Proceed with deployment? (y/N): " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Deployment cancelled.${NC}"
        exit 0
    fi
    echo ""
fi

echo ""

KV_NAME=$(az keyvault list -g "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)

# Build and push backend
echo -e "${YELLOW}Logging in to ACR...${NC}"
az acr login --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP"
ACR_LOGIN_SERVER="$ACR_NAME.azurecr.io"
echo -e "${GREEN}✓ Logged in to ACR${NC}"
echo ""

# Build and push backend
echo -e "${YELLOW}Building backend image...${NC}"
cd backend
docker build -t "$ACR_LOGIN_SERVER/backend:$IMAGE_TAG" -f Dockerfile .

echo -e "${YELLOW}Pushing backend image...${NC}"
docker push "$ACR_LOGIN_SERVER/backend:$IMAGE_TAG"
echo -e "${GREEN}✓ Backend image pushed${NC}"
cd ..
echo ""

# Build and push frontend
echo -e "${YELLOW}Building frontend image...${NC}"
cd frontend

# Get backend URL for build args
BACKEND_URL=$(az containerapp show \
    --name backend \
    --resource-group "$RESOURCE_GROUP" \
    --query properties.configuration.ingress.fqdn -o tsv 2>/dev/null || echo "")

if [ -z "$BACKEND_URL" ]; then
    BACKEND_URL="backend.placeholder.azurecontainerapps.io"
    echo -e "${YELLOW}Warning: Could not get backend URL, using placeholder${NC}"
fi

# Get Firebase configuration from Key Vault
echo -e "${YELLOW}Fetching Firebase configuration from Key Vault...${NC}"

# Try to get Firebase config from Key Vault secrets
VITE_FIREBASE_API_KEY=$(az keyvault secret show --vault-name "$KV_NAME" --name "firebase-api-key" --query "value" -o tsv 2>&1)
VITE_FIREBASE_AUTH_DOMAIN=$(az keyvault secret show --vault-name "$KV_NAME" --name "firebase-auth-domain" --query "value" -o tsv 2>&1)
VITE_FIREBASE_PROJECT_ID=$(az keyvault secret show --vault-name "$KV_NAME" --name "firebase-project-id" --query "value" -o tsv 2>&1)

# Check if any command failed (output contains "ERROR" or is empty)
if [[ "$VITE_FIREBASE_API_KEY" == *"ERROR"* ]] || [[ "$VITE_FIREBASE_AUTH_DOMAIN" == *"ERROR"* ]] || [[ "$VITE_FIREBASE_PROJECT_ID" == *"ERROR"* ]] || \
   [ -z "$VITE_FIREBASE_API_KEY" ] || [ -z "$VITE_FIREBASE_AUTH_DOMAIN" ] || [ -z "$VITE_FIREBASE_PROJECT_ID" ]; then
    echo -e "${RED}Error: Could not retrieve Firebase configuration from Key Vault${NC}"
    echo -e "${YELLOW}This is likely due to:${NC}"
    echo -e "${YELLOW}  1. Key Vault firewall blocking your IP${NC}"
    echo -e "${YELLOW}  2. Missing Firebase secrets in Key Vault${NC}"
    echo -e "${YELLOW}  3. Insufficient permissions${NC}"
    echo ""
    echo -e "${YELLOW}To fix Key Vault firewall:${NC}"
    echo -e "  az keyvault network-rule add --name $KV_NAME --ip-address \$(curl -s ifconfig.me)/32"
    echo ""
    echo -e "${YELLOW}To upload Firebase secrets:${NC}"
    echo -e "  ./azure_deploy/upload-secrets.sh"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓ Firebase configuration loaded${NC}"
echo -e "${YELLOW}  Project: ${VITE_FIREBASE_PROJECT_ID}${NC}"
echo ""

# Build frontend with backend URL and Firebase config
docker build \
    --build-arg VITE_API_BASE_URL="https://$BACKEND_URL" \
    --build-arg VITE_FIREBASE_API_KEY="$VITE_FIREBASE_API_KEY" \
    --build-arg VITE_FIREBASE_AUTH_DOMAIN="$VITE_FIREBASE_AUTH_DOMAIN" \
    --build-arg VITE_FIREBASE_PROJECT_ID="$VITE_FIREBASE_PROJECT_ID" \
    -t "$ACR_LOGIN_SERVER/frontend:$IMAGE_TAG" \
    -f Dockerfile .

echo -e "${YELLOW}Pushing frontend image...${NC}"
docker push "$ACR_LOGIN_SERVER/frontend:$IMAGE_TAG"
echo -e "${GREEN}✓ Frontend image pushed${NC}"
cd ..
echo ""

# Update backend container app
echo -e "${YELLOW}Updating backend container app...${NC}"
az containerapp update \
    --name backend \
    --resource-group "$RESOURCE_GROUP" \
    --image "$ACR_LOGIN_SERVER/backend:$IMAGE_TAG" \
    --output none
echo -e "${GREEN}✓ Backend updated${NC}"

# Wait for backend to stabilize
echo -e "${YELLOW}Waiting for backend to stabilize...${NC}"
sleep 10

# Initialize database (PostGIS extensions, etc.)
echo -e "${YELLOW}Initializing database (PostGIS extensions)...${NC}"
REPLICA_NAME=$(az containerapp replica list \
    --name backend \
    --resource-group "$RESOURCE_GROUP" \
    --query "[0].name" -o tsv 2>/dev/null || echo "")

if [ -n "$REPLICA_NAME" ]; then
    echo -e "${BLUE}  Running database migrations in replica: $REPLICA_NAME${NC}"
else
    echo -e "${YELLOW}Warning: Could not find active backend replica${NC}"
fi
echo ""

# Run database migrations using container app exec
echo -e "${YELLOW}Running database migrations...${NC}"
if [ -n "$REPLICA_NAME" ]; then
    echo -e "${BLUE}  Executing migrations in replica: $REPLICA_NAME${NC}"
    if az containerapp exec \
        --name backend \
        --resource-group "$RESOURCE_GROUP" \
        --replica "$REPLICA_NAME" \
        --command "alembic upgrade head" 2>&1 | tee /tmp/migration_output.log; then
        echo -e "${GREEN}✓ Migrations completed successfully${NC}"
    else
        echo -e "${YELLOW}Warning: Migration command returned non-zero exit code${NC}"
        echo -e "${YELLOW}This may be normal if migrations are already up to date${NC}"
        echo -e "${YELLOW}Check the output above for details${NC}"
    fi
else
    echo -e "${YELLOW}Warning: Could not find active backend replica${NC}"
    echo -e "${YELLOW}Migrations may need to be run manually:${NC}"
    echo -e "${YELLOW}  az containerapp exec -n backend -g $RESOURCE_GROUP --command 'alembic upgrade head'${NC}"
fi

# Get backend URL
BACKEND_URL=$(az containerapp show \
    --name backend \
    --resource-group "$RESOURCE_GROUP" \
    --query properties.configuration.ingress.fqdn -o tsv)
echo ""

# Update frontend container app
echo -e "${YELLOW}Updating frontend container app...${NC}"
az containerapp update \
    --name frontend \
    --resource-group "$RESOURCE_GROUP" \
    --image "$ACR_LOGIN_SERVER/frontend:$IMAGE_TAG" \
    --set-env-vars "VITE_API_BASE_URL=https://$BACKEND_URL" \
    --output none
echo -e "${GREEN}✓ Frontend updated${NC}"

# Get frontend URL
FRONTEND_URL=$(az containerapp show \
    --name frontend \
    --resource-group "$RESOURCE_GROUP" \
    --query properties.configuration.ingress.fqdn -o tsv)
echo ""

# Update backend CORS
echo -e "${YELLOW}Updating backend CORS...${NC}"
az containerapp update \
    --name backend \
    --resource-group "$RESOURCE_GROUP" \
    --set-env-vars "CORS_ORIGINS=https://$FRONTEND_URL" \
    --output none
echo -e "${GREEN}✓ CORS updated${NC}"
echo ""

# Summary
echo -e "${GREEN}Deployment Complete!${NC}"
echo ""
echo -e "${BLUE}Frontend:${NC} https://$FRONTEND_URL"
echo -e "${BLUE}Backend:${NC}  https://$BACKEND_URL"
echo -e "${BLUE}API Docs:${NC} https://$BACKEND_URL/api/docs"
echo ""
echo -e "${YELLOW}Note: Infrastructure changes (new apps, secrets, etc.) must be${NC}"
echo -e "${YELLOW}done by Platform Engineers via Terraform in raapid-infra/main${NC}"
echo ""

#!/bin/bash
#
# Stacnotator Deployment Script
#
# Self-manages all application resources within the project's resource group:
#   - Backend Container App (FastAPI)
#   - Tiler Container App (TiTiler + GDAL, dedicated D16 workload profile)
#   - Frontend Static Web App (React/Vite)
#   - Managed identities + RBAC for each app
#
# Prerequisites:
#   - Infrastructure (RG, ACR, KV, DB, CAE) already deployed
#   - User must have Contributor on the project resource group
#   - Secrets uploaded via upload-secrets.sh (first time only)
#

set -e

# Auto-load config from .env.deploy if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/.env.deploy" ] && set -a && source "$SCRIPT_DIR/.env.deploy" && set +a

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── App names (consistent across all commands) ──
ENV="${DEPLOY_ENV:-prod}"
APP_BACKEND="stacnotator-${ENV}-backend"
APP_TILER="stacnotator-${ENV}-tiler"
APP_SWA="stacnotator-${ENV}-frontend"

echo -e "${GREEN}━━━ Stacnotator Deployment ━━━${NC}"
echo ""

# ── Prerequisites ──

if ! az account show &>/dev/null; then
    echo -e "${RED}Error: Not logged in to Azure. Run 'az login' first.${NC}"
    exit 1
fi

if [ -z "$RESOURCE_GROUP" ]; then
    read -p "Enter Azure Resource Group name: " RESOURCE_GROUP
    [ -z "$RESOURCE_GROUP" ] && echo -e "${RED}RESOURCE_GROUP required.${NC}" && exit 1
fi

# Auto-generate image tag from git commit SHA
if [ -z "$IMAGE_TAG" ]; then
    if [ "$CI" != "true" ] && ! git diff-index --quiet HEAD -- 2>/dev/null; then
        echo -e "${RED}Error: Uncommitted changes. Commit first or set IMAGE_TAG manually.${NC}"
        git status --short
        exit 1
    fi
    IMAGE_TAG=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d-%H%M%S)
fi

# ── Discover infrastructure (created by Terraform) ──

echo -e "${YELLOW}Discovering infrastructure...${NC}"

ACR_NAME=$(az acr list -g "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)
[ -z "$ACR_NAME" ] && echo -e "${RED}No ACR found. Run Terraform first.${NC}" && exit 1

CAE_NAME=$(az containerapp env list -g "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)
[ -z "$CAE_NAME" ] && echo -e "${RED}No Container Apps Environment found. Run Terraform first.${NC}" && exit 1

KV_NAME=$(az keyvault list -g "$RESOURCE_GROUP" --query "[0].name" -o tsv 2>/dev/null)
[ -z "$KV_NAME" ] && echo -e "${RED}No Key Vault found. Run Terraform first.${NC}" && exit 1

ACR_LOGIN_SERVER="$ACR_NAME.azurecr.io"
ACR_ID=$(az acr show --name "$ACR_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)
KV_ID=$(az keyvault show --name "$KV_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)

echo -e "${GREEN}✓ ACR: $ACR_NAME | CAE: $CAE_NAME | KV: $KV_NAME${NC}"

# ── Deployment plan ──

echo ""
echo -e "${BLUE}Deployment Plan${NC}"
echo -e "  RG:        $RESOURCE_GROUP"
echo -e "  Tag:       $IMAGE_TAG"
echo -e "  Backend:   Container App (1 CPU, 2Gi)"
echo -e "  Tiler:     Container App (16 CPU, 32Gi, D16 dedicated)"
echo -e "  Frontend:  Static Web App"
echo ""

if [ "$CI" != "true" ]; then
    read -p "Proceed? (y/N): " CONFIRM
    [[ ! "$CONFIRM" =~ ^[Yy]$ ]] && echo "Cancelled." && exit 0
fi

# ── Helper: create-or-update managed identity + RBAC ──

ensure_identity() {
    local APP_NAME=$1
    local IDENTITY_NAME="id-${APP_NAME}"

    # Create identity if it doesn't exist
    if ! az identity show --name "$IDENTITY_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
        echo -e "${YELLOW}  Creating managed identity: $IDENTITY_NAME${NC}"
        az identity create --name "$IDENTITY_NAME" -g "$RESOURCE_GROUP" --output none
    fi

    IDENTITY_ID=$(az identity show --name "$IDENTITY_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)
    IDENTITY_PRINCIPAL=$(az identity show --name "$IDENTITY_NAME" -g "$RESOURCE_GROUP" --query principalId -o tsv)
    IDENTITY_CLIENT=$(az identity show --name "$IDENTITY_NAME" -g "$RESOURCE_GROUP" --query clientId -o tsv)

    # Grant ACR pull (idempotent)
    az role assignment create --role "AcrPull" --assignee-object-id "$IDENTITY_PRINCIPAL" \
        --assignee-principal-type ServicePrincipal --scope "$ACR_ID" --output none 2>/dev/null || true

    # Grant KV secrets read (idempotent)
    az role assignment create --role "Key Vault Secrets User" --assignee-object-id "$IDENTITY_PRINCIPAL" \
        --assignee-principal-type ServicePrincipal --scope "$KV_ID" --output none 2>/dev/null || true

    echo -e "${GREEN}  ✓ Identity: $IDENTITY_NAME${NC}"
}

# ── Build + push images ──

echo ""
echo -e "${YELLOW}Logging in to ACR...${NC}"
az acr login --name "$ACR_NAME" -g "$RESOURCE_GROUP"

echo -e "${YELLOW}Building backend...${NC}"
docker build -t "$ACR_LOGIN_SERVER/backend:$IMAGE_TAG" -f backend/Dockerfile backend/
docker push "$ACR_LOGIN_SERVER/backend:$IMAGE_TAG"
echo -e "${GREEN}✓ Backend pushed${NC}"

echo -e "${YELLOW}Building tiler...${NC}"
docker build -t "$ACR_LOGIN_SERVER/tiler:$IMAGE_TAG" -f tiler/Dockerfile tiler/
docker push "$ACR_LOGIN_SERVER/tiler:$IMAGE_TAG"
echo -e "${GREEN}✓ Tiler pushed${NC}"

# ── Deploy backend Container App ──

echo ""
echo -e "${YELLOW}Deploying backend...${NC}"
ensure_identity "$APP_BACKEND"

DB_PASS_URI="https://$KV_NAME.vault.azure.net/secrets/stacnotator-postgres-admin-password"
DB_HOST_URI="https://$KV_NAME.vault.azure.net/secrets/stacnotator-postgres-host"

if az containerapp show --name "$APP_BACKEND" -g "$RESOURCE_GROUP" &>/dev/null; then
    az containerapp update --name "$APP_BACKEND" -g "$RESOURCE_GROUP" \
        --image "$ACR_LOGIN_SERVER/backend:$IMAGE_TAG" \
        --output none
else
    az containerapp create --name "$APP_BACKEND" -g "$RESOURCE_GROUP" \
        --environment "$CAE_NAME" \
        --image "$ACR_LOGIN_SERVER/backend:$IMAGE_TAG" \
        --target-port 8000 --ingress external \
        --cpu 1 --memory 2Gi \
        --min-replicas 1 --max-replicas 3 \
        --scale-rule-name http-concurrency --scale-rule-type http --scale-rule-http-concurrency 50 \
        --user-assigned "$IDENTITY_ID" \
        --registry-server "$ACR_LOGIN_SERVER" --registry-identity "$IDENTITY_ID" \
        --secrets "db-password=keyvaultref:$DB_PASS_URI,identityref:$IDENTITY_ID" \
                  "db-host=keyvaultref:$DB_HOST_URI,identityref:$IDENTITY_ID" \
        --env-vars "DBNAME=stacnotator" "DBUSER=psqladmin" "DBPORT=5432" \
                   "DBDRIVER=psycopg2" "DBSCHEME=postgresql" \
                   "AUTH_PROVIDER=firebase" "CORS_ORIGINS=__PENDING__" \
                   "DBPASS=secretref:db-password" "DBHOST=secretref:db-host" \
                   "WORKERS=4" "TIMEOUT=60" \
        --output none
fi
echo -e "${GREEN}✓ Backend deployed${NC}"

# ── Deploy tiler Container App (dedicated D16 workload profile) ──

echo ""
echo -e "${YELLOW}Deploying tiler...${NC}"
ensure_identity "$APP_TILER"

# Add dedicated workload profile if it doesn't exist
EXISTING_PROFILES=$(az containerapp env workload-profile list -g "$RESOURCE_GROUP" --name "$CAE_NAME" --query "[].name" -o tsv 2>/dev/null || echo "")
if ! echo "$EXISTING_PROFILES" | grep -q "tiler-dedicated"; then
    echo -e "${YELLOW}  Adding D16 workload profile...${NC}"
    az containerapp env workload-profile add \
        --name "$CAE_NAME" -g "$RESOURCE_GROUP" \
        --workload-profile-name "tiler-dedicated" \
        --workload-profile-type D16 \
        --min-nodes 0 --max-nodes 1 \
        --output none
    echo -e "${GREEN}  ✓ Workload profile added${NC}"
fi

if az containerapp show --name "$APP_TILER" -g "$RESOURCE_GROUP" &>/dev/null; then
    az containerapp update --name "$APP_TILER" -g "$RESOURCE_GROUP" \
        --image "$ACR_LOGIN_SERVER/tiler:$IMAGE_TAG" \
        --output none
else
    az containerapp create --name "$APP_TILER" -g "$RESOURCE_GROUP" \
        --environment "$CAE_NAME" \
        --workload-profile-name "tiler-dedicated" \
        --image "$ACR_LOGIN_SERVER/tiler:$IMAGE_TAG" \
        --target-port 8001 --ingress external \
        --cpu 16 --memory 32Gi \
        --min-replicas 1 --max-replicas 2 \
        --scale-rule-name http-concurrency --scale-rule-type http --scale-rule-http-concurrency 20 \
        --user-assigned "$IDENTITY_ID" \
        --registry-server "$ACR_LOGIN_SERVER" --registry-identity "$IDENTITY_ID" \
        --secrets "db-password=keyvaultref:$DB_PASS_URI,identityref:$IDENTITY_ID" \
                  "db-host=keyvaultref:$DB_HOST_URI,identityref:$IDENTITY_ID" \
        --env-vars "DBNAME=stacnotator" "DBUSER=psqladmin" "DBPORT=5432" \
                   "DBDRIVER=psycopg2" "DBSCHEME=postgresql" \
                   "DBPASS=secretref:db-password" "DBHOST=secretref:db-host" \
                   "WORKERS=32" "TIMEOUT=120" "MAX_REQUESTS=500" \
                   "GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR" \
                   "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES=NO" \
                   "GDAL_HTTP_MULTIPLEX=YES" \
                   "GDAL_HTTP_TIMEOUT=60" \
                   "GDAL_HTTP_MAX_RETRY=3" \
                   "GDAL_HTTP_RETRY_DELAY=1" \
                   "VSI_CACHE=TRUE" \
                   "VSI_CACHE_SIZE=536870912" \
                   "GDAL_CACHEMAX=256" \
                   "CPL_VSIL_CURL_ALLOWED_EXTENSIONS=.tif,.tiff" \
                   "CORS_ORIGINS=__PENDING__" \
        --output none
fi
echo -e "${GREEN}✓ Tiler deployed${NC}"

# ── Wait for backend, run migrations ──

echo ""
echo -e "${YELLOW}Waiting for backend to stabilize...${NC}"
sleep 10

REPLICA_NAME=$(az containerapp replica list --name "$APP_BACKEND" -g "$RESOURCE_GROUP" \
    --query "[0].name" -o tsv 2>/dev/null || echo "")

if [ -n "$REPLICA_NAME" ]; then
    echo -e "${YELLOW}Running database migrations...${NC}"
    az containerapp exec --name "$APP_BACKEND" -g "$RESOURCE_GROUP" \
        --replica "$REPLICA_NAME" --command "alembic upgrade head" 2>&1 | tee /tmp/migration_output.log || true
    echo -e "${GREEN}✓ Migrations done${NC}"
else
    echo -e "${YELLOW}Warning: No replica found. Run manually:${NC}"
    echo -e "  az containerapp exec -n backend -g $RESOURCE_GROUP --command 'alembic upgrade head'"
fi

# ── Deploy frontend as Static Web App ──

echo ""
echo -e "${YELLOW}Deploying frontend (Static Web App)...${NC}"

BACKEND_URL=$(az containerapp show --name "$APP_BACKEND" -g "$RESOURCE_GROUP" \
    --query properties.configuration.ingress.fqdn -o tsv 2>/dev/null || echo "")
TILER_URL=$(az containerapp show --name "$APP_TILER" -g "$RESOURCE_GROUP" \
    --query properties.configuration.ingress.fqdn -o tsv 2>/dev/null || echo "$BACKEND_URL")

# Get Firebase config from Key Vault
echo -e "${YELLOW}  Fetching Firebase config from Key Vault...${NC}"
VITE_FIREBASE_API_KEY=$(az keyvault secret show --vault-name "$KV_NAME" --name "firebase-api-key" --query "value" -o tsv 2>/dev/null)
VITE_FIREBASE_AUTH_DOMAIN=$(az keyvault secret show --vault-name "$KV_NAME" --name "firebase-auth-domain" --query "value" -o tsv 2>/dev/null)
VITE_FIREBASE_PROJECT_ID=$(az keyvault secret show --vault-name "$KV_NAME" --name "firebase-project-id" --query "value" -o tsv 2>/dev/null)

if [ -z "$VITE_FIREBASE_API_KEY" ] || [ -z "$VITE_FIREBASE_AUTH_DOMAIN" ] || [ -z "$VITE_FIREBASE_PROJECT_ID" ]; then
    echo -e "${RED}Error: Could not fetch Firebase config from Key Vault.${NC}"
    echo -e "${YELLOW}Fix: az keyvault network-rule add --name $KV_NAME --ip-address \$(curl -s ifconfig.me)/32${NC}"
    echo -e "${YELLOW}Or:  ./azure_deploy/upload-secrets.sh${NC}"
    exit 1
fi

# Create SWA if it doesn't exist
SWA_NAME="$APP_SWA"
if ! az staticwebapp show --name "$SWA_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
    echo -e "${YELLOW}  Creating Static Web App...${NC}"
    az staticwebapp create --name "$SWA_NAME" -g "$RESOURCE_GROUP" \
        --location "westeurope" --sku Free --output none
fi

# Build frontend
echo -e "${YELLOW}  Building frontend...${NC}"
cd frontend
VITE_API_BASE_URL="https://$BACKEND_URL" \
VITE_TILER_BASE_URL="https://$TILER_URL" \
VITE_FIREBASE_API_KEY="$VITE_FIREBASE_API_KEY" \
VITE_FIREBASE_AUTH_DOMAIN="$VITE_FIREBASE_AUTH_DOMAIN" \
VITE_FIREBASE_PROJECT_ID="$VITE_FIREBASE_PROJECT_ID" \
npm run build

# Deploy to SWA
SWA_TOKEN=$(az staticwebapp secrets list --name "$SWA_NAME" -g "$RESOURCE_GROUP" \
    --query "properties.apiKey" -o tsv)

npx @azure/static-web-apps-cli deploy ./dist \
    --deployment-token "$SWA_TOKEN" \
    --env production 2>/dev/null || \
az staticwebapp deploy --name "$SWA_NAME" -g "$RESOURCE_GROUP" \
    --app-location "./dist" --skip-app-build --output none 2>/dev/null || \
echo -e "${YELLOW}  SWA deploy via CLI failed. Try: swa deploy ./dist --deployment-token $SWA_TOKEN${NC}"

cd ..

FRONTEND_URL=$(az staticwebapp show --name "$SWA_NAME" -g "$RESOURCE_GROUP" \
    --query "defaultHostname" -o tsv 2>/dev/null || echo "")
echo -e "${GREEN}✓ Frontend deployed${NC}"

# ── Update CORS ──

echo ""
echo -e "${YELLOW}Updating CORS...${NC}"
az containerapp update --name "$APP_BACKEND" -g "$RESOURCE_GROUP" \
    --set-env-vars "CORS_ORIGINS=https://$FRONTEND_URL" --output none
az containerapp update --name "$APP_TILER" -g "$RESOURCE_GROUP" \
    --set-env-vars "CORS_ORIGINS=https://$FRONTEND_URL" --output none 2>/dev/null || true
echo -e "${GREEN}✓ CORS updated${NC}"

# ── Summary ──

echo ""
echo -e "${GREEN}━━━ Deployment Complete ━━━${NC}"
echo ""
echo -e "${BLUE}Frontend:${NC} https://$FRONTEND_URL"
echo -e "${BLUE}Backend:${NC}  https://$BACKEND_URL"
[ -n "$TILER_URL" ] && echo -e "${BLUE}Tiler:${NC}    https://$TILER_URL"
echo -e "${BLUE}API Docs:${NC} https://$BACKEND_URL/api/docs"
echo ""
echo -e "${YELLOW}Remember: Add https://$FRONTEND_URL to Firebase authorized domains${NC}"
echo ""

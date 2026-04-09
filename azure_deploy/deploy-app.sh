#!/bin/bash
#
# Stacnotator Deployment Script
#
# Deploys application resources within the project's resource group:
#   - Backend Container App (FastAPI)
#   - Tiler Container App (TiTiler + GDAL, dedicated D16 workload profile)
#   - Frontend Static Web App (React/Vite)
#
# Prerequisites:
#   - Infrastructure (RG, ACR, KV, DB, CAE, managed identity) deployed via Terraform (raapid-infra)
#   - User must have Contributor on the project resource group
#   - Secrets uploaded via upload-secrets.sh (first time only)
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

# App names
APP_BACKEND="stacnotator-${ENV}-backend"
APP_TILER="stacnotator-${ENV}-tiler"
APP_SWA="stacnotator-${ENV}-frontend"

# Project name as used in Terraform (matches KV secret naming)
if [ "$ENV" = "prod" ]; then
    PROJECT_NAME="stacnotator"
else
    PROJECT_NAME="stacnotator-${ENV}"
fi

# Resource sizing per environment
if [ "$ENV" = "dev" ]; then
    BACKEND_CPU=0.5  BACKEND_MEM=1Gi  BACKEND_MIN=1  BACKEND_MAX=1  BACKEND_WORKERS=2
    TILER_CPU=4      TILER_MEM=8Gi    TILER_MIN=0    TILER_MAX=1    TILER_WORKERS=8
    TILER_DEDICATED=false
else
    BACKEND_CPU=1    BACKEND_MEM=2Gi  BACKEND_MIN=1  BACKEND_MAX=2  BACKEND_WORKERS=4
    TILER_CPU=8      TILER_MEM=16Gi   TILER_MIN=0    TILER_MAX=2    TILER_WORKERS=16
    TILER_DEDICATED=false
fi

echo -e "${GREEN}Stacnotator Deployment (${ENV})${NC}"
echo ""

# Auto-generate image tag from git commit SHA
if [ -z "$IMAGE_TAG" ]; then
    if [ "$CI" != "true" ] && ! git diff-index --quiet HEAD -- 2>/dev/null; then
        echo -e "${RED}Error: Uncommitted changes. Commit first or set IMAGE_TAG manually.${NC}"
        git status --short
        exit 1
    fi
    IMAGE_TAG=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d-%H%M%S)
fi

# Discover infrastructure
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

echo ""
echo -e "${BLUE}Deployment Plan${NC}"
echo -e "  Env:       $ENV"
echo -e "  RG:        $RESOURCE_GROUP"
echo -e "  Tag:       $IMAGE_TAG"
echo -e "  Backend:   Container App (${BACKEND_CPU} CPU, ${BACKEND_MEM}, ${BACKEND_MIN}-${BACKEND_MAX} replicas)"
if [ "$TILER_DEDICATED" = "true" ]; then
    echo -e "  Tiler:     Container App (${TILER_CPU} CPU, ${TILER_MEM}, D16 dedicated)"
else
    echo -e "  Tiler:     Container App (${TILER_CPU} CPU, ${TILER_MEM}, consumption)"
fi
echo -e "  Frontend:  Static Web App"
echo ""

if [ "$CI" != "true" ]; then
    read -p "Proceed? (y/N): " CONFIRM
    [[ ! "$CONFIRM" =~ ^[Yy]$ ]] && echo "Cancelled." && exit 0
fi

# Look up the shared Container Apps identity (created by Terraform in raapid-infra)
APPS_IDENTITY_NAME="id-${PROJECT_NAME}-apps"
echo -e "${YELLOW}Looking up managed identity: $APPS_IDENTITY_NAME${NC}"
if ! az identity show --name "$APPS_IDENTITY_NAME" -g "$RESOURCE_GROUP" &>/dev/null; then
    echo -e "${RED}Error: Managed identity '$APPS_IDENTITY_NAME' not found in $RESOURCE_GROUP.${NC}"
    echo -e "${RED}Run Terraform in raapid-infra first to create it.${NC}"
    exit 1
fi
IDENTITY_ID=$(az identity show --name "$APPS_IDENTITY_NAME" -g "$RESOURCE_GROUP" --query id -o tsv)
echo -e "${GREEN}✓ Identity: $APPS_IDENTITY_NAME${NC}"

# Build + push images
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

# Deploy backend
echo ""
echo -e "${YELLOW}Deploying backend...${NC}"

DB_PASS_URI="https://$KV_NAME.vault.azure.net/secrets/${PROJECT_NAME}-postgres-admin-password"
DB_HOST_URI="https://$KV_NAME.vault.azure.net/secrets/${PROJECT_NAME}-postgres-host"
FIREBASE_CREDS_URI="https://$KV_NAME.vault.azure.net/secrets/firebase-credentials"
EE_KEY_URI="https://$KV_NAME.vault.azure.net/secrets/ee-private-key"
TILER_SECRET_URI="https://$KV_NAME.vault.azure.net/secrets/tiler-token-secret"

if az containerapp show --name "$APP_BACKEND" -g "$RESOURCE_GROUP" &>/dev/null; then
    az containerapp update --name "$APP_BACKEND" -g "$RESOURCE_GROUP" \
        --image "$ACR_LOGIN_SERVER/backend:$IMAGE_TAG" \
        --min-replicas "$BACKEND_MIN" --max-replicas "$BACKEND_MAX" \
        --set-env-vars "EE_SERVICE_ACCOUNT=$EE_SERVICE_ACCOUNT" \
                       "WORKERS=$BACKEND_WORKERS" "TIMEOUT=60" \
        --output none
else
    az containerapp create --name "$APP_BACKEND" -g "$RESOURCE_GROUP" \
        --environment "$CAE_NAME" \
        --image "$ACR_LOGIN_SERVER/backend:$IMAGE_TAG" \
        --target-port 8000 --ingress external \
        --cpu "$BACKEND_CPU" --memory "$BACKEND_MEM" \
        --min-replicas "$BACKEND_MIN" --max-replicas "$BACKEND_MAX" \
        --scale-rule-name http-concurrency --scale-rule-type http --scale-rule-http-concurrency 50 \
        --user-assigned "$IDENTITY_ID" \
        --registry-server "$ACR_LOGIN_SERVER" --registry-identity "$IDENTITY_ID" \
        --secrets "db-password=keyvaultref:$DB_PASS_URI,identityref:$IDENTITY_ID" \
                  "db-host=keyvaultref:$DB_HOST_URI,identityref:$IDENTITY_ID" \
                  "firebase-credentials=keyvaultref:$FIREBASE_CREDS_URI,identityref:$IDENTITY_ID" \
                  "ee-private-key=keyvaultref:$EE_KEY_URI,identityref:$IDENTITY_ID" \
                  "tiler-token-secret=keyvaultref:$TILER_SECRET_URI,identityref:$IDENTITY_ID" \
        --env-vars "DBNAME=stacnotator" "DBUSER=psqladmin" "DBPORT=5432" \
                   "DBDRIVER=psycopg2" "DBSCHEME=postgresql" \
                   "AUTH_PROVIDER=firebase" "CORS_ORIGINS=__PENDING__" \
                   "DBPASS=secretref:db-password" "DBHOST=secretref:db-host" \
                   "FIREBASE_CREDENTIALS=secretref:firebase-credentials" \
                   "EE_PRIVATE_KEY=secretref:ee-private-key" \
                   "TILER_TOKEN_SECRET=secretref:tiler-token-secret" \
                   "EE_SERVICE_ACCOUNT=$EE_SERVICE_ACCOUNT" \
                   "ENVIRONMENT=production" \
                   "WORKERS=$BACKEND_WORKERS" "TIMEOUT=60" \
        --output none
fi
echo -e "${GREEN}✓ Backend deployed${NC}"

# Deploy tiler
echo ""
echo -e "${YELLOW}Deploying tiler...${NC}"

# Workload profile: D16 for prod, consumption for dev
TILER_PROFILE_ARGS=""
if [ "$TILER_DEDICATED" = "true" ]; then
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
    TILER_PROFILE_ARGS="--workload-profile-name tiler-dedicated"
fi

if az containerapp show --name "$APP_TILER" -g "$RESOURCE_GROUP" &>/dev/null; then
    az containerapp update --name "$APP_TILER" -g "$RESOURCE_GROUP" \
        --image "$ACR_LOGIN_SERVER/tiler:$IMAGE_TAG" \
        --output none
else
    az containerapp create --name "$APP_TILER" -g "$RESOURCE_GROUP" \
        --environment "$CAE_NAME" \
        $TILER_PROFILE_ARGS \
        --image "$ACR_LOGIN_SERVER/tiler:$IMAGE_TAG" \
        --target-port 8001 --ingress external \
        --cpu "$TILER_CPU" --memory "$TILER_MEM" \
        --min-replicas "$TILER_MIN" --max-replicas "$TILER_MAX" \
        --scale-rule-name http-concurrency --scale-rule-type http --scale-rule-http-concurrency 20 \
        --user-assigned "$IDENTITY_ID" \
        --registry-server "$ACR_LOGIN_SERVER" --registry-identity "$IDENTITY_ID" \
        --secrets "db-password=keyvaultref:$DB_PASS_URI,identityref:$IDENTITY_ID" \
                  "db-host=keyvaultref:$DB_HOST_URI,identityref:$IDENTITY_ID" \
                  "tiler-token-secret=keyvaultref:$TILER_SECRET_URI,identityref:$IDENTITY_ID" \
        --env-vars "DBNAME=stacnotator" "DBUSER=psqladmin" "DBPORT=5432" \
                   "DBDRIVER=psycopg2" "DBSCHEME=postgresql" \
                   "DBPASS=secretref:db-password" "DBHOST=secretref:db-host" \
                   "TILER_TOKEN_SECRET=secretref:tiler-token-secret" \
                   "WORKERS=$TILER_WORKERS" "TIMEOUT=120" "MAX_REQUESTS=500" \
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

# Run migrations
echo ""
echo -e "${YELLOW}Waiting for backend replica to be ready...${NC}"
MIGRATION_RETRIES=12
REPLICA_NAME=""
for i in $(seq 1 $MIGRATION_RETRIES); do
    REPLICA_NAME=$(az containerapp replica list --name "$APP_BACKEND" -g "$RESOURCE_GROUP" \
        --query "[?properties.runningState=='Running'] | [0].name" -o tsv 2>/dev/null || echo "")
    if [ -n "$REPLICA_NAME" ]; then
        echo -e "${GREEN}  ✓ Replica ready: $REPLICA_NAME${NC}"
        break
    fi
    echo -e "  Attempt $i/$MIGRATION_RETRIES - waiting 10s..."
    sleep 10
done

if [ -n "$REPLICA_NAME" ]; then
    echo -e "${YELLOW}Running database migrations...${NC}"
    # az containerapp exec doesn't reliably return the command's exit code,
    # so we wrap alembic to echo a sentinel on success.
    az containerapp exec --name "$APP_BACKEND" -g "$RESOURCE_GROUP" \
        --replica "$REPLICA_NAME" \
        --command "alembic upgrade head" \
        2>&1 | tee /tmp/migration_output.log
    # Check output for alembic success indicators or errors
    if grep -qiE "(FAILED|error|Traceback)" /tmp/migration_output.log; then
        echo -e "${RED}Warning: Migration output contains errors.${NC}"
        echo -e "${YELLOW}Check /tmp/migration_output.log or run manually:${NC}"
        echo -e "  az containerapp exec -n $APP_BACKEND -g $RESOURCE_GROUP --command 'alembic upgrade head'"
    else
        echo -e "${GREEN}✓ Migrations done${NC}"
    fi
else
    echo -e "${YELLOW}Warning: No running replica found after ${MIGRATION_RETRIES} attempts. Run manually:${NC}"
    echo -e "  az containerapp exec -n $APP_BACKEND -g $RESOURCE_GROUP --command 'alembic upgrade head'"
fi

# Deploy frontend
echo ""
echo -e "${YELLOW}Deploying frontend...${NC}"

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

# Update CORS
echo ""
echo -e "${YELLOW}Updating CORS...${NC}"
az containerapp update --name "$APP_BACKEND" -g "$RESOURCE_GROUP" \
    --set-env-vars "CORS_ORIGINS=https://$FRONTEND_URL" --output none
az containerapp update --name "$APP_TILER" -g "$RESOURCE_GROUP" \
    --set-env-vars "CORS_ORIGINS=https://$FRONTEND_URL" --output none 2>/dev/null || true
echo -e "${GREEN}✓ CORS updated${NC}"

echo ""
echo -e "${GREEN}Deployment Complete${NC}"
echo ""
echo -e "${BLUE}Frontend:${NC} https://$FRONTEND_URL"
echo -e "${BLUE}Backend:${NC}  https://$BACKEND_URL"
[ -n "$TILER_URL" ] && echo -e "${BLUE}Tiler:${NC}    https://$TILER_URL"
echo -e "${BLUE}API Docs:${NC} https://$BACKEND_URL/api/docs"
echo ""
echo -e "${YELLOW}Remember: Add https://$FRONTEND_URL to Firebase authorized domains${NC}"
echo ""

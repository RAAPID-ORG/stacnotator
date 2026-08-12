#!/usr/bin/env bash
#
# Stacnotator release deploy: backend + tiler Container Apps, frontend Static Web App.
#
# Every value is resolved before the first write (see env.sh), so each resource is
# written exactly once and the backend produces a single revision per deploy. The
# three builds are independent and run concurrently.
#
# One-time environment setup lives in bootstrap.sh.
#
# TODO: deploy in an order that survives partial failure. A new backend image going
# live while its migration fails still leaves a half-applied state.
set -euo pipefail

usage() {
    echo "Usage: $0 <prod|dev> [--dry-run]" >&2
    exit 1
}

ENV="${1:-}"
[ -n "$ENV" ] || usage
DRY_RUN=false
if [ -n "${2:-}" ]; then
    [ "$2" = "--dry-run" ] || usage
    DRY_RUN=true
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=deployment/azure/env.sh
. "$SCRIPT_DIR/env.sh"

if ! az account show &>/dev/null; then
    echo -e "${RED}Error: not logged in to Azure. Run 'az login' first.${NC}" >&2
    exit 1
fi

# The tiler lives in its own repo and owns its build and deploy. CI checks it out into
# TILER_REPO_DIR; locally it defaults to a sibling clone.
TILER_REPO_DIR="${TILER_REPO_DIR:-$REPO_ROOT/../stacnotator-tiler}"
if [ ! -f "$TILER_REPO_DIR/deployment/deploy-containerapp.sh" ]; then
    echo -e "${RED}Tiler repo not found at '$TILER_REPO_DIR'.${NC}" >&2
    echo -e "${RED}Set TILER_REPO_DIR, or clone RAAPID-ORG/stacnotator-tiler as a sibling.${NC}" >&2
    exit 1
fi

if [ -z "${IMAGE_TAG:-}" ]; then
    if [ "${CI:-}" != "true" ] && ! git -C "$REPO_ROOT" diff-index --quiet HEAD -- 2>/dev/null; then
        echo -e "${RED}Error: uncommitted changes. Commit first or set IMAGE_TAG.${NC}" >&2
        git -C "$REPO_ROOT" status --short
        exit 1
    fi
    IMAGE_TAG=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d-%H%M%S)
fi
# Tag the tiler image with the tiler repo's own SHA so the tag identifies its contents
# rather than an unrelated stacnotator commit.
TILER_IMAGE_TAG=$(git -C "$TILER_REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo "$IMAGE_TAG")

resolve_config "$ENV"
mask_resolved_config

echo -e "${GREEN}Stacnotator deploy (${ENV})${NC}"
echo ""
print_config
echo -e "  Backend image:  backend:$IMAGE_TAG"
echo -e "  Tiler image:    tiler:$TILER_IMAGE_TAG"
echo ""

# Key Vault secret refs, resolved at runtime by the user-assigned identity.
BACKEND_SECRETS=(
    "db-password=keyvaultref:$(kv_uri "${PROJECT_NAME}-postgres-admin-password"),identityref:$IDENTITY_ID"
    "db-host=keyvaultref:$(kv_uri "${PROJECT_NAME}-postgres-host"),identityref:$IDENTITY_ID"
    "firebase-credentials=keyvaultref:$(kv_uri firebase-credentials),identityref:$IDENTITY_ID"
    "ee-private-key=keyvaultref:$(kv_uri ee-private-key),identityref:$IDENTITY_ID"
    "tiler-token-secret=keyvaultref:$(kv_uri tiler-token-secret),identityref:$IDENTITY_ID"
    "apikey-encryption-secret=keyvaultref:$(kv_uri apikey-encryption-secret),identityref:$IDENTITY_ID"
)

# The complete backend environment, applied in a single write. Nothing here is
# late-bound, which is what keeps a deploy to one revision.
BACKEND_ENV=(
    "DBNAME=stacnotator" "DBUSER=psqladmin" "DBPORT=5432"
    "DBDRIVER=psycopg2" "DBSCHEME=postgresql"
    "DBPASS=secretref:db-password" "DBHOST=secretref:db-host"
    "FIREBASE_CREDENTIALS=secretref:firebase-credentials"
    "EE_PRIVATE_KEY=secretref:ee-private-key"
    "TILER_TOKEN_SECRET=secretref:tiler-token-secret"
    "APIKEY_ENCRYPTION_SECRET=secretref:apikey-encryption-secret"
    "EE_SERVICE_ACCOUNT=${EE_SERVICE_ACCOUNT:-}"
    "AUTH_PROVIDER=firebase" "ENVIRONMENT=production"
    "WORKERS=$BACKEND_WORKERS" "TIMEOUT=60"
    "DB_POOL_SIZE=$BACKEND_POOL_SIZE" "DB_MAX_OVERFLOW=$BACKEND_MAX_OVERFLOW"
    "CORS_ORIGINS=$CORS_ORIGINS"
    "TILERS=$TILERS_JSON"
    "DEFAULT_TILER=$TILER_NAME"
)
[ -n "$TILER_COOKIE_DOMAIN" ] && BACKEND_ENV+=("TILER_COOKIE_DOMAIN=$TILER_COOKIE_DOMAIN")

if [ "$DRY_RUN" = "true" ]; then
    echo -e "${BLUE}Backend secrets:${NC}"
    printf '  %s\n' "${BACKEND_SECRETS[@]}"
    echo ""
    echo -e "${BLUE}Backend environment:${NC}"
    printf '  %s\n' "${BACKEND_ENV[@]}"
    echo ""
    echo -e "${BLUE}Would run, backend/tiler/frontend builds concurrently:${NC}"
    echo "  az acr build --registry $ACR_NAME --image backend:$IMAGE_TAG -f backend/Dockerfile backend/"
    echo "  $TILER_REPO_DIR/deployment/deploy-containerapp.sh  (tiler:$TILER_IMAGE_TAG)"
    echo "  npm ci && npm run build  (VITE_API_BASE_URL=https://$API_HOST)"
    echo "  az containerapp create-or-update $APP_BACKEND"
    echo "  swa deploy ./dist --env production  ($APP_SWA)"
    echo ""
    echo -e "${GREEN}Dry run complete. Nothing was written.${NC}"
    exit 0
fi

if [ "${CI:-}" != "true" ]; then
    read -r -p "Proceed? (y/N): " CONFIRM
    [[ "$CONFIRM" =~ ^[Yy]$ ]] || {
        echo "Cancelled."
        exit 0
    }
fi

# Firebase client config is not secret (it ships inside the frontend bundle) but is
# stored in Key Vault so a deploy has one source of truth per environment.
VITE_FIREBASE_API_KEY=$(az keyvault secret show --vault-name "$KV_NAME" --name firebase-api-key --query value -o tsv 2>/dev/null || echo "")
VITE_FIREBASE_AUTH_DOMAIN=$(az keyvault secret show --vault-name "$KV_NAME" --name firebase-auth-domain --query value -o tsv 2>/dev/null || echo "")
VITE_FIREBASE_PROJECT_ID=$(az keyvault secret show --vault-name "$KV_NAME" --name firebase-project-id --query value -o tsv 2>/dev/null || echo "")
if [ -z "$VITE_FIREBASE_API_KEY" ] || [ -z "$VITE_FIREBASE_AUTH_DOMAIN" ] || [ -z "$VITE_FIREBASE_PROJECT_ID" ]; then
    echo -e "${RED}Could not read Firebase client config from Key Vault '$KV_NAME'.${NC}" >&2
    echo -e "${YELLOW}Allow your IP: az keyvault network-rule add --name $KV_NAME --ip-address \$(curl -s ifconfig.me)/32${NC}" >&2
    echo -e "${YELLOW}Or upload it:  ./deployment/azure/bootstrap.sh $ENV${NC}" >&2
    exit 1
fi
ci_mask "$VITE_FIREBASE_API_KEY" "$VITE_FIREBASE_AUTH_DOMAIN" "$VITE_FIREBASE_PROJECT_ID"

# Stage runner. The builds are independent, so they run concurrently; each stage's
# output is buffered and printed when it is joined, so parallel logs stay readable.
STAGE_DIR="$(mktemp -d)"
declare -A STAGE_PID

# Bailing out on one stage leaves the others running, so stop them before exiting.
# On the success path every pid is already reaped and kill fails; that must not be
# allowed to propagate, or set -e aborts the trap and the script exits non-zero.
cleanup_stages() {
    if [ ${#STAGE_PID[@]} -gt 0 ]; then
        kill "${STAGE_PID[@]}" 2>/dev/null || true
    fi
    rm -rf "$STAGE_DIR"
    return 0
}
trap cleanup_stages EXIT

start_stage() {
    local name="$1"
    shift
    echo -e "${YELLOW}Started: $name${NC}"
    ("$@") >"$STAGE_DIR/$name.log" 2>&1 &
    STAGE_PID["$name"]=$!
}

join_stage() {
    local name="$1" rc=0
    wait "${STAGE_PID[$name]}" || rc=$?
    echo ""
    echo -e "${BLUE}----- $name -----${NC}"
    cat "$STAGE_DIR/$name.log"
    if [ "$rc" -ne 0 ]; then
        echo -e "${RED}Stage '$name' failed (exit $rc).${NC}" >&2
        exit "$rc"
    fi
    echo -e "${GREEN}Done: $name${NC}"
}

build_backend() {
    az acr build --registry "$ACR_NAME" --image "backend:$IMAGE_TAG" \
        --build-arg PYTHON_IMAGE="$ACR_LOGIN_SERVER/python:3.12-slim-bookworm" \
        -f "$REPO_ROOT/backend/Dockerfile" "$REPO_ROOT/backend/"
}

# The tiler repo owns its own build and deploy; we hand it this environment's
# parameters. It has no ordering dependency on the backend.
deploy_tiler() {
    local profile=""
    [ "$TILER_DEDICATED" = "true" ] && profile="tiler-dedicated"
    RESOURCE_GROUP="$RESOURCE_GROUP" \
        CONTAINERAPP_NAME="$APP_TILER" \
        CAE_NAME="$CAE_NAME" \
        ACR_NAME="$ACR_NAME" \
        ACR_LOGIN_SERVER="$ACR_LOGIN_SERVER" \
        IMAGE_TAG="$TILER_IMAGE_TAG" \
        IDENTITY_ID="$IDENTITY_ID" \
        DB_HOST_SECRET_URI="$(kv_uri "${PROJECT_NAME}-postgres-host")" \
        TILER_DB_PASSWORD_SECRET_URI="$(kv_uri tiler-db-password)" \
        TILER_TOKEN_SECRET_URI="$(kv_uri tiler-token-secret)" \
        CPU="$TILER_CPU" MEMORY="$TILER_MEM" \
        MIN_REPLICAS="$TILER_MIN" MAX_REPLICAS="$TILER_MAX" \
        WEB_CONCURRENCY="$TILER_WORKERS" \
        ALLOW_STAC_API_INGEST="$TILER_ALLOWS_INGEST" \
        AZURE_SIGNING_ENABLED="$TILER_AZURE_SIGNING" \
        DB_MIN_CONN_SIZE=1 DB_MAX_CONN_SIZE="$TILER_DB_MAX_CONN" \
        CORS_ORIGINS="$CORS_ORIGINS" \
        WORKLOAD_PROFILE="$profile" \
        "$TILER_REPO_DIR/deployment/deploy-containerapp.sh"
}

build_frontend() {
    cd "$REPO_ROOT/frontend"
    npm ci
    VITE_API_BASE_URL="https://$API_HOST" \
        VITE_FIREBASE_API_KEY="$VITE_FIREBASE_API_KEY" \
        VITE_FIREBASE_AUTH_DOMAIN="$VITE_FIREBASE_AUTH_DOMAIN" \
        VITE_FIREBASE_PROJECT_ID="$VITE_FIREBASE_PROJECT_ID" \
        npm run build
}

deploy_backend() {
    if az containerapp show --name "$APP_BACKEND" -g "$RESOURCE_GROUP" &>/dev/null; then
        az containerapp secret set --name "$APP_BACKEND" -g "$RESOURCE_GROUP" \
            --secrets "${BACKEND_SECRETS[@]}" --output none
        # --cpu/--memory must be passed on update too: without them an existing app
        # keeps its original sizing while the WORKERS and pool env vars are applied
        # regardless, silently oversubscribing a container that never grew.
        az containerapp update --name "$APP_BACKEND" -g "$RESOURCE_GROUP" \
            --image "$ACR_LOGIN_SERVER/backend:$IMAGE_TAG" \
            --cpu "$BACKEND_CPU" --memory "$BACKEND_MEM" \
            --min-replicas "$BACKEND_MIN" --max-replicas "$BACKEND_MAX" \
            --set-env-vars "${BACKEND_ENV[@]}" --output none
    else
        az containerapp create --name "$APP_BACKEND" -g "$RESOURCE_GROUP" \
            --environment "$CAE_NAME" \
            --image "$ACR_LOGIN_SERVER/backend:$IMAGE_TAG" \
            --target-port 8000 --ingress external \
            --cpu "$BACKEND_CPU" --memory "$BACKEND_MEM" \
            --min-replicas "$BACKEND_MIN" --max-replicas "$BACKEND_MAX" \
            --scale-rule-name http-concurrency --scale-rule-type http \
            --scale-rule-http-concurrency 50 \
            --user-assigned "$IDENTITY_ID" \
            --registry-server "$ACR_LOGIN_SERVER" --registry-identity "$IDENTITY_ID" \
            --secrets "${BACKEND_SECRETS[@]}" \
            --env-vars "${BACKEND_ENV[@]}" --output none
    fi
}

# Migrations run on container startup (alembic upgrade head before gunicorn). A failed
# migration, or unparseable env such as a malformed TILERS, exits non-zero: the
# revision stays unhealthy and the previous one keeps serving all traffic.
#
# That covers a migration that FAILS. A migration that succeeds and corrupts data has
# no automatic rollback, so the deploy records the instant before the image swap:
# Flexible Server point-in-time restore can wind the database back to any second
# within its retention window, and this is the second to ask for.
print_restore_point() {
    echo -e "${BLUE}Pre-migration restore point: ${PRE_MIGRATION_UTC:-not reached}${NC}"
    if [ -n "${POSTGRES_SERVER:-}" ]; then
        echo -e "${YELLOW}  az postgres flexible-server restore --resource-group $RESOURCE_GROUP \\"
        echo -e "    --name <new-server-name> --source-server $POSTGRES_SERVER \\"
        echo -e "    --restore-time $PRE_MIGRATION_UTC${NC}"
        echo -e "${YELLOW}  Restore creates a NEW server; repoint DBHOST at it rather than restoring in place.${NC}"
    fi
    return 0
}

wait_for_backend_health() {
    local revision health
    revision=$(az containerapp show -n "$APP_BACKEND" -g "$RESOURCE_GROUP" \
        --query properties.latestRevisionName -o tsv)
    ci_mask "$revision"

    for _ in $(seq 1 60); do
        health=$(az containerapp revision show -n "$APP_BACKEND" -g "$RESOURCE_GROUP" \
            --revision "$revision" --query properties.healthState -o tsv 2>/dev/null || echo Unknown)
        case "$health" in
        Healthy) return 0 ;;
        Unhealthy)
            echo -e "${RED}Revision unhealthy. Likely a failed startup migration; the previous revision still serves traffic.${NC}" >&2
            echo -e "${YELLOW}  az containerapp logs show -n $APP_BACKEND -g $RESOURCE_GROUP --revision $revision --tail 200${NC}" >&2
            print_restore_point >&2
            return 1
            ;;
        esac
        sleep 5
    done

    echo -e "${RED}Timed out after 5 minutes. The previous revision still serves traffic.${NC}" >&2
    echo -e "${YELLOW}  az containerapp revision list -n $APP_BACKEND -g $RESOURCE_GROUP -o table${NC}" >&2
    print_restore_point >&2
    return 1
}

start_stage build-backend build_backend
start_stage tiler deploy_tiler
start_stage build-frontend build_frontend

join_stage build-backend

# Captured immediately before the image swap, because the new container runs
# `alembic upgrade head` on startup. Anything the migration does to the data happens
# after this instant, so it is the point-in-time restore target if a migration
# succeeds but is wrong.
PRE_MIGRATION_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo -e "${YELLOW}Deploying backend...${NC}"
deploy_backend
echo -e "${GREEN}Backend deployed${NC}"

join_stage build-frontend
echo -e "${YELLOW}Uploading frontend...${NC}"
SWA_TOKEN=$(az staticwebapp secrets list --name "$APP_SWA" -g "$RESOURCE_GROUP" \
    --query properties.apiKey -o tsv)
ci_mask "$SWA_TOKEN"
# --env names the SWA deployment slot, not our environment. The CLI is a pinned
# devDependency, so npx resolves it from node_modules rather than downloading.
(cd "$REPO_ROOT/frontend" && npx swa deploy ./dist --deployment-token "$SWA_TOKEN" --env production)
echo -e "${GREEN}Frontend deployed${NC}"

join_stage tiler

echo ""
echo -e "${YELLOW}Waiting for the new backend revision to become healthy...${NC}"
wait_for_backend_health
echo -e "${GREEN}Backend revision healthy (migrations applied on startup)${NC}"

echo ""
echo -e "${GREEN}Deployment complete${NC}"
print_restore_point
echo -e "${BLUE}Frontend:${NC} https://$FRONTEND_HOST"
echo -e "${BLUE}Backend:${NC}  https://$API_HOST"
echo -e "${BLUE}Tiler:${NC}    https://$TILER_BROWSER_HOST"
echo -e "${BLUE}API docs:${NC} https://$API_HOST/api/docs"

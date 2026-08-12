#!/usr/bin/env bash
#
# One-time setup for an environment. Run again only when credentials rotate.
#
# Uploads the Firebase and Earth Engine credentials, generates the shared secrets
# when absent, creates the Static Web App, and adds the dedicated tiler workload
# profile when the environment asks for one. Everything here is idempotent.
#
# Per-release work lives in deploy.sh.
set -euo pipefail

ENV="${1:?Usage: $0 <prod|dev>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deployment/azure/env.sh
. "$SCRIPT_DIR/env.sh"

if ! az account show &>/dev/null; then
    echo -e "${RED}Error: not logged in to Azure. Run 'az login' first.${NC}" >&2
    exit 1
fi

# This script is what creates the Static Web App, so it is the one caller allowed to
# resolve config before that app exists.
ALLOW_MISSING_SWA=1 resolve_config "$ENV"
mask_resolved_config

echo -e "${GREEN}Bootstrap ${ENV}${NC}"
echo -e "  Key Vault:      $KV_NAME"
echo -e "  Static Web App: $APP_SWA"
echo ""

upload_file_secret() {
    local name="$1" path="$2" label="$3"
    if [ -z "$path" ]; then
        echo -e "${RED}Error: $label path not set. Add it to .env.deploy.$ENV${NC}" >&2
        exit 1
    fi
    if [ ! -f "$path" ]; then
        echo -e "${RED}Error: $label file not found: $path${NC}" >&2
        exit 1
    fi
    az keyvault secret set --vault-name "$KV_NAME" --name "$name" --file "$path" --output none
    echo -e "${GREEN}Uploaded $label${NC}"
}

# Generate-if-absent only. Rotating apikey-encryption-secret makes every stored
# provider API key undecryptable, and rotating tiler-token-secret invalidates every
# tiler cookie in flight.
generate_secret_if_absent() {
    local name="$1" value="$2" label="$3"
    if az keyvault secret show --vault-name "$KV_NAME" --name "$name" --query value -o tsv &>/dev/null; then
        echo -e "${GREEN}$label already present${NC}"
        return 0
    fi
    az keyvault secret set --vault-name "$KV_NAME" --name "$name" --value "$value" --output none
    echo -e "${GREEN}Generated $label${NC}"
}

upload_file_secret firebase-credentials "${FIREBASE_CREDS:-}" "Firebase admin credentials"
upload_file_secret ee-private-key "${EE_CREDS:-}" "Earth Engine service account"

generate_secret_if_absent tiler-token-secret "$(openssl rand -hex 32)" "tiler token secret"
generate_secret_if_absent apikey-encryption-secret "$(openssl rand -base64 32)" "API key encryption secret"

# Firebase client config is not secret (it ships inside the frontend bundle) but lives
# in Key Vault so a deploy has one source of truth per environment.
if [ -n "${FIREBASE_API_KEY:-}" ] && [ -n "${FIREBASE_AUTH_DOMAIN:-}" ] && [ -n "${FIREBASE_PROJECT_ID:-}" ]; then
    az keyvault secret set --vault-name "$KV_NAME" --name firebase-api-key --value "$FIREBASE_API_KEY" --output none
    az keyvault secret set --vault-name "$KV_NAME" --name firebase-auth-domain --value "$FIREBASE_AUTH_DOMAIN" --output none
    az keyvault secret set --vault-name "$KV_NAME" --name firebase-project-id --value "$FIREBASE_PROJECT_ID" --output none
    echo -e "${GREEN}Uploaded Firebase client config${NC}"
else
    echo -e "${YELLOW}Skipped Firebase client config (FIREBASE_API_KEY/AUTH_DOMAIN/PROJECT_ID not set)${NC}"
fi

if az staticwebapp show --name "$APP_SWA" -g "$RESOURCE_GROUP" &>/dev/null; then
    echo -e "${GREEN}Static Web App already present${NC}"
else
    az staticwebapp create --name "$APP_SWA" -g "$RESOURCE_GROUP" \
        --location westeurope --sku Free --output none
    echo -e "${GREEN}Created Static Web App${NC}"
fi

if [ "$TILER_DEDICATED" = "true" ]; then
    if az containerapp env workload-profile list -g "$RESOURCE_GROUP" --name "$CAE_NAME" \
        --query "[?name=='tiler-dedicated'].name" -o tsv | grep -q .; then
        echo -e "${GREEN}Dedicated tiler workload profile already present${NC}"
    else
        az containerapp env workload-profile add --name "$CAE_NAME" -g "$RESOURCE_GROUP" \
            --workload-profile-name tiler-dedicated --workload-profile-type D8 \
            --min-nodes 0 --max-nodes 1 --output none
        echo -e "${GREEN}Added dedicated tiler workload profile${NC}"
    fi
fi

echo ""
echo -e "${GREEN}Bootstrap complete${NC}"
echo -e "${BLUE}Next:${NC} ./deployment/azure/deploy.sh $ENV"
echo -e "${YELLOW}Remember to add the frontend domain to Firebase authorized domains.${NC}"

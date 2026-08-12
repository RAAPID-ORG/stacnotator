#!/usr/bin/env bash
#
# Derivation-only test for env.sh. Stubs discovery so no Azure access is needed:
# resolve_config skips its az calls when the discovered names are pre-set.
#
# Guards the assumption the whole redesign rests on, that every host is derivable
# before anything is written.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

FAILED=0
check() {
    local label="$1" got="$2" want="$3"
    if [ "$got" = "$want" ]; then
        echo "ok   $label"
    else
        echo "FAIL $label"
        echo "       got:  $got"
        echo "       want: $want"
        FAILED=1
    fi
}

STUB_DOMAIN=graytree-1234.westeurope.azurecontainerapps.io
export RESOURCE_GROUP=stub-rg
export EE_SERVICE_ACCOUNT=sa@example.iam.gserviceaccount.com
export ACR_NAME=stubacr KV_NAME=stubkv CAE_NAME=stubcae
export CAE_DEFAULT_DOMAIN="$STUB_DOMAIN"
export IDENTITY_ID=/subscriptions/x/id-stacnotator-dev-apps
export SKIP_LOCAL_ENV_FILE=1

# shellcheck source=deployment/azure/env.sh
. "$SCRIPT_DIR/env.sh"

PUBLIC_DOMAIN=dev.example.org resolve_config dev

check "backend app name" "$APP_BACKEND" "stacnotator-dev-backend"
check "tiler azure fqdn" "$TILER_AZURE_FQDN" "stacnotator-dev-tiler.$STUB_DOMAIN"
check "api host" "$API_HOST" "api.dev.example.org"
check "frontend host" "$FRONTEND_HOST" "app.dev.example.org"
check "cookie domain" "$TILER_COOKIE_DOMAIN" ".dev.example.org"
check "cors origins" "$CORS_ORIGINS" "https://app.dev.example.org"
check "acr login server" "$ACR_LOGIN_SERVER" "stubacr.azurecr.io"
check "key vault uri" "$(kv_uri tiler-token-secret)" \
    "https://stubkv.vault.azure.net/secrets/tiler-token-secret"
check "tilers json" "$TILERS_JSON" \
    "{\"hosted\":{\"url\":\"https://tiler.dev.example.org\",\"internal_url\":\"https://stacnotator-dev-tiler.$STUB_DOMAIN\",\"allows_ingest\":true}}"
check "dev backend sizing" "$BACKEND_CPU/$BACKEND_POOL_SIZE" "2/5"

# Extra tilers are appended inside the same JSON object, and CR/LF pasted through the
# GitHub variable editor must not survive: a raw control char makes json.loads fail
# at backend boot.
PUBLIC_DOMAIN=dev.example.org \
    EXTRA_TILERS=$'"gcp":{"url":"https://t.example.org","allows_ingest":false}\r' \
    resolve_config dev
check "extra tilers appended" "$TILERS_JSON" \
    "{\"hosted\":{\"url\":\"https://tiler.dev.example.org\",\"internal_url\":\"https://stacnotator-dev-tiler.$STUB_DOMAIN\",\"allows_ingest\":true},\"gcp\":{\"url\":\"https://t.example.org\",\"allows_ingest\":false}}"

PUBLIC_DOMAIN=example.org CUSTOM_DOMAINS=https://www.example.org resolve_config prod
check "prod cors includes custom domains" "$CORS_ORIGINS" \
    "https://app.example.org,https://www.example.org"
check "prod backend sizing" "$BACKEND_CPU/$BACKEND_POOL_SIZE" "2/10"
# Peak connections must stay well under what a 2 vCore GP_Standard_D2ds_v5 serves well,
# which is a much tighter bound than the server's max_connections.
check "prod peak connection budget" \
    "$(((BACKEND_POOL_SIZE + BACKEND_MAX_OVERFLOW) * BACKEND_WORKERS + TILER_DB_MAX_CONN * TILER_WORKERS))" \
    "96"

if resolve_config bogus 2>/dev/null; then
    check "rejects unknown env" accepted rejected
else
    check "rejects unknown env" rejected rejected
fi

exit "$FAILED"

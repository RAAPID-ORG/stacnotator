#!/usr/bin/env bash
#
# Resolves every value a deploy needs, before anything is written to Azure.
# Sourced by deploy.sh and bootstrap.sh.
#
# Deliberately holds no identifiers: resource group, domains, service accounts and
# Firebase project ids arrive from the environment (GitHub Environment secrets and
# variables in CI, .env.deploy.<env> locally). The repo is public.
#
# This is a library: almost everything it defines is consumed by its callers, so the
# unused-variable warning is noise here.
# shellcheck disable=SC2034

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Values that may arrive either from the environment or from the local env file.
# The environment always wins, so a stray file on a runner cannot influence CI.
IDENTIFIER_VARS=(
    RESOURCE_GROUP PUBLIC_DOMAIN EE_SERVICE_ACCOUNT CUSTOM_DOMAINS EXTRA_TILERS
    TILER_NAME TILER_ALLOWS_INGEST TILER_AZURE_SIGNING TILER_DEDICATED IMAGE_TAG
    FIREBASE_CREDS EE_CREDS FIREBASE_API_KEY FIREBASE_AUTH_DOMAIN FIREBASE_PROJECT_ID
    DB_NAME DB_ADMIN_USER AREA_ESTIMATION_BLOB_URL AREA_ESTIMATION_JOB
)

# Register sensitive values with GitHub Actions so they are replaced with "***" in
# workflow logs. The repo is public, so Actions logs are world-readable. No-op locally.
ci_mask() {
    [ "${CI:-}" = "true" ] || return 0
    local v
    for v in "$@"; do
        [ -n "$v" ] && echo "::add-mask::$v"
    done
    return 0
}

_load_local_env_file() {
    local file="$1" v kv saved=()
    [ -f "$file" ] || return 0
    for v in "${IDENTIFIER_VARS[@]}"; do
        [ -n "${!v:-}" ] && saved+=("$v=${!v}")
    done
    set -a
    # shellcheck disable=SC1090
    . "$file"
    set +a
    # These came from the environment, so they already carry the export attribute;
    # restoring the value is enough to undo whatever the file set.
    for kv in "${saved[@]}"; do
        printf -v "${kv%%=*}" '%s' "${kv#*=}"
    done
    return 0
}

# One call for every platform resource Terraform created, plus one for the Container
# Apps environment domain. Skipped when the caller already supplied them.
_discover_resources() {
    local query tsv missing=() discovered=()
    query="[
        [?type=='Microsoft.ContainerRegistry/registries']|[0].name,
        [?type=='Microsoft.KeyVault/vaults']|[0].name,
        [?type=='Microsoft.App/managedEnvironments']|[0].name,
        [?type=='Microsoft.ManagedIdentity/userAssignedIdentities' && name=='id-${PROJECT_NAME}-apps']|[0].id,
        [?type=='Microsoft.DBforPostgreSQL/flexibleServers']|[0].name
    ]"
    tsv=$(az resource list -g "$RESOURCE_GROUP" --query "$query" -o tsv) || return 1
    mapfile -t discovered <<<"$tsv"
    ACR_NAME="${discovered[0]:-}"
    KV_NAME="${discovered[1]:-}"
    CAE_NAME="${discovered[2]:-}"
    IDENTITY_ID="${discovered[3]:-}"
    POSTGRES_SERVER="${discovered[4]:-}"
    # Only used to print a copy-pasteable restore command, so a miss is not fatal.
    _require_discovered "$POSTGRES_SERVER" || POSTGRES_SERVER=""

    _require_discovered "$ACR_NAME" "container registry" || missing+=("container registry")
    _require_discovered "$KV_NAME" "key vault" || missing+=("key vault")
    _require_discovered "$CAE_NAME" "container apps environment" || missing+=("container apps environment")
    _require_discovered "$IDENTITY_ID" "identity" || missing+=("managed identity id-${PROJECT_NAME}-apps")
    if [ ${#missing[@]} -gt 0 ]; then
        echo -e "${RED}Missing platform resources in $RESOURCE_GROUP: ${missing[*]}${NC}" >&2
        echo -e "${RED}Run Terraform in raapid-infra first.${NC}" >&2
        return 1
    fi

    CAE_DEFAULT_DOMAIN=$(az containerapp env show -n "$CAE_NAME" -g "$RESOURCE_GROUP" \
        --query properties.defaultDomain -o tsv) || return 1
    return 0
}

# az emits the literal string "None" for a null projection, not an empty field.
_require_discovered() {
    [ -n "$1" ] && [ "$1" != "None" ]
}

kv_uri() {
    echo "https://$KV_NAME.vault.azure.net/secrets/$1"
}

_resolve_sizing() {
    # Backend is pinned to a single replica (MIN=MAX=1) so alembic migrations on
    # container startup are serialized by definition. Raising the cap requires
    # wrapping context.run_migrations() in a pg_advisory_lock first, otherwise
    # concurrent startups race on schema changes.
    #
    # Connection budget:
    #   backend = (BACKEND_POOL_SIZE + BACKEND_MAX_OVERFLOW) x BACKEND_WORKERS
    #   tiler   = TILER_DB_MAX_CONN x TILER_WORKERS
    #
    # Both environments run GP_Standard_D2ds_v5 (2 vCore / 8 GiB, max_connections 859).
    #
    # Sized by how long a request *holds* a connection, not by how much work Postgres is
    # doing. Postgres is a network hop away and `get_db` holds its connection for the
    # whole request, so connections sit idle most of their life and you need many more
    # of them than the query load suggests. Undersizing does not throttle gracefully: it
    # churns, because everything above pool_size is rebuilt per checkout.
    if [ "$ENV" = "dev" ]; then
        # Steady 20x4 = 80, peak 30x4 + 2x4 = 128 of 859.
        BACKEND_CPU=2 BACKEND_MEM=4Gi BACKEND_MIN=1 BACKEND_MAX=1 BACKEND_WORKERS=4
        BACKEND_POOL_SIZE=20 BACKEND_MAX_OVERFLOW=10
        # Dev is where the load tests run, and attributing them afterwards needs the
        # whole mix, not just the tail. Prod keeps to slow requests only.
        BACKEND_TIMING_LOG=true
        TILER_CPU=4 TILER_MEM=8Gi TILER_MIN=1 TILER_MAX=1 TILER_WORKERS=4
        TILER_DB_MAX_CONN=2
    else
        # Steady 20x4 = 80, peak 30x4 + 4x4 = 136 of 859.
        BACKEND_CPU=2 BACKEND_MEM=4Gi BACKEND_MIN=1 BACKEND_MAX=1 BACKEND_WORKERS=4
        BACKEND_POOL_SIZE=20 BACKEND_MAX_OVERFLOW=10
        BACKEND_TIMING_LOG=false
        TILER_CPU=4 TILER_MEM=8Gi TILER_MIN=1 TILER_MAX=1 TILER_WORKERS=4
        TILER_DB_MAX_CONN=4
    fi
}

resolve_config() {
    ENV="${1:?resolve_config requires prod|dev}"
    if [ "$ENV" != "prod" ] && [ "$ENV" != "dev" ]; then
        echo -e "${RED}Error: environment must be 'prod' or 'dev'${NC}" >&2
        return 1
    fi

    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    [ -n "${SKIP_LOCAL_ENV_FILE:-}" ] || _load_local_env_file "$script_dir/.env.deploy.$ENV"

    if [ -z "${RESOURCE_GROUP:-}" ]; then
        echo -e "${RED}Error: RESOURCE_GROUP not set (environment or .env.deploy.$ENV)${NC}" >&2
        return 1
    fi

    PROJECT_NAME="stacnotator-${ENV}"
    POSTGRES_SERVER="${POSTGRES_SERVER:-}"
    # Both are owned by the raapid-infra Terraform (postgresql module: the databases
    # list and administrator_login). Defaulted rather than looked up because they
    # change approximately never and a lookup would cost a round trip on every
    # deploy; override from the environment if that stops being true. A mismatch
    # shows up as an unhealthy revision with an auth or missing-database error.
    DB_NAME="${DB_NAME:-stacnotator}"
    DB_ADMIN_USER="${DB_ADMIN_USER:-psqladmin}"
    APP_BACKEND="${PROJECT_NAME}-backend"
    APP_TILER="${PROJECT_NAME}-tiler"
    APP_SWA="${PROJECT_NAME}-frontend"

    # The tiler is registered under TILER_NAME and DEFAULT_TILER points at it.
    # TILER_ALLOWS_INGEST drives BOTH the backend's allows_ingest and the tiler's
    # ALLOW_STAC_API_INGEST so they cannot drift: a mismatch makes the backend call
    # /ingest on a tiler that does not expose it.
    TILER_NAME="${TILER_NAME:-hosted}"
    TILER_ALLOWS_INGEST="${TILER_ALLOWS_INGEST:-true}"
    # Opt-in: let the tiler sign Azure blob reads with the apps managed identity so
    # internal-storage custom-map COGs are readable without a SAS.
    TILER_AZURE_SIGNING="${TILER_AZURE_SIGNING:-false}"
    TILER_DEDICATED="${TILER_DEDICATED:-false}"

    # Strip CR/LF that the GitHub variable editor can introduce: a raw control char
    # inside the JSON makes the backend's json.loads(TILERS) reject it at boot.
    EXTRA_TILERS="${EXTRA_TILERS:-}"
    EXTRA_TILERS="${EXTRA_TILERS//$'\r'/}"
    EXTRA_TILERS="${EXTRA_TILERS//$'\n'/}"

    if [ -z "${ACR_NAME:-}" ] || [ -z "${KV_NAME:-}" ] || [ -z "${CAE_NAME:-}" ] ||
        [ -z "${CAE_DEFAULT_DOMAIN:-}" ] || [ -z "${IDENTITY_ID:-}" ]; then
        _discover_resources || return 1
    fi
    ACR_LOGIN_SERVER="$ACR_NAME.azurecr.io"

    # A Container App with external ingress is always <app-name>.<env default domain>.
    # Deriving these instead of reading them back after creation is what removes the
    # last ordering dependency, and with it the second backend revision.
    BACKEND_AZURE_FQDN="${APP_BACKEND}.${CAE_DEFAULT_DOMAIN}"
    TILER_AZURE_FQDN="${APP_TILER}.${CAE_DEFAULT_DOMAIN}"

    _resolve_public_hosts || return 1

    CORS_ORIGINS="https://${FRONTEND_HOST}"
    # CUSTOM_DOMAINS is a comma-separated list of full origins, no trailing slashes.
    [ -n "${CUSTOM_DOMAINS:-}" ] && CORS_ORIGINS="${CORS_ORIGINS},${CUSTOM_DOMAINS}"

    # internal_url stays on the Azure FQDN so backend-to-tiler register/ingest routes
    # inside Azure without depending on public DNS. url is browser-facing.
    local hosted_entry
    hosted_entry="\"$TILER_NAME\":{\"url\":\"https://$TILER_BROWSER_HOST\",\"internal_url\":\"https://$TILER_AZURE_FQDN\",\"allows_ingest\":$TILER_ALLOWS_INGEST}"
    TILERS_JSON="{${hosted_entry}${EXTRA_TILERS:+,${EXTRA_TILERS}}}"

    _resolve_sizing
    _resolve_area_estimation || return 1
    return 0
}

# Opt-in, in two steps (README: "Area estimation worker"). AREA_ESTIMATION_BLOB_URL is
# the blob container the backend keeps maps in while their sampling design is written,
# instead of its own disk. AREA_ESTIMATION_JOB names the Container Apps Job that
# preprocesses them; unset, the backend runs those jobs on a thread of its own. The
# job's ARM id and the identity's client id are what the backend needs to start an
# execution as itself.
_resolve_area_estimation() {
    AREA_ESTIMATION_BLOB_URL="${AREA_ESTIMATION_BLOB_URL:-}"
    AREA_ESTIMATION_JOB="${AREA_ESTIMATION_JOB:-}"
    AREA_ESTIMATION_JOB_ID=""
    IDENTITY_CLIENT_ID=""
    [ -n "$AREA_ESTIMATION_BLOB_URL" ] || [ -n "$AREA_ESTIMATION_JOB" ] || return 0
    if [ -z "$AREA_ESTIMATION_BLOB_URL" ]; then
        echo -e "${RED}AREA_ESTIMATION_JOB needs AREA_ESTIMATION_BLOB_URL: a worker can only share a blob workspace.${NC}" >&2
        return 1
    fi
    IDENTITY_CLIENT_ID=$(az identity show --ids "$IDENTITY_ID" --query clientId -o tsv) || return 1
    [ -n "$AREA_ESTIMATION_JOB" ] || return 0
    AREA_ESTIMATION_JOB_ID=$(az containerapp job show -n "$AREA_ESTIMATION_JOB" -g "$RESOURCE_GROUP" \
        --query id -o tsv 2>/dev/null) || AREA_ESTIMATION_JOB_ID=""
    if [ -z "$AREA_ESTIMATION_JOB_ID" ]; then
        echo -e "${RED}Container Apps Job '$AREA_ESTIMATION_JOB' not found in $RESOURCE_GROUP.${NC}" >&2
        echo -e "${RED}Create it first (README: Area estimation worker) or unset AREA_ESTIMATION_JOB.${NC}" >&2
        return 1
    fi
    return 0
}

# PUBLIC_DOMAIN is required for the hosted tiler to render in a browser: the
# tiler-access cookie is scoped to .<domain> so it reaches the tiler same-site.
# Without it, MPC imagery works but hosted-tiler tiles 401.
_resolve_public_hosts() {
    if [ -n "${PUBLIC_DOMAIN:-}" ]; then
        FRONTEND_HOST="app.$PUBLIC_DOMAIN"
        API_HOST="api.$PUBLIC_DOMAIN"
        TILER_BROWSER_HOST="tiler.$PUBLIC_DOMAIN"
        TILER_COOKIE_DOMAIN=".$PUBLIC_DOMAIN"
        return 0
    fi

    API_HOST="$BACKEND_AZURE_FQDN"
    TILER_BROWSER_HOST="$TILER_AZURE_FQDN"
    TILER_COOKIE_DOMAIN=""
    # The Static Web App hostname is Azure-generated and not derivable, so it is the
    # one value still read back. bootstrap.sh creates the app, so by deploy time it
    # exists; bootstrap.sh itself sets ALLOW_MISSING_SWA because it runs before that.
    FRONTEND_HOST=$(az staticwebapp show --name "$APP_SWA" -g "$RESOURCE_GROUP" \
        --query defaultHostname -o tsv 2>/dev/null) || FRONTEND_HOST=""
    if [ -z "$FRONTEND_HOST" ]; then
        if [ -n "${ALLOW_MISSING_SWA:-}" ]; then
            return 0
        fi
        echo -e "${RED}Static Web App '$APP_SWA' not found and PUBLIC_DOMAIN is unset.${NC}" >&2
        echo -e "${RED}Run ./deployment/azure/bootstrap.sh $ENV first.${NC}" >&2
        return 1
    fi
    return 0
}

mask_resolved_config() {
    ci_mask "$RESOURCE_GROUP" "$ACR_NAME" "$ACR_LOGIN_SERVER" "$KV_NAME" "$CAE_NAME" \
        "$CAE_DEFAULT_DOMAIN" "$IDENTITY_ID" "${EE_SERVICE_ACCOUNT:-}" \
        "${PUBLIC_DOMAIN:-}" "${CUSTOM_DOMAINS:-}" "${POSTGRES_SERVER:-}" \
        "${AREA_ESTIMATION_JOB_ID:-}" "${IDENTITY_CLIENT_ID:-}"
}

print_config() {
    echo -e "${BLUE}Resolved configuration (${ENV})${NC}"
    echo -e "  Backend app:    $APP_BACKEND  (${BACKEND_CPU} CPU, ${BACKEND_MEM}, ${BACKEND_MIN}-${BACKEND_MAX} replicas)"
    echo -e "  Tiler app:      $APP_TILER  (${TILER_CPU} CPU, ${TILER_MEM}, dedicated=${TILER_DEDICATED})"
    echo -e "  Static Web App: $APP_SWA"
    echo -e "  Frontend host:  $FRONTEND_HOST"
    echo -e "  API host:       $API_HOST"
    echo -e "  Tiler host:     $TILER_BROWSER_HOST  (internal $TILER_AZURE_FQDN)"
    echo -e "  CORS_ORIGINS:   $CORS_ORIGINS"
    echo -e "  TILERS:         $TILERS_JSON"
    echo -e "  DEFAULT_TILER:  $TILER_NAME"
    [ -n "$TILER_COOKIE_DOMAIN" ] && echo -e "  TILER_COOKIE_DOMAIN: $TILER_COOKIE_DOMAIN"
    [ -n "$AREA_ESTIMATION_BLOB_URL" ] && echo -e "  Area estimation maps:   $AREA_ESTIMATION_BLOB_URL"
    [ -n "$AREA_ESTIMATION_JOB" ] && echo -e "  Area estimation worker: $AREA_ESTIMATION_JOB"
    return 0
}

# Deployment Scripts

Scripts for deploying STACNotator to Azure. The deploy script self-manages all application resources (Container Apps, Static Web App, identities, RBAC) within the project's resource group.

The same `deploy-app.sh` script runs both from CI (on a self-hosted runner inside our Azure VNet) and manually from a developer laptop on VPN. Application resources are managed by this script rather than Terraform, so app deploys stay independent of the platform-managed (Terraform) infrastructure.

## Environments

| Environment | Backend (CPU/Mem · replicas) | Tiler (CPU/Mem · replicas · profile) |
|---|---|---|
| **prod** | 1 / 2Gi · 1-1 · Consumption | 4 / 8Gi · 0-2 · Consumption |
| **dev**  | 0.5 / 1Gi · 1-1 · Consumption | 4 / 8Gi · 0-1 · Consumption |

Backend is pinned to a single replica (MIN=MAX=1) so the alembic migration
that runs on container startup is serialized by definition. To scale beyond
1 replica, we'd also need to add a `pg_advisory_lock` around `context.run_migrations()`
in `backend/alembic/env.py` (see note in that file). The deploy script has
a `TILER_DEDICATED=true` branch that provisions a D16 dedicated workload
profile for the tiler - currently disabled in both envs; flip the flag in
`deploy-app.sh` if you need it for heavy tile load.

## Architecture

| Component | Azure Service | Managed by |
|-----------|--------------|------------|
| Backend API | Container App (Consumption) | `deploy-app.sh` |
| Tiler | Container App (Consumption) | `deploy-app.sh` |
| Frontend | Azure Static Web App | `deploy-app.sh` |
| Database | PostgreSQL Flexible Server | Terraform |
| Container Apps Environment | Container Apps Environment | Terraform |
| Networking, Key Vault, ACR | Various | Terraform |

## Automated deployments (CI)

`deploy-app.sh` runs from GitHub Actions on a self-hosted runner inside the Azure VNet, authenticating via OIDC (no stored credentials). Both environments are gated by a GitHub Environment with required reviewers, so every deploy waits on a human Approve click.

| Environment | Trigger | Workflow | Gate |
|---|---|---|---|
| **prod** | push to `main` | `deploy-prod` job in `.github/workflows/ci.yml` (runs after tests + image build pass) | `production` Environment approval |
| **dev** | manual `Run workflow` on `develop` | `.github/workflows/deploy-dev.yml` | `dev` Environment approval |

The dev workflow deploys code only and never touches a database. To refresh dev data, run `make az-sync-prod-to-dev` separately (see below). One-time Environment setup for dev is documented under [Deploy Dev workflow](#deploy-dev-workflow-code-only-no-db-sync).

The manual CLI path below is the fallback for local deploys and first-time environment bootstrapping.

## Prerequisites

- **Infrastructure** deployed by Platform Engineers via Terraform (RG, ACR, KV, DB, CAE) for both prod and dev
- **Contributor** role on the project resource group
- **Azure CLI** logged in (`az login`) and within VPN
- **Docker** installed for building images
- **Node.js** installed for building the frontend

## First-Time Setup for local deployments (ONE TIME per environment)

Ensure you have deployed the infrastructure on Azure.

```bash
# 1. Create environment config
cp azure_deploy/.env.deploy.example azure_deploy/.env.deploy.prod
cp azure_deploy/.env.deploy.example azure_deploy/.env.deploy.dev
# Edit each file with the correct RESOURCE_GROUP and DEPLOY_ENV

# 2. Fill in credentials in .env.deploy.prod / .env.deploy.dev
#    (FIREBASE_CREDS, EE_CREDS, FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID)

# 3. Upload application secrets to Key Vault
make az-upload-secrets-prod   # or az-upload-secrets-dev

# 4. Deploy (creates Container Apps, SWA, identities, RBAC, runs migrations)
make az-deploy-prod           # or az-deploy-dev

# 5. Add your frontend domain to Firebase authorized domains
# https://console.firebase.google.com/ -> Authentication -> Settings -> Authorized domains
```

### Tiler database (pgstac) - one-time per environment

The tiler serves tiles from a **pgstac** catalog and connects as a dedicated, least-privilege
role - it does **not** use the backend's database user or tables. This must be bootstrapped once
against the Flexible Server before the tiler can serve, and is **not** done by `deploy-app.sh`
(it needs admin DB privileges the running tiler must never hold).

The full, provider-agnostic procedure and rationale live in the tiler repo:
**`stacnotator-tiler/docs/database.md`**. Run it from a host that can reach the (private) admin
endpoint - on VPN or the self-hosted CI runner. Exact Azure steps (copy-paste, set the two vars
at the top for your environment):

```bash
RG=rg-stacnotator-dev-prod-westeurope        # the env's resource group
PROJECT=stacnotator-dev                        # stacnotator-dev | stacnotator-prod

KV=$(az keyvault list -g "$RG" --query "[0].name" -o tsv)
SERVER=$(az postgres flexible-server list -g "$RG" --query "[0].name" -o tsv)

# 1. Allowlist the extensions pgstac installs (postgis, btree_gist, unaccent). The
#    canonical home is Terraform (azurerm_postgresql_flexible_server_configuration);
#    set it directly if you're bootstrapping ahead of that:
az postgres flexible-server parameter set -g "$RG" -s "$SERVER" \
  --name azure.extensions --value POSTGIS,BTREE_GIST,UNACCENT

# 2. Pull the admin creds + host from Key Vault and generate the tiler role password:
ADMIN_PW=$(az keyvault secret show --vault-name "$KV" --name "${PROJECT}-postgres-admin-password" --query value -o tsv)
PGHOST_VAL=$(az keyvault secret show --vault-name "$KV" --name "${PROJECT}-postgres-host" --query value -o tsv)
TILER_PW=$(openssl rand -base64 24)

# 3. Bootstrap pgstac as psqladmin. Creates the `pgstac` database, installs pgstac,
#    and creates the least-privilege `tiler_app` login role (member of pgstac_ingest):
cd ../stacnotator-tiler
pip install "pypgstac[psycopg]==0.9.5"
PGHOST="$PGHOST_VAL" PGUSER=psqladmin PGPASSWORD="$ADMIN_PW" PGSSLMODE=require \
TILER_DB_PASSWORD="$TILER_PW" ./scripts/bootstrap-pgstac.sh

# 4. Store the tiler role password in Key Vault. deploy-app.sh wires it into the tiler
#    Container App as the `tiler-db-password` secret (separate from the backend's db-password):
az keyvault secret set --vault-name "$KV" --name tiler-db-password --value "$TILER_PW"
```

The tiler Container App then runs with `PGDATABASE=pgstac`, `PGUSER=tiler_app`,
`PGSSLMODE=require`, and `PGPASSWORD` from `tiler-db-password` - all set by `deploy-app.sh`.

Upgrading pgstac later: bump the `pypgstac` pin and re-run `pypgstac migrate` as admin (see the
tiler doc). The runtime `tiler_app` role is unaffected.

### Custom domains - one-time per environment (required for hosted-tiler tiles)

Tile access is authorized by an `HttpOnly` cookie the backend sets. The browser only sends it
to the tiler if the tiler shares a **registrable domain** with the app. With the default Azure
hostnames (`*.azurestaticapps.net` for the SWA, `*.azurecontainerapps.io` for the Container Apps)
they're different domains, so hosted-tiler tiles **401 in the browser** (MPC still works - MPC
tiles don't use our cookie). Fix: put all three under one parent domain per environment.

Pick a per-env parent so dev and prod cookies don't bleed into each other (`dev` shown; for
prod drop the `dev.` and use the prod resources / RG):

| Env  | Parent (`PUBLIC_DOMAIN`) | Frontend            | Backend             | Tiler                 |
|------|--------------------------|---------------------|---------------------|-----------------------|
| dev  | `dev.stacnotator.io`     | `app.dev.stacnotator.io` | `api.dev.stacnotator.io` | `tiler.dev.stacnotator.io` |
| prod | `stacnotator.io`         | `app.stacnotator.io`     | `api.stacnotator.io`     | `tiler.stacnotator.io`     |

**1. Gather the record values** (resources must already be deployed):

```bash
RG=rg-stacnotator-dev-prod-westeurope
az staticwebapp show -n stacnotator-dev-frontend -g "$RG" --query defaultHostname -o tsv          # app.* CNAME target
az containerapp show -n stacnotator-dev-backend  -g "$RG" --query properties.configuration.ingress.fqdn -o tsv  # api.* CNAME target
az containerapp show -n stacnotator-dev-tiler    -g "$RG" --query properties.configuration.ingress.fqdn -o tsv  # tiler.* CNAME target
az containerapp show -n stacnotator-dev-backend  -g "$RG" --query properties.customDomainVerificationId -o tsv  # asuid TXT value (same for both apps - subscription-scoped)
```

**2. Hand these DNS records to whoever manages the `stacnotator.io` zone:**

| Host / Name | Type | Value |
|---|---|---|
| `app.dev` | CNAME | `<swa-defaultHostname>` |
| `api.dev` | CNAME | `<backend-fqdn>` |
| `asuid.api.dev` | TXT | `<verificationId>` |
| `tiler.dev` | CNAME | `<tiler-fqdn>` |
| `asuid.tiler.dev` | TXT | `<verificationId>` |

The `asuid.*` TXT value is identical for both apps. A later `tiler-gcp.dev` (GCP tiler) is added
the same way once that tiler exists.

**3. After DNS resolves, bind the domains + issue managed certs:**

```bash
CAE=$(az containerapp env list -g "$RG" --query "[0].name" -o tsv)
az staticwebapp hostname set  -n stacnotator-dev-frontend -g "$RG" --hostname app.dev.stacnotator.io
az containerapp hostname add  -n stacnotator-dev-backend  -g "$RG" --hostname api.dev.stacnotator.io
az containerapp hostname bind -n stacnotator-dev-backend  -g "$RG" --hostname api.dev.stacnotator.io --environment "$CAE" --validation-method CNAME
az containerapp hostname add  -n stacnotator-dev-tiler    -g "$RG" --hostname tiler.dev.stacnotator.io
az containerapp hostname bind -n stacnotator-dev-tiler    -g "$RG" --hostname tiler.dev.stacnotator.io --environment "$CAE" --validation-method CNAME
```

Bindings persist on the resource, so steps 1-3 are one-time per environment.

**4. Set `PUBLIC_DOMAIN`** (after certs report Succeeded) - in `.env.deploy.<env>` for local, or the
`PUBLIC_DOMAIN_DEV` / `PUBLIC_DOMAIN_PROD` GitHub Actions **variable** for CI - then redeploy. The
deploy builds the frontend against `api.<domain>`, points `TILERS` at `https://tiler.<domain>`
(browser-facing) with `internal_url` on the Azure FQDN (backend->tiler stays in-Azure), sets
`CORS_ORIGINS` to `https://app.<domain>`, and sets `TILER_COOKIE_DOMAIN=.<domain>`. `SameSite=lax`
+ `Secure` (defaults) then work because all three are same-site.

### Base image cache - one-time per registry

`az acr build` pulls the `python` base from Docker Hub; the shared ACR build IP hits Docker
Hub's anonymous rate limit. Fix: pull the base through an **ACR cache** authenticated with a
Docker Hub token, once per registry.

```bash
# Docker Hub creds in Key Vault (free account + read-only PAT)
az keyvault secret set --vault-name $KV --name dockerhub-username --value "<user>"
az keyvault secret set --vault-name $KV --name dockerhub-pat      --value "<PAT>"

# Credential set + grant it KV read
az acr credential-set create -r $ACR -n dockerhub -l docker.io \
  --username-id "https://$KV.vault.azure.net/secrets/dockerhub-username" \
  --password-id "https://$KV.vault.azure.net/secrets/dockerhub-pat"
PID=$(az acr credential-set show -r $ACR -n dockerhub --query 'identity.principalId' -o tsv)
az role assignment create --assignee "$PID" --role "Key Vault Secrets User" \
  --scope "$(az keyvault show -n $KV --query id -o tsv)"

# Cache rule: one rule covers all python tags (backend + tiler)
az acr cache create -r $ACR -n python -s docker.io/library/python -t python -c dockerhub
```

The Dockerfiles take a `PYTHON_IMAGE` build arg (default Docker Hub for local/GCP); the deploy
scripts override it to `$ACR_LOGIN_SERVER/python:<tag>` so CI builds pull from the cache. No
Docker Hub secret is needed in CI - only in the cred set. To use a newer base tag, nothing to do
(the cache auto-pulls it).

## Manual deployment (local CLI)

Prod and dev normally deploy from CI (see [Automated deployments](#automated-deployments-ci)). Use this path for local/manual deploys from a developer laptop on VPN, or for first-time bootstrapping.

```bash
# Commit changes first (deploy prevents uncommitted changes)
git add -A && git commit -m "your changes"

# Deploy to prod
make az-deploy-prod

# Deploy to dev
make az-deploy-dev
```

The script will:
1. Discover infrastructure (ACR, KV, CAE) from the resource group
2. Build and push Docker images (backend + tiler) to ACR
3. Create or update Container Apps with KV secret refs (no plaintext credentials)
4. If `TILER_DEDICATED=true`: add a D16 dedicated workload profile for the tiler. Off by default in both envs; the consumption profile handles current load.
5. Poll the new backend revision until `healthState=Healthy`. Migrations run as part of container startup (`alembic upgrade head` in the Dockerfile CMD before gunicorn) - a failed migration leaves the new revision unhealthy and Container Apps keeps the previous revision serving 100% traffic (automatic rollback).
6. Build and deploy frontend to Azure Static Web App
7. Update CORS on backend + tiler

**Image tagging**: defaults to git commit SHA. Override with `IMAGE_TAG` env var.

**Migrations**: triggered by the new backend container starting, not by this script. To run alembic against a specific revision manually (e.g. for inspection), use:

```bash
az containerapp exec -n stacnotator-prod-backend -g <rg> --command "alembic current"
```

Note that `az containerapp exec` requires a TTY-capable shell - it fails inside non-interactive CI runners. Local interactive terminals are fine.

## Dev Environment with Production Data

Refreshing dev from prod is a **manual** step. Run it from a developer laptop on VPN.

```bash
make az-sync-prod-to-dev
```

This will:
1. Dump the production database (`pg_dump` only, no writes to prod)
2. Drop and recreate the dev database
3. Restore the dump into dev
4. Run migrations via the dev backend container app (typically a no-op now that the container also runs `alembic upgrade head` on startup, but kept as a safety net in case the dev replica wasn't restarted after the restore).

The script reads prod creds from the prod Key Vault at runtime (using your interactive `az login`) and aborts if source and target hosts match or the target doesn't look like the dev server.

### Deploy Dev workflow (code only, no DB sync)

The `Deploy Dev` GitHub Actions workflow (`.github/workflows/deploy-dev.yml`) builds and deploys backend, tiler, and frontend to the dev Azure environment. It does **not** touch any database - neither dev nor prod. To refresh dev data from prod, use the manual `make az-sync-prod-to-dev` flow above.

Safety relies on:
- The OIDC identity (`id-cicd-stacnotator-dev-westeurope`) being federated only to `refs/heads/develop` and scoped to the dev resource group. It has zero prod RBAC.
- No prod credentials anywhere CI can read - prod KV is untouched by this workflow, and nothing is mirrored into the dev KV.
- The workflow being **manual-only** (`workflow_dispatch`), gated by the **`dev` GitHub Environment** with required reviewers matching the `production` Environment. Every deploy waits on a human Approve click.
- `if: github.ref == 'refs/heads/develop'` skipping the job for any other branch ref, plus the Environment's "Deployment branches" restriction set to `develop`.

#### One-time setup (do this before the first CI dev deploy)

1. **Configure GitHub Environment secrets on the `dev` Environment** (Settings → Environments → `dev` → Environment secrets). These mirror how the prod deploy reads its secrets from the `production` Environment. (The one exception is `TILER_REPO_TOKEN`, which must be repo-level - see step 2.)

   | Secret | Value |
   |---|---|
   | `AZURE_CLIENT_ID_DEV` | Client ID of `id-cicd-stacnotator-dev-westeurope` (from `az identity show -n id-cicd-stacnotator-dev-westeurope -g <main-platform-rg> --query clientId -o tsv`) |
   | `AZURE_RESOURCE_GROUP_DEV` | `rg-stacnotator-dev-prod-westeurope` (or whatever the dev RG is named) |
   | `EE_SERVICE_ACCOUNT_DEV` | Same Earth Engine SA used in `.env.deploy.dev` |

   `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID` are shared with the prod workflow. Check where they live by opening Settings → Environments → `production` → Environment secrets:
   - If they're listed there, copy them into the `dev` Environment too.
   - If they're not listed there, they're Organization secrets (Settings → Organization → Secrets and variables → Actions). Make sure the `dev` Environment is allowed in their access policy.

2. **Add the tiler-repo checkout token + ref at the REPOSITORY level** (Settings → Secrets and variables → Actions). The tiler lives in its own private repo (`RAAPID-ORG/stacnotator-tiler`); the deploy jobs **and** the non-environment `docker-build` job (PR/push to `main`) check it out. Because `docker-build` is not environment-scoped, it can't read Environment secrets - so these are repository-level:

   | Repository **secret** | Value |
   |---|---|
   | `TILER_REPO_TOKEN` | Token with `contents:read` on `RAAPID-ORG/stacnotator-tiler` (fine-grained PAT or GitHub App token). Without it the tiler checkout fails. |

   | Repository **variable** (optional) | Value |
   |---|---|
   | `TILER_REPO_REF` | Git ref of the tiler repo to build/deploy. Defaults to `main` if unset. |

3. **Set the public domain as an Environment variable** - only needed once the custom domains are bound (see [Custom domains](#custom-domains---one-time-per-environment-required-for-hosted-tiler-tiles) above). These are per-environment **variables** (not secrets), set alongside the secrets in each Environment:

   | Environment | Variable | Value |
   |---|---|---|
   | `dev` | `PUBLIC_DOMAIN_DEV` | `dev.stacnotator.io` |
   | `production` | `PUBLIC_DOMAIN_PROD` | `stacnotator.io` |

   Until set, deploys use the default Azure hostnames: MPC imagery works, but hosted-tiler tiles 401 in the browser (cross-domain cookie).

4. **Create the `dev` GitHub Environment** under Settings → Environments → New environment → name it `dev`. The workflow references `environment: dev` (matching how the prod deploy references `environment: production`), so the job will not start until this Environment exists. Configure it as follows:

   - **Required reviewers**: mirror the list from the `production` Environment.
   - **Deployment branches**: restrict to `develop` only (Selected branches → add `develop`).
   - **Wait timer**: leave at 0.

   After this is set up, every click of "Run workflow" will pause for an explicit approval from a reviewer before the job starts.

After this, hitting **Run workflow** on `Deploy Dev` from the `develop` branch will: wait for reviewer approval → deploy backend/tiler/frontend to dev. If you want fresh prod data in dev afterwards, run `make az-sync-prod-to-dev` from your laptop on VPN.

## Scripts

| Script | When | Purpose |
|--------|------|---------|
| `deploy-app.sh` | Every deployment | Build, push, create/update apps, migrate, deploy SWA |
| `upload-secrets.sh` | First time only | Upload Firebase + EE credentials + generate tiler auth secret to Key Vault |
| `download-prod-db.sh` | As needed | Pull production DB to local development |
| `sync-prod-data-to-dev.sh` | As needed | Sync production DB to dev Azure environment |
| `dev-restore-backup.sh` | As needed | Restore a local SQL dump into the dev stack (wipe, restore, migrate, restart) |
| `grant-admin.sh` | After first deploy | Grant `approved` + `admin` roles to a user by Firebase UID |
| `view-logs.sh` | Debugging | Stream real-time logs from Container Apps |

## Makefile Targets

```bash
make az-deploy-prod          # Deploy to production
make az-deploy-dev           # Deploy to dev (smaller resources)
make az-sync-prod-to-dev     # Sync prod DB to dev + run migrations
make az-logs-prod             # View prod backend logs (APP=tiler for tiler)
make az-logs-dev              # View dev backend logs (APP=tiler for tiler)
make az-upload-secrets-prod  # Upload secrets to prod KV
make az-upload-secrets-dev   # Upload secrets to dev KV
```

## Environment Configuration

Per-environment config files in `azure_deploy/`:

```
.env.deploy.prod     # DEPLOY_ENV=prod
.env.deploy.dev      # DEPLOY_ENV=dev
.env.deploy.example  # Template
```

All scripts take `prod` or `dev` as a positional argument. The matching `.env.deploy.<env>` file and its associated resource group is loaded automatically.

## Tiler Authentication

The tiler service requires authentication to prevent unauthorized tile access. This uses an HMAC-signed token:

1. **Backend** issues short-lived tokens (1hr) to approved users via `GET /api/auth/tiler-token`
2. **Frontend** fetches this token and attaches it to all tiler requests
3. **Tiler** verifies the HMAC signature using a shared secret

The shared secret (`tiler-token-secret`) is auto-generated by `upload-secrets.sh` and stored in Key Vault. Both backend and tiler reference it via `keyvaultref:`. No manual secret management is needed - just run `upload-secrets.sh` once per environment.

For local development, a default dev secret is used automatically when `TILER_TOKEN_SECRET` is not set.

## Database Access

The database is accessible via:
- **Container Apps**: private endpoint (VNet-routed, no public exposure)
- **Admin scripts**: public access restricted to VPN IP ranges only

For local DB dumps, connect via VPN and use `download-prod-db.sh`.

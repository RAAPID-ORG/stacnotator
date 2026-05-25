# Deployment Scripts

Scripts for deploying STACNotator to Azure. The deploy script self-manages all application resources (Container Apps, Static Web App, identities, RBAC) within the project's resource group.

Using CLI instead of Terraform to avoid VNet restrictions from GH runners for now. Once we move to a production-ready version, we should migrate this to a runner in our Azure VNet.

## Environments

| Environment | Backend (CPU/Mem · replicas) | Tiler (CPU/Mem · replicas · profile) |
|---|---|---|
| **prod** | 1 / 2Gi · 1-1 · Consumption | 4 / 8Gi · 0-2 · Consumption |
| **dev**  | 0.5 / 1Gi · 1-1 · Consumption | 4 / 8Gi · 0-1 · Consumption |

Backend is pinned to a single replica (MIN=MAX=1) so the alembic migration
that runs on container startup is serialized by definition. To scale beyond
1 replica, also add a `pg_advisory_lock` around `context.run_migrations()`
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

## Prerequisites

- **Infrastructure** deployed by Platform Engineers via Terraform (RG, ACR, KV, DB, CAE) for both prod and dev
- **Contributor** role on the project resource group
- **Azure CLI** logged in (`az login`) and within VPN
- **Docker** installed for building images
- **Node.js** installed for building the frontend

## First-Time Setup for local deployments (ONE TIME per environment)

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

## Regular Deployments

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

1. **Configure GitHub Environment secrets on the `dev` Environment** (Settings → Environments → `dev` → Environment secrets). These mirror how the prod deploy reads its secrets from the `production` Environment - there are no repo-level secrets on this project.

   | Secret | Value |
   |---|---|
   | `AZURE_CLIENT_ID_DEV` | Client ID of `id-cicd-stacnotator-dev-westeurope` (from `az identity show -n id-cicd-stacnotator-dev-westeurope -g <main-platform-rg> --query clientId -o tsv`) |
   | `AZURE_RESOURCE_GROUP_DEV` | `rg-stacnotator-dev-prod-westeurope` (or whatever the dev RG is named) |
   | `EE_SERVICE_ACCOUNT_DEV` | Same Earth Engine SA used in `.env.deploy.dev` |

   `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID` are shared with the prod workflow. Check where they live by opening Settings → Environments → `production` → Environment secrets:
   - If they're listed there, copy them into the `dev` Environment too.
   - If they're not listed there, they're Organization secrets (Settings → Organization → Secrets and variables → Actions). Make sure the `dev` Environment is allowed in their access policy.

2. **Create the `dev` GitHub Environment** under Settings → Environments → New environment → name it `dev`. The workflow references `environment: dev` (matching how the prod deploy references `environment: production`), so the job will not start until this Environment exists. Configure it as follows:

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
| `make-staging-env.sh` | Before risky deploys | Test migrations against production DB copy (local) |
| `sync-prod-data-to-dev.sh` | As needed | Sync production DB to dev Azure environment |
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

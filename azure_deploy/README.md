# Deployment Scripts

Scripts for deploying STACNotator to Azure. The deploy script self-manages all application resources (Container Apps, Static Web App, identities, RBAC) within the project's resource group.

Using CLI instead of Terraform to avoid VNet restrictions from GH runners for now. Once we move to a production-ready version, we should migrate this to a runner in our Azure VNet.

## Environments

| Environment | Tiler Profile | Min Replicas |
|-------------|---------------|---------------|--------------|
| **prod** | D16 dedicated (16 CPU, 32Gi) | 1 |
| **dev**  | Consumption (1 CPU, 2Gi) | 0 |

## Architecture

| Component | Azure Service | Managed by |
|-----------|--------------|------------|
| Backend API | Container App (Consumption) | `deploy-app.sh` |
| Tiler | Container App (D16 dedicated in prod, consumption in dev) | `deploy-app.sh` |
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

## First-Time Setup (ONE TIME per environment)

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
4. For prod: add D16 dedicated workload profile for tiler (16 CPU, 32Gi, 32 workers)
5. Run database migrations (`alembic upgrade head`)
6. Build and deploy frontend to Azure Static Web App
7. Update CORS on backend + tiler

**Image tagging**: defaults to git commit SHA. Override with `IMAGE_TAG` env var.

## Dev Environment with Production Data

To sync prod data into the dev Azure Postgres and run migrations:

```bash
make az-sync-prod-to-dev
```

This will:
1. Dump the production database
2. Drop and recreate the dev database
3. Restore the dump into dev
4. Run migrations via the dev backend container app

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

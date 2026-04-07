# Deployment Scripts

Scripts for deploying STACNotator to Azure. The deploy script self-manages all application resources (Container Apps, Static Web App, identities, RBAC) within the project's resource group.

Using CLI instead of Terraform to avoid VNet restrictions from GH runners for now. Once we move to a production-ready version, we should migrate this to a runner in our Azure VNet.

## Architecture

| Component | Azure Service | Managed by |
|-----------|--------------|------------|
| Backend API | Container App (Consumption) | `deploy-app.sh` |
| Tiler | Container App (D16 dedicated, 16 CPU) | `deploy-app.sh` |
| Frontend | Azure Static Web App | `deploy-app.sh` |
| Database | PostgreSQL Flexible Server | Terraform |
| Container Apps Environment | Container Apps Environment | Terraform |
| Networking, Key Vault, ACR | Various | Terraform |

## Prerequisites

- **Infrastructure** deployed by Platform Engineers via Terraform (RG, ACR, KV, DB, CAE)
- **Contributor** role on the project resource group
- **Azure CLI** logged in (`az login`) and within VPN
- **Docker** installed for building images
- **Node.js** installed for building the frontend

## First-Time Setup (ONE TIME)

```bash
# 1. Upload application secrets to Key Vault
export RESOURCE_GROUP="your-resource-group"
export EE_CREDS="backend/config/ee-private-key.json"
export FIREBASE_CREDS="backend/config/firebase-credentials.json"
export FIREBASE_API_KEY="your-firebase-api-key"
export FIREBASE_AUTH_DOMAIN="your-app.firebaseapp.com"
export FIREBASE_PROJECT_ID="your-firebase-project"
./azure_deploy/upload-secrets.sh

# 2. Deploy (creates Container Apps, SWA, identities, RBAC, runs migrations)
./azure_deploy/deploy-app.sh

# 3. Add your frontend domain to Firebase authorized domains
# https://console.firebase.google.com/ -> Authentication -> Settings -> Authorized domains
```

## Regular Deployments

```bash
# Commit changes first (deploy prevents uncommitted changes)
git add -A && git commit -m "your changes"

# Deploy
export RESOURCE_GROUP="your-resource-group"
./azure_deploy/deploy-app.sh
```

The script will:
1. Discover infrastructure (ACR, KV, CAE) from the resource group
2. Build and push Docker images (backend + tiler) to ACR
3. Create or update Container Apps with KV secret refs (no plaintext credentials)
4. Add D16 dedicated workload profile for tiler (16 CPU, 32Gi, 32 workers)
5. Run database migrations (`alembic upgrade head`)
6. Build and deploy frontend to Azure Static Web App
7. Update CORS on backend + tiler

**Image tagging**: defaults to git commit SHA. Override with `IMAGE_TAG` env var.

## Scripts

| Script | When | Purpose |
|--------|------|---------|
| `deploy-app.sh` | Every deployment | Build, push, create/update apps, migrate, deploy SWA |
| `upload-secrets.sh` | First time only | Upload Firebase + EE credentials to Key Vault |
| `download-prod-db.sh` | As needed | Pull production DB to local development |
| `make-staging-env.sh` | Before risky deploys | Test migrations against production DB copy |
| `view-logs.sh` | Debugging | Stream real-time logs from Container Apps |

## Environment Variables

Set `RESOURCE_GROUP` before running any script:

```bash
cp azure_deploy/.env.deploy.example azure_deploy/.env.deploy
source azure_deploy/.env.deploy
```

For CI/CD:
```bash
export RESOURCE_GROUP="your-rg" CI=true
./azure_deploy/deploy-app.sh
```

## Database Access

The database is accessible via:
- **Container Apps**: private endpoint (VNet-routed, no public exposure)
- **Admin scripts**: public access restricted to VPN IP ranges only

For local DB dumps, connect via VPN and use `download-prod-db.sh`.

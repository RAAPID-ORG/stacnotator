# Deployment Scripts

Scripts for deploying STAC Notator applications to Azure Container Apps.

## Prerequisites

### Infrastructure (Platform Engineers)

**Infrastructure must be deployed first** by Platform Engineers using the `raapid-infra` Terraform repository.

The infrastructure includes:
- Azure Container Registry (ACR)
- Azure Container Apps Environment
- Container Apps (backend, frontend) with infrastructure secrets only
- PostgreSQL Flexible Server with PostGIS
- Azure Key Vault with database credentials
- Managed identities and RBAC permissions

### Logged into Azure CLI with sufficient RBAC permissions and within VPN.

## Developer Workflow

### First-Time Setup (ONE TIME)

After infrastructure is deployed by Platform Engineers:

```bash
# 1. Upload application secrets to Key Vault
export EE_CREDS="backend/config/ee-private-key.json"
export FIREBASE_CREDS="backend/config/firebase-adminsdk.json"
export FIREBASE_API_KEY="your-firebase-api-key"
export FIREBASE_AUTH_DOMAIN="your-app.firebaseapp.com"
export FIREBASE_PROJECT_ID="your-firebase-project"
./azure_deploy/upload-secrets.sh

# 2. Configure container apps to use the secrets
./azure_deploy/configure-app-secrets.sh

# 3. Deploy application for the first time
./azure_deploy/deploy-app.sh

# 4. Configure authorized domains in Firebase Console
# Go to: https://console.firebase.google.com/
# → Authentication → Settings → Authorized domains
# → Add your Container App frontend domain
```

### Regular Deployments

For subsequent code changes (after first-time setup):

```bash
# From the stacnotator directory
./azure_deploy/deploy-app.sh
```

**Image Tagging:**
- By default, uses git commit SHA (e.g., `a1b2c3d`)
- **Prevents deployment if uncommitted changes detected** (ensures deployments are traceable)
- Override with `IMAGE_TAG` env var if needed
- CI mode (`CI=true`) allows uncommitted changes

**Deployment Confirmation:**
- Shows what will be changed (resource group, images, container apps)
- Prompts for confirmation before proceeding
- Skipped in CI/CD (when `CI=true`)

This script will:
1. Check for uncommitted changes (fails if found, unless `IMAGE_TAG` is set)
2. Verify infrastructure exists
3. Show deployment plan and prompt for confirmation
3. Build Docker images (backend & frontend)
4. Push images to ACR
5. Update container apps with new images
6. Configure CORS and environment variables

### Environment Variables (Optional)

To skip interactive prompts (useful for CI/CD, once we et this up):

```bash
export RESOURCE_GROUP="rg-stacnotator-prod-northeurope"
export IMAGE_TAG="v1.2.3"  # Optional - defaults to git commit SHA
export CI=true             # Skip confirmation prompt

./azure_deploy/deploy-app.sh
```

## Additional Scripts

### Viewing Logs

```bash
# View backend logs
./azure_deploy/view-logs.sh

# Then select: backend
```

This will stream real-time logs from the selected container app.

## Default Values

- **Resource Group**: `rg-stacnotator-prod-northeurope` (configured in Terraform)
- **Image Tag**: `latest` (prompted during deployment)
- **Backend App Name**: `backend`
- **Frontend App Name**: `frontend`
- **ACR Name**: Automatically discovered from resource group
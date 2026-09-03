# Deployment Scripts

Scripts for deploying STACNotator to Azure. They self-manage all application resources (Container Apps, Static Web App, identities, RBAC) within the project's resource group, so app deploys stay independent of the platform-managed infrastructure.

## How deployments work

Two scripts, split by lifecycle:

| Script | When | What |
|---|---|---|
| `bootstrap.sh <env>` | Once per environment, and on credential rotation | Upload Firebase + Earth Engine credentials, generate the shared secrets when absent, create the Static Web App, add the tiler workload profile |
| `deploy.sh <env>` | Every release | Resolve config, build backend + tiler + frontend concurrently, one write per resource, gate on backend health |

A release reaches Azure one of two ways, and both run the *same* `deploy.sh`. They differ only in where the identifiers come from and who approves.

### Scenario A - deploy from CI (the normal path)

CI runs **`deploy.sh` only - never `bootstrap.sh`**. Almost every identifier a deploy needs is already in the GitHub Environment, but bootstrap's inputs are not: it uploads the Firebase and Earth Engine credential *JSON files*, and CI holds no path to them. So a new environment is bootstrapped by hand once, and until it is, a CI deploy fails - the Key Vault secrets it wires in as `keyvaultref:` and the Static Web App it uploads the frontend to would not exist.

Once per environment, before the first CI deploy:

1. Platform infrastructure (RG, ACR, KV, DB, CAE) deployed externally by Platform Engineers.
2. `bootstrap.sh <env>` run from a laptop on VPN - see [Run once per environment](#run-once-per-environment).
3. pgstac tiler database bootstrapped - see [Tiler database](#tiler-database-pgstac---one-time-per-environment). Before the first deploy, not after: the tiler Container App references the `tiler-db-password` secret that step writes to Key Vault.
4. The GitHub Environment (`dev` or `production`) created, with its secrets, variables and reviewers - see [One-time setup](#one-time-setup-do-this-before-the-first-ci-dev-deploy).

The **first** deploy can then run from CI like any other - there is no local-only step left. `deploy.sh` creates the Container Apps when they are absent and updates them when they are not, it assigns no roles (the managed identity comes from Terraform), and the Static Web App already exists from bootstrap. It only needs the deploy identity to hold Contributor on the resource group, and the code to be on the branch that triggers the workflow.

Custom domains come last, because binding them needs the apps to exist: deploy once on the default Azure hostnames, bind the domains, set `PUBLIC_DOMAIN`, deploy again. Until then MPC imagery works but hosted-tiler tiles 401 in the browser. See [Custom domains](#custom-domains---one-time-per-environment-required-for-hosted-tiler-tiles).

Per release: push to `main` (prod), or hit **Run workflow** on `Deploy Dev` from `develop`, then approve the Environment gate. See [Automated deployments](#automated-deployments-ci).

### Scenario B - deploy manually from a laptop

The fallback for local deploys, and the only way to run the bootstrap itself. Same one-time list minus step 4, plus a local `deployment/azure/.env.deploy.<env>` supplying what CI holds in its Environment, and the tooling in [Prerequisites](#prerequisites) (`az login` on VPN, sibling tiler checkout, Node).

Per release: `make az-deploy-<env>`. See [Manual deployment](#manual-deployment-local-cli).

Neither path touches a database beyond the `alembic upgrade head` the backend container runs at startup. Refreshing dev from prod is always the separate, manual `make az-sync-prod-to-dev`.

`env.sh` is sourced by both scripts and holds the config resolution. It contains no resource group, domain, service account or project id: the repo is public, so identifiers arrive from the environment - GitHub Environment secrets and variables in CI, `.env.deploy.<env>` on a laptop.

### Inside a deploy

Every value a deploy needs is derived before the first write. A Container App with external ingress is always `<app-name>.<CAE default domain>`, and with `PUBLIC_DOMAIN` set the browser-facing hosts are string construction, so nothing has to be read back mid-deploy. That means each resource is written exactly once and the backend produces a **single revision** per deploy, with one alembic run and one unambiguous health gate.

The backend, tiler and frontend builds are independent and run concurrently; each stage's output is buffered and printed when it is joined, so parallel logs stay readable. The tiler image is tagged with the tiler repo's own commit SHA.

`./deployment/azure/deploy.sh <env> --dry-run` resolves the config, prints every value and every command it would run, and writes nothing.

## Environments

| Environment | Backend (CPU/Mem · replicas) | Tiler (CPU/Mem · replicas · profile) |
|---|---|---|
| **prod** | 1 / 2Gi · 1-1 · Consumption | 4 / 8Gi · 1-1 · Consumption |
| **dev**  | 2 / 4Gi · 1-1 · Consumption | 4 / 8Gi · 1-1 · Consumption |

Backend is pinned to a single replica (MIN=MAX=1) so the alembic migration
that runs on container startup is serialized by definition. To scale beyond
1 replica, we'd also need to add a `pg_advisory_lock` around `context.run_migrations()`
in `backend/alembic/env.py` (see note in that file). Sizing lives in `_resolve_sizing`
in `env.sh`, next to the connection-budget arithmetic that constrains it. Setting
`TILER_DEDICATED=true` provisions a D8 dedicated workload profile for the tiler -
currently off in both envs; turn it on if you need it for heavy tile load.

## Architecture

| Component | Azure Service | Managed by |
|-----------|--------------|------------|
| Backend API | Container App (Consumption) | `deploy.sh` |
| Tiler | Container App (Consumption) | `deploy.sh` |
| Frontend | Azure Static Web App | `deploy.sh` |
| Database | PostgreSQL Flexible Server | External |
| Container Apps Environment | Container Apps Environment | External |
| Networking, Key Vault, ACR | Various | External |

## Automated deployments (CI)

CI runs `deploy.sh` only. The environment must already be bootstrapped from a laptop ([Run once per environment](#run-once-per-environment)) and its GitHub Environment configured ([One-time setup](#one-time-setup-do-this-before-the-first-ci-dev-deploy)).

`deploy.sh` runs from GitHub Actions on a GitHub-hosted runner, authenticating via OIDC (no stored credentials). Both environments are gated by a GitHub Environment with required reviewers, so every deploy waits on a human Approve click.

The job reaches nothing private: every step is the ARM control plane, ACR (which builds server-side and is publicly reachable), or a public upload endpoint. Migrations run on backend container startup, inside the VNet, not from CI. A step that did need the VNet would have to run on the platform's shared self-hosted runners, which GitHub advises against for a public repository - so keep the deploy on public endpoints.

Both callers share `.github/workflows/deploy.yml`, a reusable workflow taking the GitHub Environment to use and the argument for `deploy.sh`. All deploy mechanics live there; the callers differ only in which environment they select.

| Environment | Trigger | Workflow | Gate |
|---|---|---|---|
| **prod** | push to `main` | `deploy-prod` job in `.github/workflows/ci.yml` (runs after tests + image build pass) | `production` Environment approval |
| **dev** | manual `Run workflow` on `develop` | `.github/workflows/deploy-dev.yml` | `dev` Environment approval |

The dev workflow deploys code only and never touches a database. To refresh dev data, run `make az-sync-prod-to-dev` separately (see below) - note this clears all existing dev data. One-time Environment setup for dev is documented under [Deploy Dev workflow](#deploy-dev-workflow-code-only-no-db-sync).

The manual CLI path below is the fallback for local deploys and first-time environment bootstrapping.

## Prerequisites

- **Infrastructure** deployed by Platform Engineers externally (RG, ACR, KV, DB, CAE) for both prod and dev
- **Contributor** role on the project resource group
- **Azure CLI** logged in (`az login`) and within VPN
- **Tiler repo** checked out next to this one (`../stacnotator-tiler`, or set `TILER_REPO_DIR`) - the deploy delegates the tiler build/deploy to its `deployment/deploy-containerapp.sh` and aborts if it's missing
- **Node.js** installed for building the frontend (images are built server-side via `az acr build`, no local Docker needed)

## Run once per environment

Required for both deploy paths. Run it from a laptop on VPN, after the infrastructure is deployed on Azure.

`bootstrap.sh` reads `RESOURCE_GROUP` (which CI has, as `AZURE_RESOURCE_GROUP`) plus five values that exist nowhere but a laptop: `FIREBASE_CREDS` and `EE_CREDS`, the paths to the credential JSON files it uploads, and `FIREBASE_API_KEY` / `FIREBASE_AUTH_DOMAIN` / `FIREBASE_PROJECT_ID`, the frontend's Firebase client config. `TILER_DEDICATED` is optional. That short list is why bootstrap is manual; everything else it needs it discovers from the resource group.

```bash
# 1. Create the local config (needed here even if releases go out from CI,
#    which reads GitHub Environments instead)
cp deployment/azure/.env.deploy.example deployment/azure/.env.deploy.dev
# Fill in RESOURCE_GROUP, PUBLIC_DOMAIN, EE_SERVICE_ACCOUNT, and the credential
# paths. bootstrap.sh uploads (FIREBASE_CREDS, EE_CREDS, FIREBASE_*).

# 2. Upload secrets, create the Static Web App, add the workload profile
make az-bootstrap-dev         # or az-bootstrap-prod

# 3. First deploy (creates the Container Apps, runs migrations on startup).
#    Equally fine from CI once the GitHub Environment is set up.
make az-deploy-dev            # or az-deploy-prod

# 4. Add the frontend domain to Firebase authorized domains
# https://console.firebase.google.com/ -> Authentication -> Settings -> Authorized domains
```

`bootstrap.sh` is idempotent and only generates `tiler-token-secret` and `apikey-encryption-secret` when they are absent, so re-running it is safe.

## Run on every release

```bash
make az-deploy-dev            # or: ./deployment/azure/deploy.sh dev
make az-deploy-dev-dry-run    # resolve and print the config, write nothing
```

### Tiler database (pgstac) - one-time per environment

The tiler serves tiles from a **pgstac** catalog and connects as a dedicated, least-privilege
role - it does **not** use the backend's database user or tables. This must be bootstrapped once
against the Flexible Server before the tiler can serve, and is **not** done by `deploy.sh`
(it needs admin DB privileges the running tiler must never hold).

The full, provider-agnostic procedure and rationale live in the tiler repo:
**`stacnotator-tiler/docs/database.md`**. Run it from a host that can reach the (private) admin
endpoint - on VPN, or any host inside the platform VNet. It is a manual one-off; no CI job does this. Exact Azure steps (copy-paste, set the two vars
at the top for your environment):

```bash
RG=<resource-group>                            # the env's resource group
PROJECT=stacnotator-dev                        # stacnotator-dev | stacnotator-prod

KV=$(az keyvault list -g "$RG" --query "[0].name" -o tsv)
SERVER=$(az postgres flexible-server list -g "$RG" --query "[0].name" -o tsv)

# 1. Allowlist the extensions pgstac installs (postgis, btree_gist, unaccent). The
#    canonical home is the infrastructure config (raapid-infra sets azure.extensions
#    from each project's `extensions` list) - prefer changing it there. Setting it here
#    REPLACES the whole list, so pass every extension the environment needs, not just
#    pgstac's: dropping `vector` breaks the app schema and any prod->dev restore.
#    Read the current value first and add to it:
az postgres flexible-server parameter show -g "$RG" -s "$SERVER" --name azure.extensions --query value -o tsv
az postgres flexible-server parameter set -g "$RG" -s "$SERVER" \
  --name azure.extensions --value postgis,uuid-ossp,citext,vector,btree_gist,unaccent

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

# 4. Store the tiler role password in Key Vault. deploy.sh wires it into the tiler
#    Container App as the `tiler-db-password` secret (separate from the backend's db-password):
az keyvault secret set --vault-name "$KV" --name tiler-db-password --value "$TILER_PW"
```

The tiler Container App then runs with `PGDATABASE=pgstac`, `PGUSER=tiler_app`,
`PGSSLMODE=require`, and `PGPASSWORD` from `tiler-db-password` - all set by `deploy.sh`.

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
RG=<resource-group>
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

**4. Set `PUBLIC_DOMAIN`** (after certs report Succeeded) - in `.env.deploy.<env>` for local, or as the
`PUBLIC_DOMAIN` **variable** on the environment's GitHub Environment for CI - then redeploy. The
deploy builds the frontend against `api.<domain>`, points `TILERS` at `https://tiler.<domain>`
(browser-facing) with `internal_url` on the Azure FQDN (backend->tiler stays in-Azure), sets
`CORS_ORIGINS` to `https://app.<domain>`, and sets `TILER_COOKIE_DOMAIN=.<domain>`. `SameSite=lax`
+ `Secure` (defaults) then work because all three are same-site.

### Python base image

Both Dockerfiles take their runtime base from the ECR Public mirror of the official image
(`public.ecr.aws/docker/library/python:<tag>`) rather than Docker Hub, which rate-limits the shared
ACR build IP hard enough to fail builds. The mirror serves the same manifest digest as Docker Hub,
tracks it without lag, and needs no credentials, so nothing has to be set up per registry.

The tag stays overridable via the `PYTHON_IMAGE` build arg, if a build ever needs to pin the base
somewhere else (an ACR artifact cache, for instance).

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
1. Resolve the full configuration: two `az` calls for the platform resources, everything else derived. `CORS_ORIGINS`, `TILERS`, `DEFAULT_TILER` and `TILER_COOKIE_DOMAIN` are computed here, not applied in a later pass.
2. Start three concurrent stages: backend image build (`az acr build`), tiler build and deploy (delegated to the tiler repo's `deployment/deploy-containerapp.sh`, checkout required - see Prerequisites), and the frontend `npm ci && npm run build`.
3. Record the pre-migration UTC restore point, then create or update the backend Container App in a **single** write carrying its complete environment and Key Vault secret refs (no plaintext credentials). One write means one revision, one alembic run.
4. Upload the frontend bundle to the Static Web App.
5. Poll the new backend revision until `healthState=Healthy`.

**Migration safety.** Migrations run as part of container startup (`alembic upgrade head` in the Dockerfile CMD, before gunicorn), not from this script.

A migration that *fails* needs no intervention. Alembic runs it inside a transaction, so it rolls itself back; the revision stays unhealthy and Container Apps keeps the previous revision serving 100% of traffic. Read the logs and ship a fix.

A migration that *succeeds but is wrong* is the hard case, and nothing here recovers it automatically. The deploy records one thing: the UTC instant immediately before the image swap, printed on success and on health-gate timeout. That is the point-in-time restore target if you ever need it.

Reach for a restore last, not first. Winding the database back to that instant **discards every write since**, so a bad migration noticed two days later costs two days of annotation work. In rough order of preference:

1. **Forward fix.** A corrective migration that repairs the damage in place. Loses nothing. Almost always the right answer when the damage is structural or affects a bounded set of rows.
2. **Restore beside, copy across.** Restore to a new server at the recorded instant and pull the specific pre-migration rows out of it, leaving live traffic untouched. Slower, but loses nothing.
3. **Full rollback.** Repoint the app at the restored server and accept the loss of everything written since. Only when the damage is broad enough that the interim data is not worth saving.

For 2 and 3, restore always creates a **new** server; there is no in-place option:

```bash
az postgres flexible-server restore --resource-group <rg> \
  --name <new-server-name> --source-server <source-server> \
  --restore-time <recorded-timestamp>
```

The restore window is whatever backup retention the server is provisioned with, so the recorded instant is only usable inside it.

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

The `Deploy Dev` GitHub Actions workflow (`.github/workflows/deploy-dev.yml`) builds and deploys backend, tiler, and frontend to the dev Azure environment. It does **not** touch any database - neither dev nor prod. To overwrite dev data from prod, use the manual `make az-sync-prod-to-dev` flow above.

Safety relies on:
- The OIDC identity (`id-cicd-stacnotator-dev-westeurope`) being federated only to `refs/heads/develop` and scoped to the dev resource group. It has zero prod RBAC.
- No prod credentials anywhere CI can read - prod KV is untouched by this workflow, and nothing is mirrored into the dev KV.
- The workflow being **manual-only** (`workflow_dispatch`), gated by the **`dev` GitHub Environment** with required reviewers matching the `production` Environment. Every deploy waits on a human Approve click.
- `if: github.ref == 'refs/heads/develop'` skipping the job for any other branch ref, plus the Environment's "Deployment branches" restriction set to `develop`.

#### One-time setup (do this before the first CI dev deploy)

1. **Configure GitHub Environment secrets on the `dev` Environment** (Settings → Environments → `dev` → Environment secrets). Names are unsuffixed and identical in the `production` Environment, so the shared `deploy.yml` reads the same set for both. (The one exception is `TILER_REPO_TOKEN`, which must be repo-level - see step 2.)

   | Secret | Value |
   |---|---|
   | `AZURE_CLIENT_ID` | Client ID of the environment's CI identity (`az identity show -n <ci-identity> -g <main-platform-rg> --query clientId -o tsv`) |
   | `AZURE_RESOURCE_GROUP` | The environment's resource group name |
   | `EE_SERVICE_ACCOUNT` | Same Earth Engine SA used in `.env.deploy.<env>` |
   | `CUSTOM_DOMAINS` | Extra origins appended to `CORS_ORIGINS`. Optional; prod only in practice |

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

3. **Set the per-environment variables** alongside the secrets in each Environment (Settings → Environments → `<env>` → Environment variables). Like the secrets, the names are unsuffixed and identical in both:

   | Variable | Value |
   |---|---|
   | `PUBLIC_DOMAIN` | The environment's parent domain. Only needed once the custom domains are bound (see [Custom domains](#custom-domains---one-time-per-environment-required-for-hosted-tiler-tiles) above) |
   | `EXTRA_TILERS` | Optional. Additional externally-hosted tilers, inner JSON without outer braces |
   | `TILER_AZURE_SIGNING` | Optional. `true` to let the tiler read internal-storage COGs via managed identity |
   | `VITE_FIREBASE_API_KEY` | Firebase client config, same values `bootstrap.sh` uploads to Key Vault |
   | `VITE_FIREBASE_AUTH_DOMAIN` | " |
   | `VITE_FIREBASE_PROJECT_ID` | " |

   The three `VITE_FIREBASE_*` values are public: they ship inside the frontend bundle. Key Vault holds the same values for laptop deploys, which read it over VPN, so rotating the Firebase project means updating both.

   Until `PUBLIC_DOMAIN` is set, deploys use the default Azure hostnames: MPC imagery works, but hosted-tiler tiles 401 in the browser (cross-domain cookie).

4. **Bootstrap the tiler's pgstac database** if it has not been done for this environment - see
   [Tiler database (pgstac)](#tiler-database-pgstac---one-time-per-environment). It creates the
   `tiler-db-password` Key Vault secret; without it the tiler revision fails to provision with
   `Unable to get value using Managed identity for secret tiler-db-password`.

5. **Create the `dev` GitHub Environment** under Settings → Environments → New environment → name it `dev`. The workflow references `environment: dev` (matching how the prod deploy references `environment: production`), so the job will not start until this Environment exists. Configure it as follows:

   - **Required reviewers**: mirror the list from the `production` Environment.
   - **Deployment branches**: restrict to `develop` only (Selected branches → add `develop`).
   - **Wait timer**: leave at 0.

   After this is set up, every click of "Run workflow" will pause for an explicit approval from a reviewer before the job starts.

After this, hitting **Run workflow** on `Deploy Dev` from the `develop` branch will: wait for reviewer approval → deploy backend/tiler/frontend to dev. If you want fresh prod data in dev afterwards, run `make az-sync-prod-to-dev` from your laptop on VPN.

## Scripts

| Script | When | Purpose |
|--------|------|---------|
| `deploy.sh` | Every release | Resolve config, build all three concurrently, one write per resource, gate on backend health |
| `bootstrap.sh` | Once per environment | Upload Firebase + EE credentials, generate the shared secrets when absent, create the Static Web App, add the tiler workload profile |
| `env.sh` | Sourced | Config resolution shared by both; holds no identifiers |
| `download-prod-db.sh` | As needed | Pull production DB to local development (no env argument, prod-only) |
| `sync-prod-data-to-dev.sh` | As needed | Sync production DB to dev Azure environment (no env argument) |
| `dev-restore-backup.sh` | As needed | Restore a SQL dump into the **local** docker dev stack (wipe, restore, migrate, restart); run via `make dev-restore-backup FILE=...` |
| `view-logs.sh` | Debugging | Stream real-time logs from Container Apps |

## Makefile Targets

```bash
make az-deploy-prod          # Deploy to production
make az-deploy-dev           # Deploy to dev
make az-deploy-dev-dry-run   # Print the resolved dev config, write nothing
make az-bootstrap-prod       # One-time prod setup
make az-bootstrap-dev        # One-time dev setup
make az-sync-prod-to-dev     # Sync prod DB to dev + run migrations
make az-logs-prod            # View prod backend logs (APP=tiler for tiler)
make az-logs-dev             # View dev backend logs (APP=tiler for tiler)
```

## Environment Configuration

Config reaches a deploy from two places, and the environment always wins over the file.

**CI** reads the calling job's GitHub Environment (`dev` or `production`). Names are unsuffixed, so both environments hold the same set and the reusable workflow needs no per-environment branching:

| Kind | Names |
|---|---|
| Environment secrets | `AZURE_CLIENT_ID`, `AZURE_RESOURCE_GROUP`, `EE_SERVICE_ACCOUNT`, `CUSTOM_DOMAINS` (prod), `TILER_REPO_TOKEN` |
| Environment variables | `PUBLIC_DOMAIN`, `EXTRA_TILERS`, `TILER_AZURE_SIGNING`, `TILER_REPO_REF`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` |
| Repository secrets | `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` |

**Laptop deploys** read `deployment/azure/.env.deploy.<env>` (gitignored; see `.env.deploy.example`). It supplies the same identifiers plus the credential file paths `bootstrap.sh` uploads. It never overrides a variable already present in the environment, so a stray file on a runner cannot influence CI.

`deploy.sh`, `bootstrap.sh` and `view-logs.sh` take `prod` or `dev` as a positional argument. The DB scripts hardcode their environments (see the table above).

Optional knobs, in either place:

- `EXTRA_TILERS` - registers additional externally hosted tilers (e.g. a GCP VM tiler) into the backend's `TILERS` registry.
- `TILER_AZURE_SIGNING` - lets the tiler read internal-storage custom-map COGs via managed identity (passed through as `AZURE_SIGNING_ENABLED`).
- `CUSTOM_DOMAINS` - extra origins appended to `CORS_ORIGINS`.
- `TILER_NAME` / `TILER_ALLOWS_INGEST` - shared between backend registry and tiler config so `allows_ingest` cannot drift.
- `TILER_DEDICATED` - put the tiler on a D8 dedicated workload profile (`bootstrap.sh` provisions it).

## Tiler Authentication

The tiler service requires authentication to prevent unauthorized tile access. This uses a short-lived HS256 JWT delivered as a cookie:

1. **Backend** mints a campaign-scoped token (1hr) via `GET /api/auth/tiler-token` and sets it as an `HttpOnly` `tiler_token` cookie - the token value never reaches JS, the frontend only tracks refresh timing
2. **Browser** sends the cookie automatically with tile requests (this is why tiler and app must share a registrable domain, see Custom domains above); the backend's tile proxy for API-key providers is authorized off the same cookie
3. **Tiler** verifies the JWT signature using a shared secret

The shared secret (`tiler-token-secret`) is auto-generated by `bootstrap.sh` and stored in Key Vault. Both backend and tiler reference it via `keyvaultref:`. No manual secret management is needed - just run `bootstrap.sh` once per environment.

For local development, a default dev secret is used automatically when `TILER_TOKEN_SECRET` is not set.

## API Key Encryption

Provider API keys are encrypted at rest with AES-256-GCM. The master key (`apikey-encryption-secret`, base64 of 32 bytes) is auto-generated by `bootstrap.sh` and stored in Key Vault; the backend references it via `keyvaultref:` as `APIKEY_ENCRYPTION_SECRET`.

The backend refuses to start when `ENVIRONMENT=production` and this is still the dev default, so a new environment must run `bootstrap.sh` before `deploy.sh`.

Rotating this key makes every already-stored API key undecryptable - `bootstrap.sh` only generates it when absent. To rotate deliberately, re-enter the provider API keys afterwards.

## Database Access

The database is accessible via:
- **Container Apps**: private endpoint (VNet-routed, no public exposure)
- **Admin scripts**: public access restricted to VPN IP ranges only

For local DB dumps, connect via VPN and use `download-prod-db.sh`.

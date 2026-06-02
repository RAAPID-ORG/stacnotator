# Architecture

STACNotator is a multi-service application for geospatial imagery annotation. It connects to STAC catalogs for imagery, serves tiles for visualization, and provides a canvas-based annotation interface.
The decision for using multiple services instead of an easier to maintian single service, is based on pricing scheme and out of the box capabilities of deployed services on Azure. I.e we use a serpate worker
service for processing rasters that requires more ram and cpu and avoid blocking the small backend instance. The worker is only launched as a container on demand when needed.

## Services

### Frontend
React 19 + Vite + OpenLayers. Handles the annotation UI, campaign creation wizard, map rendering, and tile prefetching. API client auto-generated from the backend's OpenAPI spec via `openapi-ts` (`npm run openapi-ts`). Deployed as an Azure Static Web App in production, Vite dev server locally.

### Backend
FastAPI + Gunicorn. Auth (Firebase or local single-user mode), campaign and task management, STAC catalog browsing, mosaic registration, annotation storage, and custom map upload coordination. Background threads handle long-running work (mosaic registration, embedding computation).

### Tiler
Self-hosted TiTiler (FastAPI + GDAL/rasterio). Two tile sources:
- **STAC mosaics** - composites items from remote STAC catalogs, PostGIS spatial indexing for per-tile item lookups
- **Custom map COGs** - serves user-uploaded rasters processed by the worker

Auth via HMAC-signed tokens issued by the backend. Only used when MPC direct tiles are unavailable (non-MPC catalogs, advanced compositing, masking, custom maps).

### Worker
Standalone polling service. Watches the DB for custom maps with `status=pending_processing`, converts them to Cloud Optimized GeoTIFF (reproject to EPSG:4326 → build overviews → LZW COG via rasterio), writes result to object storage, marks `ready`. Poll interval configurable via `POLL_INTERVAL_S`. In production, deploy as an Azure Container App Job (scales to zero).

### Database
PostgreSQL 16 + PostGIS (spatial queries for mosaic item lookups) + pgvector (64-D satellite embeddings for KNN validation). All application state lives here. Migrations managed by Alembic.

## Key Data Flows

**Campaign creation**
Frontend builds imagery config → backend creates DB entries → background threads register mosaics (STAC searches, item storage) and optionally compute satellite embeddings via Earth Engine.

**Annotation**
Frontend loads campaign → fetches tasks and tile URLs from backend → tiles served by MPC directly or via tiler → user annotates → annotations stored via backend REST API.

**Tile request (self-hosted)**
Frontend requests HMAC token from backend → requests tile with token → tiler verifies token → queries PostGIS for intersecting STAC items → reads COGs → composites → returns PNG.

**Custom map upload**
Frontend requests presigned URL from backend → uploads file directly to object storage (Azure Blob SAS in prod, local volume in dev) → calls backend to create DB record (`status=pending_processing`) → worker converts to COG and marks `ready` → tiler serves tiles via the same HMAC-auth pattern.

## Tile Flow

For MPC collections with first-valid compositing, the frontend fetches tiles directly from MPC (fast path). For everything else, tiles go through the self-hosted tiler. See [tile-serving.md](tile-serving.md) for details.

## Deployment

Infrastructure (networking, Key Vault, ACR, Container Apps Environment) managed by Terraform. Application resources (Container Apps, Static Web App, identities, RBAC) self-managed via `deploy-app.sh`. See [azure_deploy/README.md](../azure_deploy/README.md).

Custom map storage uses Azure Blob with **Managed Identity** + user-delegation SAS - no account keys. Required RBAC: `Storage Blob Data Contributor` for backend and worker, `Storage Blob Data Reader` for tiler.

# Architecture

STACNotator is a multi-service application for geospatial imagery annotation. It connects to STAC catalogs for imagery, serves tiles for visualization, and provides a canvas-based annotation interface.

## Services

### Frontend
React + Vite + OpenLayers. Handles the annotation UI, campaign creation wizard, map rendering, and tile prefetching. Deployed as an Azure Static Web App in production, Vite dev server locally.

### Backend
FastAPI + Gunicorn Server. Handles authentication (Firebase or local single-user mode), campaign/task management, STAC catalog browsing through STACIndex, mosaic registration, and annotation storage. Connects to the Azure Key Vault for DB credentials.

### Tiler
Self-hosted TiTiler (FastAPI + GDAL/rasterio). Reads COGs from remote STAC catalogs, composites mosaics, and serves PNG tiles. Uses PostGIS spatial indexing for per-tile item lookups (cached from external STAC catalogs). Only used when MPC direct tiles are not available (non-MPC catalogs, advanced compositing, masking).

### Database
PostgreSQL 16 with PostGIS (spatial queries for mosaic items) and pgvector (embeddings for similarity search). Stores campaigns, annotations, mosaic registrations, tile URLs, and user data.

## Tile Flow

For MPC collections with first-valid compositing, the frontend fetches tiles directly from MPC (fast path). For everything else, tiles go through the self-hosted tiler. See [tile-serving.md](tile-serving.md) for details.

## Deployment

Infrastructure (networking, Key Vault, ACR, database, Container Apps Environment) should be managed externally (i.e Through Terraform). Application resources (Container Apps, Static Web App, identities, RBAC) are self-managed by the project team via `deploy-app.sh`. See [azure_deploy/README.md](../azure_deploy/README.md) for the deployment workflow.

## Key Data Flow

1. **Campaign creation:** Frontend builds imagery config → backend creates DB entries → background threads register mosaics (STAC searches) and fetch embeddings.
2. **Annotation:** Frontend loads campaign → fetches tiles from MPC or tiler and tasks-geometries from backend → user annotates → annotations stored via backend REST API.
3. **Tile request (self-hosted):** Frontend requests tile → tiler queries PostGIS for intersecting items → reads COGs → composites → returns PNG.

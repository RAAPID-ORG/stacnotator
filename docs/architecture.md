# Architecture

STACNotator is a multi-service application for geospatial imagery annotation. It connects to STAC catalogs for imagery, serves tiles for visualization, and provides a canvas-based annotation interface.

## Services

### Frontend
React + Vite + OpenLayers (Leaflet for small review/settings maps). Handles the annotation UI, campaign creation wizard, map rendering, and tile prefetching. The annotation workspace is a persistable multi-panel canvas (react-grid-layout). Talks to the backend through a typed API client generated from the OpenAPI schema (`make dev-openapi`). Deployed as an Azure Static Web App in production, Vite dev server locally.

### Backend
FastAPI + Gunicorn Server. One router per domain module: pluggable authentication (Firebase or local single-user mode, `AUTH_PROVIDER`), organizations and projects (multi-tenancy: organization → project → campaign, with per-org membership, invites, and tiler allowlists), campaign/task management, annotation storage (including backend-rendered annotation vector tiles), STAC catalog browsing (curated catalogs, STACIndex, and tiler platform catalogs), mosaic registration, a tile proxy for API-key-protected providers (keys AES-256-GCM encrypted at rest), timeseries via Google Earth Engine, sampling design (task generation from uploaded regions: random, stratified, embedding-based), custom layers (COG overlays + PMTiles vector layers), and canvas layout persistence. Secrets (DB credentials etc.) arrive as env vars; on Azure they are injected from Key Vault by Container Apps, the app itself never talks to Key Vault.

### Tiler
Self-hosted titiler-pgstac (FastAPI + GDAL/rasterio), maintained in the separate `stacnotator-tiler` repo. Reads COGs from remote STAC catalogs, composites mosaics, and serves PNG tiles. Runs over its own pgstac index for per-tile item lookups (items ingested from external STAC catalogs). Only used when MPC direct tiles are not available (non-MPC catalogs, advanced compositing, masking, custom maps). The backend supports multiple registered tilers (`TILERS` registry + `DEFAULT_TILER`), allow-listed per organization; the default stack runs without one (MPC-only). In dev an optional tiler is available behind the `tiler` compose profile.

### Database
PostgreSQL 16 with PostGIS (task and annotation geometries) and pgvector (64-D AlphaEarth satellite embeddings from Earth Engine, used for KNN label validation and embedding-based sampling). Stores organizations, projects, users, campaigns, annotations, canvas layouts, timeseries, custom layers, and tile URLs. STAC items live in each tiler's own pgstac database, not here.

### Python SDK
`sdk/` ships an active-learning client library: pull labelled samples into DataFrames, push prediction COGs back as campaign overlays.

## Tile Flow

For MPC collections with first-valid compositing, the frontend fetches tiles directly from MPC (fast path). Other raster imagery goes through a self-hosted tiler, and API-key-protected providers/basemaps are proxied by the backend (which holds the decrypted key). Vector tiles never touch a tiler: annotation MVT is rendered by the backend, PMTiles custom layers are fetched straight from storage. See [tile-serving.md](tile-serving.md) for details, and [annotation-tiles.md](annotation-tiles.md) for how annotation tiles, live editing and multi-user reconciliation fit together.

## Deployment

Infrastructure (networking, Key Vault, ACR, database, Container Apps Environment) should be managed externally (i.e Through Terraform). Application resources (Container Apps, Static Web App, identities, RBAC) are self-managed by the project team via `deployment/azure/deploy.sh`. See [deployment/azure/README.md](../deployment/azure/README.md) for the deployment workflow.

## Key Data Flow

1. **Campaign creation:** Frontend builds imagery config → backend creates DB entries → background threads register mosaics (STAC searches) and fetch embeddings if applicable; annotation is blocked until they report ready.
2. **Annotation:** Frontend loads campaign → fetches tiles from MPC or tiler and tasks-geometries from backend → user annotates → annotations stored via backend REST API.
3. **Tile request (self-hosted):** Backend mints a campaign-scoped tiler JWT and sets it as an HttpOnly `tiler_token` cookie → the browser sends it automatically with tile requests → tiler verifies it, resolves the search's items from its pgstac index → reads COGs → composites → returns PNG.

## Imagery Generation Provenance

A temporal-generator run is a source-level `ImageryGenerationSeries`, not a
property copied onto each collection. The series owns one strict, versioned
configuration snapshot; generated collections carry a nullable foreign-key
reference to it. Normalized collection, slice, STAC-search, and visualization
rows remain authoritative for rendering.

The full imagery-editor write interface sends series records once per source
and associates collections through request-local keys. The backend resolves
those keys transactionally and rejects unknown or unreferenced series. This
supports multiple independently editable generated series alongside manual
collections without guessing provenance for historical data.

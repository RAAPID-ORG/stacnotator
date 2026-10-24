# Upgrading to the redesigned data model

This release (branch `refactor/legacy-cleanup`, SDK 0.2.0) changes the database, the
REST API and the tiler contract. Nothing in this repo calls the old routes any more;
this page is for deploying it and for anyone calling the API from outside.

## Deploying

1. **Tiler first.** Deploy `stacnotator-tiler` at its `refactor/legacy-cleanup` commit before
   the backend (`deployment/azure/deploy.sh` now waits for it). Searches are authorized by the
   owner and layer stamped on them; the old tiler only knows `campaign_id`.
2. **Backend.** The container runs `alembic upgrade head` on start. The migrations run in one
   transaction, so a failure leaves the database as it was. `avEinline` rewrites `annotations`
   and `tasks` (geometry and embeddings move onto the rows) and builds their indexes: on a large
   database, take a maintenance window or raise the health wait in `deploy.sh`.
3. **Re-registration.** `avIlayers` drops every hosted-tiler mosaic and custom-map search, since
   their ids change with the new stamps, and leaves the owners `pending`. The first worker to
   boot claims them and registers them one owner at a time. Hosted imagery is unavailable, and
   annotation waits, until an owner's run is done. MPC mosaics are kept.
4. **Tiler cleanup.** Once re-registration has finished, delete the old searches with the SQL in
   the tiler repo's `docs/database.md`. The tiler already refuses them, but some hold a sealed
   SAS for a customer's catalog.
5. **SDK.** Install 0.2.0. Earlier versions read `Campaign.mode`, which the API no longer returns.

## API changes

Paths are under `/api`.

### Moved

| Before | Now |
|---|---|
| `/{campaign_id}/imagery/...` (incl. tile proxies) | `/campaigns/{campaign_id}/imagery/...` |
| imagery views, `new-layout` | `/campaigns/{id}/views`, `POST /campaigns/{id}/layouts` |
| `annotation-tasks...` | `/campaigns/{id}/tasks...` |
| `/{task_id}/claim`, `/{task_id}/annotate` | `/campaigns/{id}/tasks/{task_id}/claim`, `.../annotate` |
| `assign-tasks`, `unassign-tasks` | `/campaigns/{id}/tasks/assign`, `.../tasks/unassign` |
| `create-annotation` | `POST /campaigns/{id}/annotations` |
| `annotations/{id}/update` | `PUT /campaigns/{id}/annotations/{annotation_id}` |
| `validate-submission` | `/campaigns/{id}/tasks/{task_id}/validate-label` |
| `PATCH /campaigns/{id}/name`, `/guide`, `/bbox`, `/labels`, ... (11 routes) | `PATCH /campaigns/{id}` with `CampaignUpdate` |
| `/timeseries/{id}/{lat}/{lon}/data` | `/campaigns/{id}/timeseries/{ts_id}/data?latitude=&longitude=` |
| `timeseries/panel` | `PATCH /campaigns/{id}/timeseries/windows/{window_id}` |
| slice proxy `{visualization_name}` | `{visualization_id}` |

### Removed

Per-user `grant-admin` / `revoke-admin` (the bulk routes remain),
`GET /campaigns/{id}/timeseries` (time series come with the campaign),
`knn-validation-status`, and `imagery/collections/{id}/refresh` (refresh a source instead).

### Renamed or reshaped fields

- `AnnotationOut`: `annotation_task_id` → `task_id`, `geometry` → `geometry_wkt`.
- `MeOut`, `UserOutDetailed`: `is_admin` → `is_platform_admin`.
- `CustomMapOut`: `status_error` → `status_errors`.
- `ImagerySliceOut`: `tile_urls` → `tiles` (one entry per visualization id).
- Imagery collections: `stac_config` → `search` plus `visualizations`.
- Campaigns: `mode` is gone; the labelling policy decides who may explore and answer, and the
  page opens where there is work for the viewer. Settings are grouped under `settings`.
- `AnnotationCreate`, `AnnotationUpdate`, `TaskAnswerCreate`: send only `imagery_slice_id`; the
  server records the source name and dates from that slice. `AnnotationUpdate` no longer takes
  `is_authoritative`.
- `labelling_policy` requires all five axes, `modify_others` included.

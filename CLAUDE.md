# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

STACNotator (NASA Harvest) is a multi-service geospatial imagery annotation platform: it connects to STAC catalogs for imagery, serves map tiles, and provides a canvas-based annotation UI. Stack: FastAPI backend, React + Vite + OpenLayers frontend, PostgreSQL 16 (PostGIS + pgvector), and an optional self-hosted tiler (separate repo `stacnotator-tiler`).

## Commands

Everything is orchestrated through `make` (see `Makefile`) over two compose files: `docker-compose.dev.yml` (dev, hot-reload) and `docker-compose.prod.yml`.

```bash
make dev-init            # first-time: build images, start, migrate, seed (FIREBASE_UID="..." for firebase mode)
make dev-up              # start with hot reload  → FE :5173, BE :8000, docs :8000/api/docs
make dev-down            # stop
make dev-logs-backend    # backend logs; dev-shell-backend / dev-shell-db for shells
make dev-migrate         # alembic upgrade head (dev-migrate-create MSG="..." to autogenerate)
make dev-reset           # nuke db volume, migrate, re-seed
make dev-restore-backup FILE=db/backups/<f>.sql
```

Quality gates (run before pushing; CI runs the same):

```bash
make test                # backend pytest + SDK pytest + frontend Playwright
make test-backend        # == cd backend && uv run pytest -v (test-sdk for sdk/)
make test-e2e            # == cd frontend && npx playwright test
make lint                # ruff check + eslint (backend, frontend, sdk)
make format-check        # ruff format --check + prettier --check
make typecheck           # mypy (backend + sdk) + tsc --noEmit
make ci-check            # all of the above
```

Run a single test: `cd backend && uv run pytest tests/unit/test_campaign_schemas.py::test_name -v`. Frontend unit tests are vitest: `cd frontend && npm run test`.

### Test cadence -don't run everything on every change

The cost is lopsided: backend pytest (DB-free schema/model tests) and frontend vitest are seconds; the ~18 Playwright **E2E specs run under parallelism and take minutes** -that's what makes `make test` heavy. CI agrees: backend tests run on `develop`/`main` + PRs, but **full E2E only runs on `main` and PRs to `main`**, not on every push. So scope to the narrowest relevant check during the dev loop and let the full suite run once at the gate:

```bash
cd backend && uv run pytest tests/unit/test_campaign_schemas.py -v   # one backend test
make test-backend                                                    # whole backend suite (still seconds)
cd frontend && npm run test                                          # frontend unit (vitest)
cd frontend && npx playwright test open-mode-imagery                 # one E2E spec by filename
cd frontend && npx playwright test -g "submit annotation"            # E2E by test-name pattern
```

Run the full `make test` (all 18 E2E specs) only before a PR / when finishing -i.e. via `/no-mistakes` below, which matches CI.

### Validate before shipping -`/no-mistakes`

Before changes reach the push target, gate them through the `no-mistakes` skill (`/no-mistakes`): it runs automated code review, the tests, lint, typecheck, and docs, then handles push/PR/CI. Prefer it over running the gates ad-hoc when finishing a task or before opening a PR.

### Backend env -use `uv`

The in-repo `backend/.venv` is stale. Always run backend tooling via `uv run` (`uv run pytest`, `uv run alembic ...`, `uv run mypy ...`) from `backend/`, or inside the container. Python 3.12.

### Frontend API client is generated

`frontend/src/api/client/*.gen.ts` is generated from the backend's OpenAPI schema -**never hand-edit it**. With the backend running, regenerate with `make dev-openapi` (`cd frontend && npm run openapi-ts`). Config in `frontend/openapi-ts.config.ts`. The backend uses `generate_unique_id` (see `backend/src/routing.py`) so generated operation/type names stay stable.

## Backend architecture

FastAPI app in `backend/src/main.py` mounts one router per domain module under `/api`: `auth`, `organizations`, `projects`, `campaigns`, `annotation`, `timeseries`, `sampling_design`, `imagery` (+ `imagery/proxy_router`), `stac_browser` (STAC catalog browsing for the campaign wizard: catalog list, collections, item search), `planet` (Planet Basemaps browsing for the same wizard: series list, a series' mosaics as ready tile templates), `custom_layers` (overlay layers: COG custom maps + PMTiles vector layers, owned by a campaign or a visualizer), `visualizers` (published project-scoped maps; registers imagery of its own over its area and/or links what campaigns already registered, and serves the one route in the app reachable without an account). Tile *serving* lives in the separate tiler service - this backend only registers mosaics and mints tiler access tokens.

Each domain module under `backend/src/<domain>/` follows the same layout:
- `router.py` -FastAPI endpoints, dependency wiring
- `service.py` -orchestration: DB I/O + external calls (STAC, Earth Engine, tiler)
- `models.py` -SQLAlchemy models; `schemas.py` -Pydantic request/response models
- **functional-core modules** -pure logic extracted out of `service.py` so it can be unit-tested without a DB: `campaigns/assignments.py` + `campaigns/statistics.py`, `imagery/tile_urls.py`, `annotation/io.py`, `canvas/layout.py`. When adding logic, prefer extending these pure cores over fattening `service.py`.

`canvas/` is a routerless domain module that owns all canvas-layout state (the `CanvasLayout` model, the react-grid-layout item schema, bin-packing/reconciliation in `layout.py`, DB writes in `service.py`). Other domains contribute window keys (timeseries window names, imagery collection ids) and must never mutate `layout_data` themselves; the save endpoint stays at `imagery/router.py`'s `new-layout` for API stability.

Cross-cutting: `config.py` (pydantic-settings `Settings`, env-driven; `get_settings()` is `@lru_cache`d), `database.py` (`SessionLocal`), `crypto.py` (AES-256-GCM at-rest encryption of provider API keys), `tile_bulkhead.py` (caps tile traffic's share of the DB pool), `net_guard.py` (SSRF guard: every outbound fetch of a user-influenced URL goes through `guarded_client`/`guarded_async_client`, which check the scheme, reject private/loopback answers and pin the connection to the validated IP on each hop; `assert_public_url` is the pre-flight check for URLs we hand to the tiler), `earth_engine.py` (EE init), `routing.py` (OpenAPI operation-id route class), `filenames.py` (download-filename sanitizing), and the routerless `tilers/` package (tiler platform integration, consumed by `auth`, `imagery`, `custom_layers`: `registry.py` = which tilers exist incl. MPC, `providers.py` = provider selection + tile-URL building + register/ingest calls, `tokens.py` = tiler JWT mint/verify). `tilers/` never imports from feature modules; `stac_browser/` depends on it, not the reverse. `main.py` also defines request-id middleware and the global exception handlers that wrap every error with a `request_id`.

**Auth** is pluggable via `auth/providers/` (`base.py` interface, `firebase.py`, `local.py`), selected by `AUTH_PROVIDER` (`local` = single built-in admin user, no external setup; `firebase` = multi-user). `_validate_production_config()` in `main.py` hard-fails on dev-default secrets when `ENVIRONMENT=production`.

### Data model (imagery)

Every layer table - imagery sources, basemaps, custom maps, vector layers - belongs to exactly one owner, a campaign or a visualizer (`LayerOwner` in `src/layers.py`, which also decides the scope its tiles are served under). It holds many time-period **collections** (e.g. monthly); each collection has a Cover slice plus finer **slices** (e.g. weekly) that annotators browse. A visualizer ignores that structure and flattens it into one dated list. Date-nearest imagery search spans the whole source, not a single collection. Campaign creation kicks off **background threads** for mosaic registration (STAC searches → item storage → tile URLs) and embedding computation (Earth Engine); both track status `registering → ready/failed` and annotation is blocked until ready.

### Tile flow

For MPC collections with first-valid compositing, the frontend fetches tiles **directly from MPC** (fast path, no tiler). Everything else (non-MPC catalogs, compositing/masking) goes through the self-hosted tiler, authorized by an HttpOnly `tiler_token` cookie the backend mints (HS256, shared `TILER_TOKEN_SECRET`). The dev stack runs **db + backend + frontend only**; to exercise the tiler, run the `stacnotator-tiler` repo and set `TILERS`/`DEFAULT_TILER` on the backend service. Vector tiles never touch a tiler: annotation MVT is rendered by the backend itself (`annotation/tiles.py` + the `.pbf` endpoint in `annotation/router.py`), and PMTiles custom layers are fetched straight from storage. See `docs/tile-serving.md` and `docs/tilers.md`.

## Frontend architecture

Feature-sliced under `frontend/src/`:
- `app/` - `router.tsx`, providers (`app/providers/AuthProvider.tsx`), app shell (`AppLayout.tsx`, `AppSidebar.tsx`)
- `features/<name>/` - `annotation`, `campaigns`, `auth`, `settings`, `home`. Most have `components/`, `hooks/`, `pages/`, `stores/` (Zustand), `utils/`; `annotation` is layered instead (below). Custom-layers UI follows the surface split: authoring editors under `campaigns/components/`, runtime controls under the annotation panels that own them
- `shared/` - cross-feature `ui/`, `hooks/`, `utils/`, `stores/` (global UI state: `layout.store.ts`, `account.store.ts`), `colormaps/` (tiler colormap definitions + select, used by the campaign editors and the annotation legend), `map/` (the OpenLayers engine: `MapView`, `layers.ts`, `Camera`, `tileLoading.ts`, `interactions.ts` - any page that draws a map mounts these), `imagery/` (pure tile URL and render-param mechanics, plus the editable `RenderLegend`)
- `api/` - generated client (`client/`), `hey-api.ts` config, `queries.ts` (the generated react-query option factories), `queryClient.ts` (the shared cache), plus `stacBrowser.ts` and `tilerToken.ts`

### Reading a campaign: summary or full

`GET /campaigns/{id}` returns a campaign **with all of its imagery** - sources,
collections, slices, tile URLs, basemaps, overlays, time series. That is around 22
sequential round trips and most of a second, and only two surfaces render any of it:
the settings editor and the annotation page. Everything else reads
`GET /campaigns/{id}/summary` (`useCampaignSummary`), which loads the settings
relationship and nothing else.

`CampaignOut` inherits from `CampaignSummaryOut` so the two shapes cannot drift, and
`test_campaign_summary_schema.py` fails if imagery creeps back into the summary. The
trap is the other direction and has already happened once in a merge: swapping
`useCampaignSummary` for `useCampaign` compiles, renders identically, and quietly puts
the heavy read back on a page that shows none of it.

### Server state outside the annotation page

Every platform surface - projects, organizations, settings, campaign admin,
visualizer authoring - reads through **TanStack Query**, never through a
`useEffect` + `useState` fetch. The option and mutation factories are generated
from the same OpenAPI schema as the client (`~/api/queries`), so there are no
hand-written query keys or wrapper hooks: `useQuery(listProjectsOptions())`,
`useMutation(updateProjectMutation())`, and `invalidateQueries` with the
generated key after a write.

- **`queryClient.ts` owns error reporting.** Each query and mutation carries
  `meta: { errorMessage, showUser? }`; the cache-level handler calls
  `handleError`. Do not wrap calls in try/catch to toast.
- **Loads render their failure in place, actions toast.** Set
  `showUser: false` where the surface shows the error itself or deliberately
  degrades without it (say why in a comment when there is no error UI). Use
  `meta: reportedByCaller(msg)` where a child awaits the handler and reports
  for you - the admin tables and assignment modals - so the toast is not
  doubled.
- **Freshness is two tiers.** The default (30s stale, no focus refetch) suits
  data only an admin changes: organizations, projects, members, campaign
  settings. Lists other users change while you watch - task progress, task
  sets, the review annotations, statistics - opt into `SHARED_WORK` from
  `queryClient.ts` (re-read every mount, refetch on window focus). Deliberately
  not a timer: those endpoints return a whole campaign's tasks or annotations
  unpaginated. Background jobs (mosaic registration, custom-map registration)
  use a `refetchInterval` that reads the record's own status and stops itself.
  The annotation page opts out of all of this: it syncs deltas against a cursor
  every 5s (`annotation/stores/work.ts`), which is what real-time editing needs.
- **Retries are off, and focus-refetch is off by default** so one mocked route
  means one request under Playwright. Keep it that way; `SHARED_WORK` is the
  only opt-in.
- **Client state stays in Zustand** (`org.store.ts`, `layout.store.ts`, the
  annotation stores). A store that caches a server list is the thing this
  replaced; don't add one back.
- Deliberately still imperative: file uploads and downloads that report through
  a callback and own no list, and `features/annotation` + the imagery wizard
  (`campaigns/components/imagery/`), which have their own state machines.
- A read shared by more than one surface gets a named hook returning domain
  values plus `loading`/`error`, not the query object - `useOrganizations`,
  `app/projectRoute.ts`, and `campaigns/hooks/campaignQueries.ts`, which is
  where the campaign freshness split and its invalidation helpers are stated
  once instead of repeated across the admin tabs. A page's own one-off read
  stays a `useQuery` in the page.
- Component tests that touch a query use `renderWithQuery` and mock
  `~/api/client/sdk.gen` - mocking `~/api/client` only catches direct callers.

### The annotation feature

The heart of the app. Under `features/annotation/`, grouped by what a thing *is*:

- `campaign/` - what a campaign is made of, as plain data and functions, one subject per file: `imagery.ts` (the `ImageryCatalog`: sources, collections, slices indexed by id), `imageryNav.ts` (the browsing address plus slice/collection stepping and source cycling), `tileUrls.ts` (a slice's raster, over the URL mechanics in `shared/imagery/`), `timeseries.ts` (window grouping), `annotation.ts` (labels, geometry, form values, validation), `labelStyle.ts`, `tasks.ts` (claims, filtering, review rows, export). No React, no OpenLayers, no stores - enforced by `no-restricted-imports`, and what makes it unit-testable without any of them.
- `stores/` - the Zustand stores. `campaign.ts` holds the loaded campaign, catalog, view and mode; **everything reads the campaign from there rather than being handed it**, which is why no context object is threaded through the tree.
- `loadCampaign.ts` - the one seam that fetches a campaign and re-seeds every store, so nothing survives a campaign change.
- `map/` - what this feature draws and where it looks from: `compose.ts` (the layer list for a given catalog and navigation state), `camera.ts` (the page's cameras + leader/follower, over `shared/map/Camera`), `preloader.ts` (tile QoS). The engine itself lives in `shared/map/`.
- `canvas/` - everything that owns the workspace layout: the react-grid-layout host, its pure geometry (`grid.ts`, `screens.ts`, `dropCell.ts`), the layout editor and view admin (`LayoutEdit/`), and the popout windows that host further canvases (`Screens/`).
- `panels/<Name>/` - one folder per grid card (`MainMap`, `Minimap`, `ImageryWindow`, `TaskControls`, `ExploreControls`, `Timeseries`), each holding only what that panel needs. `panels/panels.tsx` builds the whole panel list in one place.
- `chrome/` - page-level UI about the *work* rather than the workspace: `Toolbar/`, `Tour/`, the full-page `Gates`, and the floating overlays the page mounts beside the canvas (`EditOverlayControls` on desktop, `MobileSliceNav` on mobile).
- `components/` - leaf UI with no feature knowledge, shared by panels *and* chrome (`FormFields`, `LabelChips`, `HeaderSelect`). Anything used by only one panel lives in that panel's folder.
- `keymap.ts` + `hotkeys.ts` - `keymap.ts` is the content (every shortcut and what it runs, assembled by `pageKeymap()`); `hotkeys.ts` is the mechanism (one keydown listener over a stack of tables, plus help text and tooltips). Within a table the first binding whose key matches and whose `when` passes wins, which is how Escape means "cancel the edit" while editing and "close the draft" otherwise, with no scope machinery. Locally-mounted tables shadow the page's.
- `AnnotationPage.tsx` - the route entry, and the only module the rest of the app may import (`no-restricted-imports` in `eslint.config.js`).

Both campaign modes (**Task Mode**, predefined locations; **Open Mode**, free-form) share one map composition path, so there is no forked map or controls implementation. Every binding declares its own help text, which is what drives the shortcut list and the tooltips.

## Conventions & guardrails

- **Code is mostly self-documenting** -avoid explanatory comments; prefer clear names and low complexity (see `CONTRIBUTING.md`).
- **Branching**: feature work on `feature/*`|`fix/*`|`refactor/*`|`hotfix/*` → PR into `develop` (the deployed integration branch) → `develop` merged into `main` for production releases. Open PRs against `develop`. `@rohansaw` is the default reviewer (`.github/CODEOWNERS`); `/.github/` and `/deployment/azure/` changes always need owner review. See `docs/development.md`.
- **Production is Azure** (Container Apps for backend/tiler, Static Web App for frontend; PostgreSQL + Key Vault). Prod deploys via CI on push to `main` (gated by the `production` GitHub Environment); never assume local nginx/CSP behavior matches prod. Deployment scripts in `deployment/azure/`.
- **Tests**: pure logic → DB-free unit tests in `backend/tests/unit/`; DB-bound code → real Postgres. E2E (Playwright, `frontend/e2e/`) must be deterministic under parallelism -observe via DOM (`data-*`, rendered text) and `waitForResponse`, never via store globals or cache-dependent tile requests. Tests focus on central business-logic, and must test actual units / user flows. We avoid bloating the test suit with unecessary tests
- Backend lint: ruff (line-length 100, rules `E/W/F/I/UP/B/SIM/T20` -note `T20` forbids leftover `print`s). Frontend: eslint + prettier + strict `tsc`.
- Install hooks once with `make pre-commit-install`.

## Further docs

`docs/architecture.md` (services overview), `docs/development.md` (branching/CI/deploy), `docs/features.md` (full feature list), `docs/tile-serving.md` + `docs/tilers.md` (tiler internals), `docs/annotation-tiles.md` (annotation vector tiles, editing, multi-user sync), `deployment/azure/README.md` (deployment).

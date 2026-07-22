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
make test                # backend pytest + frontend Playwright
make test-backend        # == cd backend && uv run pytest -v
make test-e2e            # == cd frontend && npx playwright test
make lint                # ruff check + eslint
make format-check        # ruff format --check + prettier --check
make typecheck           # mypy + tsc --noEmit
make ci-check            # all of the above
```

Run a single test: `cd backend && uv run pytest tests/unit/test_campaign_schemas.py::test_name -v`. Frontend unit tests are vitest: `cd frontend && npm run test`.

### Test cadence — don't run everything on every change

The cost is lopsided: backend pytest (DB-free schema/model tests) and frontend vitest are seconds; the ~18 Playwright **E2E specs run under parallelism and take minutes** — that's what makes `make test` heavy. CI agrees: backend tests run on `develop`/`main` + PRs, but **full E2E only runs on `main` and PRs to `main`**, not on every push. So scope to the narrowest relevant check during the dev loop and let the full suite run once at the gate:

```bash
cd backend && uv run pytest tests/unit/test_campaign_schemas.py -v   # one backend test
make test-backend                                                    # whole backend suite (still seconds)
cd frontend && npm run test                                          # frontend unit (vitest)
cd frontend && npx playwright test open-mode-imagery                 # one E2E spec by filename
cd frontend && npx playwright test -g "submit annotation"            # E2E by test-name pattern
```

Run the full `make test` (all 18 E2E specs) only before a PR / when finishing — i.e. via `/no-mistakes` below, which matches CI.

### Validate before shipping — `/no-mistakes`

Before changes reach the push target, gate them through the `no-mistakes` skill (`/no-mistakes`): it runs automated code review, the tests, lint, typecheck, and docs, then handles push/PR/CI. Prefer it over running the gates ad-hoc when finishing a task or before opening a PR.

### Backend env — use `uv`

The in-repo `backend/.venv` is stale. Always run backend tooling via `uv run` (`uv run pytest`, `uv run alembic ...`, `uv run mypy ...`) from `backend/`, or inside the container. Python 3.12.

### Frontend API client is generated

`frontend/src/api/client/*.gen.ts` is generated from the backend's OpenAPI schema — **never hand-edit it**. With the backend running, regenerate with `make dev-openapi` (`cd frontend && npm run openapi-ts`). Config in `frontend/openapi-ts.config.ts`. The backend uses `generate_unique_id` (see `backend/src/utils.py`) so generated operation/type names stay stable.

## Backend architecture

FastAPI app in `backend/src/main.py` mounts one router per domain module under `/api`: `auth`, `campaigns`, `annotation`, `timeseries`, `sampling_design`, `imagery` (+ `imagery/proxy_router`), `tiling`, `custom_layers` (campaign overlay layers: COG custom maps + PMTiles vector layers). Tile *serving* lives in the separate tiler service — this backend only registers mosaics and mints tiler access tokens.

Each domain module under `backend/src/<domain>/` follows the same layout:
- `router.py` — FastAPI endpoints, dependency wiring
- `service.py` — orchestration: DB I/O + external calls (STAC, Earth Engine, tiler)
- `models.py` — SQLAlchemy models; `schemas.py` — Pydantic request/response models
- **functional-core modules** — pure logic extracted out of `service.py` so it can be unit-tested without a DB: `campaigns/assignments.py` + `campaigns/statistics.py`, `imagery/layouts.py` + `imagery/tile_urls.py`, `annotation/io.py`. When adding logic, prefer extending these pure cores over fattening `service.py`.

Cross-cutting: `config.py` (pydantic-settings `Settings`, env-driven; `get_settings()` is `@lru_cache`d), `database.py` (`SessionLocal`), `crypto.py` (AES-256-GCM at-rest encryption of provider API keys), `utils.py` (Earth Engine init, request-id helpers). `main.py` also defines request-id middleware and the global exception handlers that wrap every error with a `request_id`.

**Auth** is pluggable via `auth/providers/` (`base.py` interface, `firebase.py`, `local.py`), selected by `AUTH_PROVIDER` (`local` = single built-in admin user, no external setup; `firebase` = multi-user). `_validate_production_config()` in `main.py` hard-fails on dev-default secrets when `ENVIRONMENT=production`.

### Data model (imagery)

An imagery **source** holds many time-period **collections** (e.g. monthly); each collection has a Cover slice plus finer **slices** (e.g. weekly) that annotators browse. Date-nearest imagery search spans the whole source, not a single collection. Campaign creation kicks off **background threads** for mosaic registration (STAC searches → item storage → tile URLs) and embedding computation (Earth Engine); both track status `registering → ready/failed` and annotation is blocked until ready.

### Tile flow

For MPC collections with first-valid compositing, the frontend fetches tiles **directly from MPC** (fast path, no tiler). Everything else (non-MPC catalogs, compositing/masking) goes through the self-hosted tiler, authorized by an HttpOnly `tiler_token` cookie the backend mints (HS256, shared `TILER_TOKEN_SECRET`). The dev stack runs **db + backend + frontend only**; to exercise the tiler, run the `stacnotator-tiler` repo and set `TILERS`/`DEFAULT_TILER` on the backend service. See `docs/tile-serving.md` and `docs/tilers.md`.

## Frontend architecture

Feature-sliced under `frontend/src/`:
- `app/` — `router.tsx`, providers (`app/providers/AuthProvider.tsx`)
- `features/<name>/` — `annotation`, `campaigns`, `customLayers`, `auth`, `account`, `settings`, `home`, `layout`. Each has `components/`, `hooks/`, `pages/`, `stores/` (Zustand), `utils/`
- `shared/` — cross-feature `ui/`, `hooks/`, `utils/`
- `api/` — generated client (`client/`), `hey-api.ts` config, plus `stacBrowser.ts` and `tilerToken.ts`

The annotation feature is the heart of the app. Two campaign modes drive parallel component sets: **Task Mode** (predefined locations, `ControlsTaskMode`/`TaskModeMap`) and **Open Mode** (free-form, `ControlsOpenMode`/`OpenModeMap`). Maps are OpenLayers (`features/annotation/components/Map/`): `layerManager.ts`, `useSliceLayers.ts`, and tile prefetching (`tilePreloader.ts`, `useTilePreloading.ts`). State is Zustand stores. The whole annotation workflow supports keyboard hotkeys.

## Conventions & guardrails

- **Code is mostly self-documenting** — avoid explanatory comments; prefer clear names and low complexity (see `CONTRIBUTING.md`).
- **Branching**: feature work on `feature/*`|`fix/*`|`refactor/*`|`hotfix/*` → PR into `develop` (the deployed integration branch) → `develop` merged into `main` for production releases. Open PRs against `develop`. `@rohansaw` is the default reviewer (`.github/CODEOWNERS`); `/.github/` and `/azure_deploy/` changes always need owner review. See `docs/development.md`.
- **Production is Azure** (Container Apps for backend/tiler, Static Web App for frontend; PostgreSQL + Key Vault). Prod deploys via CI on push to `main` (gated by the `production` GitHub Environment); never assume local nginx/CSP behavior matches prod. Deployment scripts in `azure_deploy/`.
- **Tests**: pure logic → DB-free unit tests in `backend/tests/unit/`; DB-bound code → real Postgres. E2E (Playwright, `frontend/e2e/`) must be deterministic under parallelism — observe via DOM (`data-*`, rendered text) and `waitForResponse`, never via store globals or cache-dependent tile requests. Tests focus on central business-logic, and must test actual units / user flows. We avoid bloating the test suit with unecessary tests
- Backend lint: ruff (line-length 100, rules `E/W/F/I/UP/B/SIM/T20` — note `T20` forbids leftover `print`s). Frontend: eslint + prettier + strict `tsc`.
- Install hooks once with `make pre-commit-install`.

## Further docs

`docs/architecture.md` (services overview), `docs/development.md` (branching/CI/deploy), `docs/features.md` (full feature list), `docs/tile-serving.md` + `docs/tilers.md` (tiler internals), `azure_deploy/README.md` (deployment).

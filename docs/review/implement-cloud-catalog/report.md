# Azure catalog implementation handoff

## Outcome

Implemented and running locally on `feature/158-cloud-catalog-import`, based on
develop commit `310596a3`. Core commits: `68802fe8` (backend), `a78a03c3`
(frontend/private development configuration), `03b8dd23` (internal tiler routing).
Companion tiler head: `04e6b7e` on its `feature/158-cloud-catalog-import` branch.
No changes were pushed or merged into develop/main.

Open http://localhost:5173/projects/1/catalogs or
http://localhost:5173/organizations/1/catalogs. The migrated database retains both
ready Ukraine campaigns. The private tiler is running on localhost:8083, is
granted to Dev Org, and advertises Azure import capabilities to the backend.
The catalog list is empty: no real Azure container/SAS was supplied.

## Acceptance evidence

| Behavior | Evidence |
| --- | --- |
| Scope ownership, write-only credential, authorized reuse/management | `backend/tests/test_cloud_imagery_api.py`: creation, ownership, ready reuse and org management tests |
| Paginated Azure selection and explicit time inputs | API discovery/invalid-selection tests; nine `importFiles.test.ts` cases |
| Imports do not wait on processing; admission and batches are bounded | `test_import_runs_in_background_in_bounded_batches_and_becomes_ready`, `test_imports_are_bounded_globally_and_one_per_collection` |
| Missing/unusable/changed inputs fail without publishing | API unusable-object tests and tiler whole-batch failure tests |
| Checkpoints, retry and stale-worker completion fencing | API retry/interrupted/swept-import regression tests |
| Completed catalogs have exactly the expected items and finite extents | Tiler verify tests and real pgstac smoke |
| Instant and interval dates; overlap searches | Time-input tests, tiler overlap tests and real pgstac search |
| Existing presets are copied into campaigns | API preset-copy test; shared VizTabs/conversion pipeline |
| Managed reference prevents caller overrides; area changes preserve identity | `test_managed_catalog_reference.py` |
| Progress, terminal refresh and retry are visible | Three `cloud-catalog-import.spec.ts` browser scenarios |
| Catalog service errors do not remove existing source options | Browser reproduction of malformed list; unchanged navigation-panel source-save test passes after query guard |
| Backend calls use the internal tiler URL | Two transport regression cases; live authenticated capability handshake |
| Private deployment boundary | Tiler managed-flag tests; public STAC service removed from standalone Compose |
| Real local page | Chromium renders project catalog form with hosted selected and no console/page/request errors |

## Commands and results

Commands run in the implementation worktree unless stated otherwise.

| Check | Result |
| --- | --- |
| Backend `run-core-catalog-gate.py --full` (pytest, Ruff, mypy wrapper) | 1528 passed; Ruff clean; mypy 133 files |
| Tiler `uv run --extra dev pytest -q -p no:cacheprovider` plus Ruff | 123 passed; lint/format clean |
| Frontend `npm run test -- --maxWorkers=4` | 1387 passed, 145 files; unchanged timeouts |
| Frontend `npm run build` | Passed; bundle-size warnings |
| Frontend `npm run typecheck`, `npm run lint`, `npm run format:check` | Passed; ESLint warnings remain |
| Integrated app `BASE_URL=http://127.0.0.1:5173 npx playwright test cloud-catalog-import.spec.ts --workers=1 --reporter=line` | 3 passed; mocked provider API |
| Source-save browser regression, one worker | Passed unchanged after malformed-list guard |
| Full Playwright run, four workers | 300 passed, 15 failed, 17 skipped; not a green release gate |
| Migration upgrade/downgrade/upgrade on isolated Postgres | Passed |
| Real pgstac load/verify/overlap/delete smoke | Passed; synthetic asset URLs, no Azure asset reads |
| Local `docker compose ... run --rm --no-deps backend uv run alembic upgrade head` | Applied bt1cloudcat; no reset |
| Local `/readyz` and live catalog API | Ready, HTTP success |

Session evidence lives under
`/home/v-rsawahn/.copilot/session-state/4890da4c-6161-43d7-8a3c-bca6a4f944af/files/`.
Relevant logs: `core-internal-routing.log`, `frontend-resumed.log`,
`e2e-final.log`, `baseline-browser-resumed.log`, `baseline-other.log`,
`wizard-final.log`; screenshot: `catalog-live.png`.

## Browser gate and attempts

The full browser run exposed one catalog-related crash: an invalid catalog list
reached `.filter` in the wizard. It now displays an inline error without removing
existing source options. The existing source-save scenario passes unchanged.
An additional parallel run reached its later save-warning assertion and failed;
the isolated run passed. It is not counted as a green full-suite run.

Comparisons against the unchanged develop-based app reproduced annotation-label,
Escape/draft, timeline-title, keyed-tile and chart-menu failures. Other initial
timeouts did not reproduce consistently. They remain explicit release-gate work
in CC158-7, not a justification for declaring the full suite green.

Build attempts: tiler one, backend three, frontend two. One code-auditor and one
security-sentinel review pass produced six reproduced defects, fixed in one
repair attempt. Final integration also fixed the malformed-list crash and
internal-address transport defect directly; no additional review was run.

Test-author fixture corrections and formatting-only fingerprint refreshes are
recorded in state.md. Transport test authoring initially tried setting a
read-only settings property; it was corrected to `tilers_raw`, then reproduced
the URL mismatch before the production fix. No assertions or timeouts were
weakened. Session usage start/end was not captured; consult session usage.

## Remaining checks and restrictions

A real Azure import, source mutation/expiry, map rendering, campaign save/reload,
and preset-copy walkthrough remain unverified. This requires a container SAS
with read/list access and valid georeferenced GeoTIFFs. Do not commit credentials.

Used catalogs reject credential replacement. Retired import metadata cleanup is
not fully durable across restart or late remote writes. Deletion/cascade races
need lifecycle coverage. These and the remaining browser failures are tracked
in [backlog.md](backlog.md). S3 is not implemented.

Local implementation is available for evaluation; publication remains held while
the full browser gate and real-Azure acceptance are incomplete.

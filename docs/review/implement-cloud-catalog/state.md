# Implement — Azure cloud catalogs

Scope: Azure catalog creation/reuse in core; bounded import operations in companion tiler.
Core branch: feature/158-cloud-catalog-import; base: 310596a3b2473c0271221c085b349f0d98daec0a.
Tiler branch: feature/158-cloud-catalog-import; base: 1ee0a87.
Tiler worktree: /home/v-rsawahn/projects/stacnotator/tiler-cloud-catalog-158.
Gate: backend pytest/Ruff/mypy; frontend Vitest/Playwright/ESLint/Prettier/TypeScript;
tiler pytest/Ruff. Fingerprints and gate history are retained in the session artifacts.
Protected: specification tests and their configuration, recorded before implementation.
Last checks: tiler GREEN 123/123; full core 1528/1528; frontend units 1387/1387.
Frontend production build and static checks pass; catalog browser scenarios 3/3.
Full browser suite is RED: 300 passed, 15 failed, 17 skipped before the wizard
response guard. Baseline comparisons and the focused repair are in report.md.
Implementation is committed and integrated locally; publication is held.
Build attempts: tiler 1/3, core 3/3, frontend 2/3; one review-fix attempt.

## Acceptance criteria
- Authorized campaign creators can create organization/project-owned Azure catalogs.
- Azure discovery lists files with pagination; credentials remain write-only and encrypted.
- Users select files and provide UTC instants or start/end intervals before import.
- Import reads metadata directly; no preflight inspection, review table/map, or approval gate.
- Import responds without waiting for raster processing and allows ordinary app use.
- Concurrent imports are bounded across web processes; batches/timeouts bound resource use.
- Missing/unreadable files, invalid metadata/time, changed objects and failed batches fail visibly.
- Progress/checkpoints survive polling; interrupted imports fail clearly and support fenced retry.
- Only verified nonempty completed catalogs can be attached to campaigns.
- Organization catalogs can be reused in authorized projects; project catalogs stay in their project.
- Catalog creator with continued scope access/admins can manage; no secret or metadata leakage.
- Existing visualization controls/preset pipeline is reused; preset edits never alter existing campaigns.
- Campaign save/reload/registration supports managed catalogs without re-ingesting an external STAC API.
- Region feedback distinguishes supplied/unknown data region and configured/unknown tiler location.
- Existing campaign/visualizer/public-access restrictions continue to hold.

## Execution
One test author defines public contracts and failing tests across both repos.
Sequential workers: tiler, core backend, frontend integration; shared interfaces freeze in tests first.
Lead runs each gate. One final code/security review pass, then targeted fixes if reproduced.
Manual checks: real Azure credentials/data not available; provider fakes plus local raster integration.
Live browser smoke and responsiveness check required; no paid cloud resource creation.

## Decisions
Reuse registration-thread mechanism; no separate worker service, Redis, Celery, or generic pipeline.
No inspection-results persistence/UI; only import inputs, checkpoints and final STAC metadata.
No S3 implementation in this first Azure delivery; retain a narrow storage discovery boundary.
Keep companion checkout and its untracked .dockerignore untouched; edits only in isolated worktree.
No main/develop publication without explicit approval; feature branches only.
Usage: see /usage. Agents use configured defaults.

## Attempt notes
- Tiler attempt 1: 120 tests plus Ruff check/format passed; commits 0aaa555, 981f066.
- Core attempt 1: schema/provider groundwork only; API absent, 30 failures.
- Core attempt 2: API/import orchestration built; 34 passed, two test-helper TypeErrors.
- Lead repaired `_create` positional-only argument, leaving every assertion unchanged;
  invalid owner payloads now reach API. Re-recorded 36-test baseline, all 36 passed.
- Core test DB credentials are taken privately from existing dev container; no guessed password.
- A gate invocation from wrong cwd falsely reported missing protected files; no tests were deleted.
- Worker checkout isolation required core worktree .copilot/worktrees/cloud-catalog.
- User explicitly authorized pairing marker for isolated companion tiler commits.
- Review regressions fixed: completion fencing, managed ROI reconstruction, encoded
  blob filenames, stale terminal-poll UI, organization management permissions, and
  generic-query access to managed collection IDs. See review.md.
- User approved private-import-only tiler deployment and removal of its optional
  public STAC service. Managed endpoints default off outside that private setup.
- Full frontend parallelism hit one 5-second timeout in an existing large-list
  test. The complete suite passed with four workers and unchanged timeouts.
- Prettier reformatted the author's time-input test. TypeScript AST comparison
  confirmed identical assertions/input values; the fingerprint was re-recorded
  and all nine tests rerun. The initial token-level comparison was too strict
  because quote style and optional trailing commas changed.
- Real migration upgrade/downgrade/upgrade and real pgstac load/verify/overlap-query/
  repeated-delete smoke checks passed. No live Azure container was available.
- Final browser trace exposed malformed catalog-list data crashing the existing
  source wizard. The query now reports that error in place; the existing source
  save scenario passes unchanged. No new review pass was run.
- Live deployment exposed catalog transport using the public rather than internal
  tiler URL. Two regression cases pin internal routing and public fallback; the
  corrected shared resolver serves every catalog endpoint. Full backend: 1528.
- Main feature checkout now includes 68802fe8, a78a03c3 and 03b8dd23. Applied
  bt1cloudcat without resetting the database; both Ukraine campaigns remain ready.
- Local private tiler is enabled in ignored .env and granted to Dev Org. Actual
  backend-to-tiler capabilities return Azure support and max_batch_items=100.
- Chromium verified the real project catalog form at http://localhost:5173 with
  hosted selected and no console/page/request errors. Use localhost, not 127.0.0.1:
  the latter is not in the current local cross-origin allowlist.

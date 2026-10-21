# Project-only catalogs

Scope: remove organization catalog ownership, UI and custom permission branches.
Base: 98631eb1. Keep import/retry behavior and tiler APIs unchanged.
Contract: required flat project_id; project/platform administrators manage catalogs.
No cross-project catalog reuse, including within one organization.
Local catalog/import/file tables and campaign references are empty.
Per user instruction, edit the original unreleased migration, not a new upgrade.
Baseline: HTTP create returned 422 for project_id; browser found the unwanted Imagery tab.
Tests: existing catalog API, managed-reference and browser cases; no separate test framework.
Protected: those test files and frontend test configuration.
Attempt: 1/3 GREEN: 72 API/reference tests, 8 browser cases, scoped lint/format/types.
Revised original migration passed downgrade/upgrade twice in an isolated database.
Review: no introduced Important findings. Existing deletion/context issues recorded in backlog.
Test-author checkout writes were blocked; author supplied a patch, applied by the lead.
Worker uses a private clone to avoid concurrent-checkout writes.

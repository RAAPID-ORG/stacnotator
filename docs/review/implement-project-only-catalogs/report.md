# Project-only catalog reduction

Removed organization ownership from the model, API, permissions and UI.
Catalogs use a required project_id and the existing project-admin guard.
The original unreleased bt1cloudcat migration was edited as requested.

One implementation attempt: 72 API/reference tests and 8 browser cases passed.
Backend Ruff/mypy and frontend typecheck/scoped ESLint/Prettier passed.
The original migration passed two downgrade/upgrade cycles on an isolated schema.
Protected specification files remained unchanged during implementation.

One review: no introduced Important findings. Project deletion with an in-use
catalog and cross-project URL selection remain recorded in the cloud-catalog backlog.
No tiler changes. Real Azure acceptance and the broader browser gate remain open.
Usage: see /usage.

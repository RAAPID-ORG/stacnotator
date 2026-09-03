# Development

How we branch, review, test, and ship STACNotator. For deployment details see [deployment/azure/README.md](../deployment/azure/README.md), for contribution etiquette see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Branching

Feature work happens on `feature/*`, `fix/*`, `refactor/*`, or `hotfix/*` branches.

- Branches are merged via pull request into `develop`.
- `develop` is the integration branch and is deployed (manually) to the dev environment for testing.
- `develop` is merged into `main` for releases. `main` is production.

## Pull requests & review

- Open PRs against `develop`.
- `.github/CODEOWNERS` makes `@rohansaw` the default reviewer. Changes under `/.github/` and `/deployment/azure/` (CI and production-credentialed paths) always require owner review.
- Include a short description, add tests where applicable, and keep code mostly self-documenting.
- PRs are merged with GitHub's "Merge pull request".

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `main` and `develop`:

| Job             | What it runs                                     | When                           |
| --------------- | ------------------------------------------------ | ------------------------------ |
| Secret scanning | Gitleaks                                         | every CI run                   |
| Backend lint    | Ruff lint + format check (Python 3.12 via `uv`)  | every CI run                   |
| Frontend lint   | ESLint, `tsc --noEmit`, Prettier check (Node 22) | every CI run                   |
| Backend tests   | Dockerized `pytest`                              | `develop`/`main` + PRs to them |
| Frontend E2E    | Playwright with mocked APIs                      | `main` + PRs to `main`         |
| Docker build    | Production images (backend, tiler, frontend)     | `main` + PRs to `main`         |

Test and docker-build jobs only run after the lint jobs pass. Pushes to feature branches without an open PR trigger no CI.

## Local checks before pushing

Install the pre-commit hooks once (`.pre-commit-config.yaml` covers whitespace/yaml/json/toml checks, Gitleaks, Ruff for the backend, and ESLint/`tsc`/Prettier for the frontend):

```bash
make pre-commit-install
```

Run tests and type checks locally:

```bash
make test              # backend pytest + SDK pytest + frontend Playwright
make test-backend      # backend only (test-sdk / test-e2e for the others)
make lint              # ruff + eslint (backend, frontend, sdk)
make format-check      # ruff format --check + prettier --check
make typecheck         # mypy (backend + sdk) + tsc --noEmit
make ci-check          # all of the above, mirrors CI
```

The frontend also exposes `npm run test` (vitest unit tests) and `npm run test:e2e` (Playwright) directly.

To measure cold imagery navigation against the real campaign 113 configuration
and Planetary Computer tiles, run the frontend's
`npm run benchmark:campaign-113`. It selects five random, spatially separated
tasks and fails a sample if its center tiles were already requested by that
browser page. The output separates navigation-to-request, request-to-response,
and response-to-canvas-paint timings. Set `BENCH_TASK_IDS=50150,50230,...` to
repeat the same tasks against another build, and `BASE_URL` to choose that
build. This benchmark is opt-in and is skipped by the normal E2E suite because
it depends on the local campaign database and external network latency.

Backend tests are split: pure logic lives in DB-free unit tests under `backend/tests/unit/`, everything else in `backend/tests/` runs against a real Postgres (CI starts the dev-compose `db` for this). E2E specs live in `frontend/e2e/` and run against mocked APIs.

## Deployment

- **Production:** pushing to `main` triggers the `deploy-prod` job in CI, gated by the `production` GitHub Environment (manual approval). It runs `deployment/azure/deploy.sh prod` on a GitHub-hosted runner, via the reusable `.github/workflows/deploy.yml`.
- **Dev:** run the `Deploy Dev` workflow manually (`workflow_dispatch`); it only runs on `develop` and is gated by the `dev` Environment. Can be run via the GH Action -> workflows page.

See [deployment/azure/README.md](../deployment/azure/README.md) for the full deployment workflow.

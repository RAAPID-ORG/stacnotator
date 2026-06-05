# Development

How we branch, review, test, and ship STACNotator. For deployment details see [azure_deploy/README.md](../azure_deploy/README.md), for contribution etiquette see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Branching

Feature work happens on `feature/*`, `fix/*`, `refactor/*`, or `hotfix/*` branches.

- Branches are merged via pull request into `develop`.
- `develop` is the integration branch and is deployed (manually) to the dev environment for testing.
- `develop` is merged into `main` for releases. `main` is production.

## Pull requests & review

- Open PRs against `develop`.
- `.github/CODEOWNERS` makes `@rohansaw` the default reviewer. Changes under `/.github/` and `/azure_deploy/` (CI and production-credentialed paths) always require owner review.
- Include a short description, add tests where applicable, and keep code mostly self-documenting.
- PRs are merged with GitHub's "Merge pull request".

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `main` and `develop`:

| Job | What it runs | When |
|---|---|---|
| Secret scanning | Gitleaks | all branches |
| Backend lint | Ruff lint + format check (Python 3.12 via `uv`) | all branches |
| Frontend lint | ESLint, `tsc --noEmit`, Prettier check (Node 22) | all branches |
| Backend tests | Dockerized `pytest` | `develop`/`main` + PRs to them |
| Frontend E2E | Playwright with mocked APIs | `main` + PRs to `main` |
| Docker build | Production images (backend, tiler, frontend) | `main` only |

## Local checks before pushing

Install the pre-commit hooks once (`.pre-commit-config.yaml` covers whitespace/yaml/json/toml checks, Gitleaks, Ruff for the backend, and ESLint/`tsc`/Prettier for the frontend):

```bash
make pre-commit-install
```

Run tests and type checks locally:

```bash
make test              # backend pytest + frontend Playwright
make test-backend      # backend only
make test-e2e          # frontend E2E only
make typecheck         # mypy + tsc --noEmit
```

The frontend also exposes `npm run test` (vitest unit tests) and `npm run test:e2e` (Playwright) directly.

## Deployment

- **Production:** pushing to `main` triggers the `deploy-prod` job in CI, gated by the `production` GitHub Environment (manual approval). It runs `azure_deploy/deploy-app.sh prod` on the self-hosted Azure runner.
- **Dev:** run the `Deploy Dev` workflow manually (`workflow_dispatch`); it only runs on `develop` and is gated by the `dev` Environment. Can be run via the GH Action -> workflows page.

See [azure_deploy/README.md](../azure_deploy/README.md) for the full deployment workflow.

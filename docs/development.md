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

| Job                                 | What it runs                                                           | When                                                        |
| ----------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| Secret scanning                     | Gitleaks                                                               | every CI run                                                |
| Backend lint                        | Ruff lint + format check (Python 3.12 via `uv`)                        | every CI run                                                |
| Frontend lint                       | ESLint, `tsc --noEmit`, Prettier check (Node 22)                       | every CI run                                                |
| Backend tests                       | Dockerized `pytest`                                                    | `develop`/`main` + PRs to them                              |
| Frontend E2E                        | Playwright with mocked APIs                                            | `main` + PRs to `main`                                      |
| Docker build and vulnerability scan | Production images (backend, tiler, frontend) and frontend dependencies | every CI run                                                |
| CodeQL                              | Python, JavaScript/TypeScript and GitHub Actions source-code analysis  | pushes/PRs to `main`/`develop`, weekly on `main`, or manual |

Backend tests and vulnerability scans run after the lint jobs pass. The required
`Docker: Production Build` check reports whether all builds and scans succeeded,
including a failure when prerequisite scans were skipped. Pushes to feature
branches without an open PR trigger no CI.

The reusable `vulnerability-scan.yml` workflow uses Trivy to scan production images
for known OS and library vulnerabilities, and the frontend lockfile for dependency
vulnerabilities, including development/build dependencies. All severities are
reported in the workflow logs. High and critical findings block production CI
deployment and manual dev deployment, including findings without an available fix,
unless they are listed in `.trivyignore.yaml`. Scanner errors also block deployment.
These scans cover newly built images, not continuous monitoring of deployed images.
Deployment still rebuilds images, so the scans do not guarantee that the deployed
artifacts contain exactly the same dependencies as the scanned images.

Scanned builds pull current base images. The backend and tiler Dockerfiles apply
Debian stable updates, remove unused mount tools, and clear setuid/setgid bits
from system command directories before switching to their non-root users.
This reduces privilege-escalation paths; it does not patch remaining library
advisories.

`.trivyignore.yaml` lists Debian advisories that have no fixed package and were
triaged as not reachable from the backend or tiler. Each entry names its CVE,
the affected packages and the reason, and expires on a set date. The report step
still shows these findings. After an entry expires, the gate blocks on it again:
recheck the reasoning, then extend the date or fix the finding. Add an entry only
after the same triage; never raise the severity threshold instead.

Tiler scans and deployments build the tiler's `main` branch unless the
`TILER_REPO_REF` repository variable names another ref.

The frontend overrides the SWA CLI's `adm-zip` and `devcert`'s `tmp` dependencies
to patched releases outside their upstream version ranges. These overrides affect
deployment tooling, not the browser bundle.

### CodeQL setup transition

The advanced `.github/workflows/codeql.yml` workflow preserves CodeQL's default
security queries. GitHub's CodeQL security ruleset requires results and blocks
high/critical security alerts on both `main` and `develop`, with no admin bypass.

Advanced jobs run only when the repository variable `CODEQL_ADVANCED_SETUP` is
`true`. Until cutover, leave it unset and keep GitHub default setup enabled so
source scanning continues without conflicting advanced uploads. This explicit
switch avoids giving the workflow repository-administration credentials to read
the default-setup configuration.

Keep GitHub default setup enabled while this workflow is only on `develop`.
After merging it to `main`, disable default setup, enable the advanced workflow,
and manually run it on both branches:

```bash
gh api --method PATCH repos/RAAPID-ORG/stacnotator/code-scanning/default-setup \
  -f state=not-configured
gh variable set CODEQL_ADVANCED_SETUP --repo RAAPID-ORG/stacnotator --body true
gh workflow run codeql.yml --repo RAAPID-ORG/stacnotator --ref main
gh workflow run codeql.yml --repo RAAPID-ORG/stacnotator --ref develop
```

Default setup and advanced analysis must not be enabled together: GitHub rejects
advanced CodeQL uploads while default setup is enabled. Verify successful advanced
analyses for all three languages on both branches before considering the switch
complete. The existing CodeQL merge ruleset remains in place during the transition.

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

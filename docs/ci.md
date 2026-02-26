# CI & Code Quality

## Quick Reference

```bash
make ci-check          # Run ALL checks locally (same as CI)
make lint              # Lint both backend and frontend
make typecheck         # Type check both backend and frontend
make format-check      # Check formatting both backend and frontend
make pre-commit-run    # Run all pre-commit hooks on all files
```

## Setup

### Pre-commit Hooks (required for all contributors)

```bash
cd backend
uv sync                    # Install dev dependencies (includes pre-commit)
uv run pre-commit install  # Install git hooks
```

Or from the project root:

```bash
make pre-commit-install
```

### What runs on every commit

| Hook | What it does |
|------|-------------|
| **gitleaks** | Blocks commits containing secrets, API keys, tokens |
| **ruff** | Python linting with auto-fix |
| **ruff-format** | Python formatting |
| **mypy** | Python type checking |
| **eslint** | TypeScript/React linting |
| **tsc --noEmit** | TypeScript type checking |
| **trailing-whitespace** | Removes trailing whitespace |
| **end-of-file-fixer** | Ensures files end with newline |
| **no-commit-to-branch** | Prevents direct commits to `main` |

## CI Pipeline (GitHub Actions)

### Branch Strategy

| Trigger | Secrets | Lint + Types | Tests | Docker Build |
|---------|---------|-------------|-------|-------------|
| PR / feature branch | ✅ | ✅ | ❌ | ❌ |
| `dev` branch | ✅ | ✅ | ✅ | ❌ |
| `main` branch | ✅ | ✅ | ✅ | ✅ |

### Jobs

- **Secret Scanning** - gitleaks on full history
- **Backend: Lint & Type Check** - ruff check, ruff format --check, mypy
- **Frontend: Lint & Type Check** - eslint, tsc --noEmit, prettier --check
- **Backend: Tests** - pytest with PostGIS service container (dev/main only)
- **Docker: Build Verification** - builds both images (main only)

## Individual Commands

### Backend

```bash
cd backend
uv run ruff check src/          # Lint
uv run ruff check src/ --fix    # Lint with auto-fix
uv run ruff format src/         # Format
uv run ruff format --check src/ # Check formatting
uv run mypy src/                # Type check
uv run pytest tests/ -v         # Tests
```

### Frontend

```bash
cd frontend
npm run lint          # ESLint
npm run lint:fix      # ESLint with auto-fix
npm run typecheck     # TypeScript type check
npm run format        # Prettier format
npm run format:check  # Check formatting
```

## Configuration Files

| File | Purpose |
|------|---------|
| `.pre-commit-config.yaml` | Pre-commit hook definitions |
| `.github/workflows/ci.yml` | GitHub Actions CI pipeline |
| `.gitleaks.toml` | Secret detection allowlist |
| `backend/pyproject.toml` | Ruff, mypy, pytest config |
| `frontend/eslint.config.js` | ESLint flat config (v9) |
| `frontend/tsconfig.json` | TypeScript config |

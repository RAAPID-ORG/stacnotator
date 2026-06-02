# Frontend

React 19 + Vite + OpenLayers application.

## Stack

- **React 19** with hooks and functional components
- **OpenLayers** for map rendering (tile layers, vector overlays, interactions)
- **Zustand** for client state (map view, active layers, task navigation, preferences)
- **Tailwind CSS 4** for styling
- **Vite** for dev server (HMR) and production builds
- **Playwright** for E2E tests

## API Client

The backend client is auto-generated from the backend's OpenAPI spec using `@hey-api/openapi-ts`:

```bash
# Backend must be running at localhost:8000
npm run openapi-ts
```

Generated files live in `src/api/client/` and should not be edited by hand. The configured client (`src/api/hey-api.ts`) adds auth token injection and 401 retry logic.

For endpoints not in the OpenAPI spec (e.g. direct file uploads with progress tracking), write thin wrappers in `src/api/`.

## Auth

Two modes, both transparent to most frontend code:
- **Firebase** - Google/email login; ID tokens attached to every request via the `hey-api.ts` interceptor
- **Local** - single built-in user for local dev; no Firebase setup needed

## Structure

```
src/
├── api/              # Generated SDK + manual wrappers (customMaps.ts for XHR upload)
├── features/
│   ├── annotation/   # Map, tasks, annotation tools, layer/custom-map management
│   ├── campaigns/    # Campaign creation wizard, settings pages, imagery editor
│   ├── auth/         # Auth adapters (Firebase, local)
│   ├── account/      # User profile, approval state
│   └── layout/       # Global layout store
└── shared/           # UI components, utilities
```

## Development

```bash
# Runs inside Docker with HMR - see root README
make dev-up
```

Frontend runs at http://localhost:5173. No separate `npm install` needed - packages are installed inside the container.

To install a new npm package:
```bash
make dev-frontend-npm PKG="package-name"
```

To fully rebuild the frontend container (e.g. after stale node_modules):
```bash
make dev-rebuild-frontend
```

## Conventions

- **File naming**: PascalCase for components, camelCase for hooks/utils, kebab-case for directories
- **Auth**: Never read tokens directly - use the generated client or `authManager.getIdToken()`
- **API calls**: Prefer generated SDK functions; only hand-write when the generated client can't express it (file upload progress, XHR)
- **Comments**: Only when the why is non-obvious
- Run `npm run format` before committing

## Tests

Unit tests (Vitest):
```bash
cd frontend && npx vitest run
```

E2E tests (Playwright):
```bash
# Inside the frontend container
npx playwright test
```

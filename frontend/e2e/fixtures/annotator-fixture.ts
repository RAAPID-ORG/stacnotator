/**
 * Core Playwright fixture that:
 *   1. Bypasses Firebase auth entirely (injects auth state into the app)
 *   2. Mocks backend API endpoints with deterministic data
 *   3. Exposes helpers to capture and assert on outgoing API requests
 *
 * Tests import `test` and `expect` from this file instead of @playwright/test.
 */
import { test as base, expect, type Page, type Route } from '@playwright/test';
import {
  MOCK_USER,
  MOCK_CAMPAIGN,
  MOCK_TASK_LIST,
  MOCK_CAMPAIGN_USERS,
  MOCK_CAMPAIGN_USERS_AUTHORITATIVE,
  ALL_TASKS,
  makeSubmitResponse,
  makeDeleteResponse,
} from './mock-data';

/** Captured API request for assertions. */
export interface CapturedRequest {
  method: string;
  url: string;
  pathname: string;
  body: any;
  /** e.g. { campaign_id: '42', annotation_task_id: '100' } */
  pathParams: Record<string, string>;
}

/** Captures API calls matching a pattern. */
export class ApiCapture {
  readonly requests: CapturedRequest[] = [];

  get last(): CapturedRequest | undefined {
    return this.requests[this.requests.length - 1];
  }

  get count(): number {
    return this.requests.length;
  }

  clear(): void {
    this.requests.length = 0;
  }

  /** Returns all requests whose pathname matches a regex. */
  filter(pattern: RegExp): CapturedRequest[] {
    return this.requests.filter((r) => pattern.test(r.pathname));
  }
}

/** Extract path params from a URL pattern like /api/campaigns/{campaign_id}/... */
function extractPathParams(pathname: string): Record<string, string> {
  const patterns: [RegExp, string[]][] = [
    [
      /^\/api\/campaigns\/(\d+)\/(\d+)\/annotate$/,
      ['campaign_id', 'annotation_task_id'],
    ],
    [
      /^\/api\/campaigns\/(\d+)\/annotation-tasks$/,
      ['campaign_id'],
    ],
    [
      /^\/api\/campaigns\/(\d+)\/annotations\/(\d+)$/,
      ['campaign_id', 'annotation_id'],
    ],
    [
      /^\/api\/campaigns\/(\d+)\/detailed$/,
      ['campaign_id'],
    ],
    [
      /^\/api\/campaigns\/(\d+)\/users$/,
      ['campaign_id'],
    ],
    [
      /^\/api\/campaigns\/(\d+)\/(\d+)\/validate$/,
      ['campaign_id', 'annotation_task_id'],
    ],
  ];

  for (const [re, names] of patterns) {
    const m = pathname.match(re);
    if (m) {
      const result: Record<string, string> = {};
      names.forEach((name, i) => (result[name] = m[i + 1]));
      return result;
    }
  }
  return {};
}

async function parseBody(route: Route): Promise<any> {
  try {
    const req = route.request();
    return req.postDataJSON();
  } catch {
    return null;
  }
}

/**
 * Wait for the task store's `isNavigating` flag to clear.
 *
 * The store sets `isNavigating: true` for ~500ms after every task change
 * (nextTask/previousTask/goToTask/setTaskFilter/submitAnnotation auto-advance)
 * and silently drops `w`/`s`/Enter keypresses while it's true. Waiting on
 * the DOM ("Loading…" button text) is racy: the text can flash by faster than
 * Playwright's polling interval. The store flag is the authoritative signal.
 *
 * Source exposes `__TASK_STORE__` to window in dev/test mode.
 */
/**
 * Re-mock the campaign-users endpoint so the current user is an authoritative
 * reviewer, then reload the page so the campaign store picks it up. Must be
 * called on a page that already went through `annotationPage` setup.
 */
export async function elevateToAuthoritativeReviewer(page: Page): Promise<void> {
  // Re-registered routes take precedence (Playwright runs in LIFO order).
  await page.route('**/api/campaigns/*/users', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: MOCK_CAMPAIGN_USERS_AUTHORITATIVE });
  });
  await page.reload();
  await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
  await page.waitForSelector('[data-tour="controls"]', { timeout: 10_000 });
  await page
    .locator('button', { hasText: /^(Submit|Update)$/ })
    .first()
    .waitFor({ state: 'visible', timeout: 5000 });
}

export async function waitForNavIdle(page: Page, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    () => {
      const store = (window as unknown as { __TASK_STORE__?: { getState: () => { isNavigating: boolean; isSubmitting: boolean } } }).__TASK_STORE__;
      if (!store) return false;
      const s = store.getState();
      return !s.isNavigating && !s.isSubmitting;
    },
    undefined,
    { timeout }
  );
}

export type AnnotatorFixtures = {
  /** All captured API requests */
  api: ApiCapture;
  /**
   * Navigate to the annotation page for campaign 42 with all API mocks active.
   * The page will be fully loaded with task data visible.
   */
  annotationPage: Page;
};

export const test = base.extend<AnnotatorFixtures>({
  api: async ({}, use) => {
    await use(new ApiCapture());
  },

  annotationPage: async ({ page, api }, use) => {
    // Track ongoing task list data (mutable so tests can change it mid-flight)
    let taskListData = { ...MOCK_TASK_LIST };

    // Mock API routes
    // IMPORTANT: Playwright checks routes in LIFO order (last registered = highest priority).
    // Register catch-all FIRST so specific routes override it.

    // Catch-all: any unhandled /api/ call -> 200 so tests don't crash
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const pathname = new URL(url).pathname;
      // Skip Vite module requests (they contain /src/ or /node_modules/)
      if (pathname.includes('/src/') || pathname.includes('/node_modules/')) {
        return route.fallback();
      }
      console.warn(`[E2E] Unhandled API call: ${route.request().method()} ${url}`);
      api.requests.push({
        method: route.request().method(),
        url,
        pathname,
        body: null,
        pathParams: {},
      });
      await route.fulfill({ status: 200, json: {} });
    });

    // Tile requests: record them and return a 1x1 transparent PNG
    await page.route('**/tiles.example.com/**', async (route) => {
      api.requests.push({
        method: 'GET',
        url: route.request().url(),
        pathname: new URL(route.request().url()).pathname,
        body: null,
        pathParams: {},
      });
      const PIXEL =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlJRXRFWHRkYXRl' +
        'OmNyZWF0ZQAyMDI0LTAxLTAxVDAwOjAwOjAwKzAwOjAw5x5CGQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNC0wMS0w' +
        'MVQwMDowMDowMCswMDowMJZD+qUAAAAASUVORK5CYII=';
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(PIXEL, 'base64'),
      });
    });

    // Now register specific routes (these have higher priority than the catch-all above)

    // GET /api/auth/me
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({ json: MOCK_USER });
    });

    // GET /api/campaigns/:id/detailed  (getCampaignWithImageryWindows)
    await page.route('**/api/campaigns/*/detailed', async (route) => {
      api.requests.push({
        method: 'GET',
        url: route.request().url(),
        pathname: new URL(route.request().url()).pathname,
        body: null,
        pathParams: extractPathParams(new URL(route.request().url()).pathname),
      });
      await route.fulfill({ json: MOCK_CAMPAIGN });
    });

    // GET /api/campaigns/:id/users
    await page.route('**/api/campaigns/*/users', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({ json: MOCK_CAMPAIGN_USERS });
    });

    // GET /api/campaigns/:id/annotation-tasks
    await page.route('**/api/campaigns/*/annotation-tasks', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      api.requests.push({
        method: 'GET',
        url: route.request().url(),
        pathname: new URL(route.request().url()).pathname,
        body: null,
        pathParams: extractPathParams(new URL(route.request().url()).pathname),
      });
      await route.fulfill({ json: taskListData });
    });

    // POST /api/campaigns/:id/:taskId/annotate  (completeAnnotationTask)
    await page.route('**/api/campaigns/*/*/annotate', async (route) => {
      const body = await parseBody(route);
      const pathname = new URL(route.request().url()).pathname;
      api.requests.push({
        method: 'POST',
        url: route.request().url(),
        pathname,
        body,
        pathParams: extractPathParams(pathname),
      });
      const resp = makeSubmitResponse(
        Number(extractPathParams(pathname).annotation_task_id),
        body?.label_id ?? null,
        body?.comment ?? null,
        body?.confidence ?? 5
      );
      await route.fulfill({ json: resp });
    });

    // DELETE /api/campaigns/:id/annotations/:annId
    await page.route('**/api/campaigns/*/annotations/*', async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      const pathname = new URL(route.request().url()).pathname;
      api.requests.push({
        method: 'DELETE',
        url: route.request().url(),
        pathname,
        body: null,
        pathParams: extractPathParams(pathname),
      });
      await route.fulfill({ json: makeDeleteResponse() });
    });

    // GET /api/campaigns/:id/:taskId/validate  (KNN validation)
    await page.route('**/api/campaigns/*/*/validate*', async (route) => {
      await route.fulfill({ json: { status: 'ok' } });
    });

    // GET /api/campaigns/:id/knn-validation-status (campaign-level KNN counts)
    await page.route('**/api/campaigns/*/knn-validation-status', async (route) => {
      await route.fulfill({
        json: {
          required_total: 5,
          required_per_label: 3,
          total_labeled_with_embedding: 0,
          per_label_counts: {},
        },
      });
    });

    // Bypass Firebase auth
    // Monkey-patch the Firebase Auth module so the app sees a logged-in
    // user immediately, without any real Firebase network traffic.
    //
    // How it works:
    //   - `getAuth()` returns a fake auth object with `currentUser` set
    //   - `onAuthStateChanged()` fires the callback synchronously with a
    //     truthy user so AuthProvider/AuthGate proceed instantly
    //   - `currentUser.getIdToken()` returns a fake token string
    //   - `signOut()` is a no-op
    //   - All Firebase network calls are blocked to avoid side effects

    await page.addInitScript(() => {
      // Suppress the first-visit guided tour: tests need the annotation
      // toolbar reachable without an overlay on top. Key format must match
      // tourSeenKey() in AnnotationPage.tsx.
      try {
        localStorage.setItem('stacnotator:tour-seen:test-user-abc-123:42', '1');
      } catch {
        // localStorage unavailable - ignore
      }

      const fakeUser = {
        uid: 'test-user-abc-123',
        email: 'test@example.com',
        displayName: 'Test User',
        getIdToken: () => Promise.resolve('fake-firebase-id-token'),
        getIdTokenResult: () =>
          Promise.resolve({
            token: 'fake-firebase-id-token',
            claims: {},
            expirationTime: new Date(Date.now() + 3600_000).toISOString(),
            issuedAtTime: new Date().toISOString(),
            signInProvider: 'custom',
            authTime: new Date().toISOString(),
            signInSecondFactor: null,
          }),
      };

      const fakeAuth = {
        currentUser: fakeUser,
        onAuthStateChanged: (cb: any) => {
          // Fire immediately so AuthProvider sets ready=true
          setTimeout(() => cb(fakeUser), 0);
          return () => {}; // unsubscribe no-op
        },
        signOut: () => Promise.resolve(),
      };

      // Patch the ES module by intercepting import resolution.
      // Vite serves modules via native ESM, so we override the global
      // firebase/auth functions that the adapters import.
      // We do this by creating a global that our route-level script
      // injection can reference.
      (window as any).__FAKE_FIREBASE_AUTH__ = fakeAuth;
      (window as any).__FAKE_FIREBASE_USER__ = fakeUser;
    });

    // Block all Firebase network traffic so the real SDK never initializes
    await page.route('**/identitytoolkit.googleapis.com/**', (route) => route.abort());
    await page.route('**/securetoken.googleapis.com/**', (route) => route.abort());
    await page.route('**/apis.google.com/**', (route) => route.abort());
    await page.route('**/www.googleapis.com/**', (route) => route.abort());
    await page.route('**/firebaseinstallations.googleapis.com/**', (route) => route.abort());

    // Intercept the Firebase Auth JS module served by Vite and replace
    // the key exports with our fakes. This runs before the app code
    // imports from 'firebase/auth'.
    // Vite optimizes deps to paths like /node_modules/.vite/deps/firebase_auth-HASH.js
    // or /node_modules/.vite/deps/chunk-HASH.js that re-exports firebase_auth.
    // We also intercept firebase/app to prevent initialization errors.
    await page.route(/firebase_auth/, async (route) => {
      // Serve a tiny ESM module that exposes our stubs. Must mirror EVERY
      // export the app's adapters import; missing names cause an ESM
      // resolution error and the page renders blank.
      const body = `
        const fakeAuth = window.__FAKE_FIREBASE_AUTH__;
        const fakeUser = window.__FAKE_FIREBASE_USER__;

        export function getAuth() { return fakeAuth; }
        export function onAuthStateChanged(auth, cb) {
          setTimeout(() => cb(fakeUser), 0);
          return () => {};
        }
        export function signInWithPopup() { return Promise.resolve({ user: fakeUser }); }
        export function signInWithEmailAndPassword() { return Promise.resolve({ user: fakeUser }); }
        export function createUserWithEmailAndPassword() { return Promise.resolve({ user: fakeUser }); }
        export function sendEmailVerification() { return Promise.resolve(); }
        export function sendPasswordResetEmail() { return Promise.resolve(); }
        export function updatePassword() { return Promise.resolve(); }
        export function reauthenticateWithCredential() { return Promise.resolve({ user: fakeUser }); }
        export function signOut() { return Promise.resolve(); }
        export class GoogleAuthProvider { addScope() {} }
        export class EmailAuthProvider {
          static credential(email, password) { return { email, password, providerId: 'password' }; }
        }
        export function connectAuthEmulator() {}
        export function initializeAuth() { return fakeAuth; }
        export function getReactNativePersistence() { return {}; }
        export function browserLocalPersistence() { return {}; }
        export function browserSessionPersistence() { return {}; }
        export function inMemoryPersistence() { return {}; }
        export function setPersistence() { return Promise.resolve(); }

        export default { getAuth, onAuthStateChanged, signOut };
      `;
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body,
      });
    });

    await page.route(/firebase_app/, async (route) => {
      const body = `
        export function initializeApp() { return {}; }
        export function getApp() { return {}; }
        export function getApps() { return [{}]; }
        export default { initializeApp, getApp, getApps };
      `;
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body,
      });
    });

    // Navigate & wait for app to be ready
    await page.goto('/campaigns/42/annotate');

    // Wait for the annotation toolbar to render (data-tour="toolbar" on the <header>)
    await page.waitForSelector('[data-tour="toolbar"]', {
      timeout: 15_000,
    });

    // Wait for the controls panel to render (indicates tasks loaded & first task shown)
    await page.waitForSelector('[data-tour="controls"]', {
      timeout: 10_000,
    });

    // Verify the Submit button is visible (proves task data is fully loaded)
    await page.locator('button', { hasText: /^(Submit|Update)$/ }).first()
      .waitFor({ state: 'visible', timeout: 5000 });

    await use(page);
  },
});

export { expect };

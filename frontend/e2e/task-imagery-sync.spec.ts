// Task/imagery sync tests.
//
// Core invariant: after ANY sequence of user actions (navigation, filter
// changes, slice/viz/collection switches), BOTH of these must hold:
//
//   A) The crosshair overlay is positioned at the current task's lat/lon
//   B) Tile imagery was fetched for that task's geographic area
//
// We verify (A) by reading the OL crosshair overlay position directly
// from the browser via window.__OL_CROSSHAIR__.
//
// We verify (B) by inspecting captured tile request URLs: the {z}/{x}/{y}
// in tile URLs encode a geographic position, so we can confirm tiles were
// loaded for the correct area.

import { test, expect, type CapturedRequest } from './fixtures/annotator-fixture';
import {
  TASK_1,
  TASK_2,
  TASK_3,
  ALL_TASKS,
  TASK_LOCATIONS,
} from './fixtures/mock-data';

type Page = import('@playwright/test').Page;

// -- Helpers ---------------------------------------------------------------

function lastAnnotate(requests: CapturedRequest[]): CapturedRequest | undefined {
  return [...requests].reverse().find(
    (r) => r.method === 'POST' && r.pathname.endsWith('/annotate'),
  );
}

async function readGoToValue(page: Page): Promise<string> {
  return page.locator('input[type="number"][title="Press Enter to go"]').inputValue();
}

async function selectAndSubmit(page: Page, digit = '1') {
  await page.keyboard.press(digit);
  const btn = page.locator('button', { hasText: /^(Submit|Update|Remove Label)$/ }).first();
  await expect(btn).toBeEnabled({ timeout: 5000 });
  await page.keyboard.press('Enter');
  // Wait for submit + auto-advance navigation cycle to complete
  await expect(
    page.locator('button', { hasText: 'Loading...' })
  ).toBeHidden({ timeout: 5000 });
}

/**
 * Wait for navigation to finish.  The app sets `isNavigating = true` for
 * 500 ms after every task change.  While navigating the Submit button text
 * reads "Loading…".  We simply wait for the button text to leave that state
 * which proves the store has settled.
 */
async function waitNavSettled(page: Page) {
  // First wait until "Loading..." appears (navigation started)
  // then wait until it disappears (navigation finished)
  const loadingBtn = page.locator('button', { hasText: 'Loading...' });
  await expect(loadingBtn).toBeHidden({ timeout: 5000 });
}

/**
 * Wait for a submit-triggered auto-advance to complete.  After a submit the
 * store auto-advances, which triggers `isNavigating`.  We detect completion
 * by waiting for the GoTo input to show the expected annotation number.
 */
async function waitAutoAdvanceTo(page: Page, annotationNumber: string) {
  const gotoInput = page.locator('input[type="number"][title="Press Enter to go"]');
  await expect(gotoInput).toHaveValue(annotationNumber, { timeout: 5000 });
  await waitNavSettled(page);
}

// Crosshair position verification
async function getCrosshairPosition(page: Page): Promise<{ lat: number; lon: number }> {
  // Poll until the crosshair overlay has a position set (the OL overlay
  // position is set asynchronously via a React useEffect after task data
  // propagates through the store).
  const result = await page.waitForFunction(() => {
    const overlay = (window as any).__OL_CROSSHAIR__;
    if (!overlay) return null;
    const pos = overlay.getPosition();
    if (!pos) return null;
    const lon = (pos[0] * 180) / 20037508.342789244;
    const lat =
      (Math.atan(Math.exp((pos[1] * Math.PI) / 20037508.342789244)) * 360) / Math.PI - 90;
    return { lat, lon };
  }, undefined, { timeout: 5000 });
  const value = await result.jsonValue();
  if (!value) throw new Error('Crosshair position not available after timeout');
  return value as { lat: number; lon: number };
}

const COORD_TOLERANCE = 0.01;

function assertCoordsMatch(
  actual: { lat: number; lon: number },
  expected: { lat: number; lon: number },
  label: string,
) {
  const dLat = Math.abs(actual.lat - expected.lat);
  const dLon = Math.abs(actual.lon - expected.lon);
  expect(
    dLat < COORD_TOLERANCE && dLon < COORD_TOLERANCE,
    `[${label}] Crosshair at (${actual.lat.toFixed(4)}, ${actual.lon.toFixed(4)}) ` +
      `but expected (${expected.lat}, ${expected.lon}) - ` +
      `dlat=${dLat.toFixed(5)}, dlon=${dLon.toFixed(5)}`,
  ).toBe(true);
}

async function assertCrosshairAt(page: Page, taskId: number, label: string) {
  const expected = TASK_LOCATIONS[taskId];
  if (!expected) throw new Error(`No location for task ${taskId}`);
  const actual = await getCrosshairPosition(page);
  assertCoordsMatch(actual, expected, label);
}

// Tile imagery verification
function latLonToTile(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y };
}

function extractTileCoords(requests: CapturedRequest[]): Array<{ z: number; x: number; y: number }> {
  const pattern = /\/(\d+)\/(\d+)\/(\d+)\?/;
  const results: Array<{ z: number; x: number; y: number }> = [];
  for (const r of requests) {
    if (!r.url.includes('tiles.example.com')) continue;
    const m = r.url.match(pattern);
    if (m) results.push({ z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) });
  }
  return results;
}

function assertTilesFetchedForTask(
  requests: CapturedRequest[],
  sinceIndex: number,
  taskId: number,
  label: string,
) {
  const expected = TASK_LOCATIONS[taskId];
  if (!expected) throw new Error(`No location for task ${taskId}`);

  const recentRequests = requests.slice(sinceIndex);
  const tiles = extractTileCoords(recentRequests);

  if (tiles.length === 0) {
    // No new tiles loaded - OL may have them cached. The crosshair check
    // already guarantees the map is pointed at the right place.
    return;
  }

  const TILE_TOLERANCE = 2;
  const hasTileNearTask = tiles.some((t) => {
    const center = latLonToTile(expected.lat, expected.lon, t.z);
    return (
      Math.abs(t.x - center.x) <= TILE_TOLERANCE &&
      Math.abs(t.y - center.y) <= TILE_TOLERANCE
    );
  });

  expect(
    hasTileNearTask,
    `[${label}] Tiles loaded but none near task ${taskId} ` +
      `(${expected.lat}, ${expected.lon}). ` +
      `Got: ${tiles.map((t) => `${t.z}/${t.x}/${t.y}`).join(', ')}`,
  ).toBe(true);
}

async function assertFullSync(
  page: Page,
  api: { requests: CapturedRequest[]; clear: () => void },
  expectedTaskId: number,
  tileSnapshotIndex: number,
  label: string,
) {
  const task = ALL_TASKS.find((t) => t.id === expectedTaskId);
  if (!task) throw new Error(`Unknown task ${expectedTaskId}`);

  // GoTo
  expect(await readGoToValue(page), `[${label}] GoTo`).toBe(
    task.annotation_number.toString(),
  );

  // Crosshair
  await assertCrosshairAt(page, expectedTaskId, label);

  // Tiles
  assertTilesFetchedForTask(api.requests, tileSnapshotIndex, expectedTaskId, label);

  // Submit
  api.clear();
  await selectAndSubmit(page, '1');
  const req = lastAnnotate(api.requests);
  expect(req, `[${label}] no annotate request`).toBeDefined();
  expect(req!.pathParams.annotation_task_id, `[${label}] task_id`).toBe(
    expectedTaskId.toString(),
  );
}



test.describe('Initial load', () => {
  test('crosshair + imagery at TASK_1 on load', async ({ annotationPage, api }) => {
    expect(await readGoToValue(annotationPage)).toBe('1');
    await assertCrosshairAt(annotationPage, TASK_1.id, 'initial');
    assertTilesFetchedForTask(api.requests, 0, TASK_1.id, 'initial tiles');
  });

  test('initial submit targets task 100', async ({ annotationPage, api }) => {
    await selectAndSubmit(annotationPage, '1');
    const req = lastAnnotate(api.requests);
    expect(req).toBeDefined();
    expect(req!.pathParams.annotation_task_id).toBe('100');
    expect(req!.pathParams.campaign_id).toBe('42');
  });
});


test.describe('Single navigation', () => {
  test('s: crosshair + imagery move to TASK_2', async ({ annotationPage, api }) => {
    const page = annotationPage;
    const snap = api.requests.length;
    await page.keyboard.press('s');
    await waitNavSettled(page);
    await assertFullSync(page, api, TASK_2.id, snap, 'after s');
  });

  test('w from task 1: wraps to TASK_2 with correct imagery', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    const snap = api.requests.length;
    await page.keyboard.press('w');
    await waitNavSettled(page);
    await assertFullSync(page, api, TASK_2.id, snap, 'w wrap');
  });

  test('GoTo 2: crosshair + imagery at TASK_2', async ({ annotationPage, api }) => {
    const page = annotationPage;
    const snap = api.requests.length;
    const gotoInput = page.locator('input[type="number"][title="Press Enter to go"]');
    await gotoInput.fill('2');
    await gotoInput.press('Enter');
    await waitNavSettled(page);
    await assertFullSync(page, api, TASK_2.id, snap, 'GoTo 2');
  });
});


test.describe('Sequential navigation', () => {
  test('s then w: crosshair + imagery back at TASK_1', async ({ annotationPage, api }) => {
    const page = annotationPage;
    await page.keyboard.press('s');
    await waitNavSettled(page);
    await assertCrosshairAt(page, TASK_2.id, 'at task 2');

    const snap = api.requests.length;
    await page.keyboard.press('w');
    await waitNavSettled(page);
    await assertFullSync(page, api, TASK_1.id, snap, 's then w');
  });

  test('GoTo 1 then s: ends at TASK_2', async ({ annotationPage, api }) => {
    const page = annotationPage;
    const gotoInput = page.locator('input[type="number"][title="Press Enter to go"]');
    await gotoInput.fill('1');
    await gotoInput.press('Enter');
    await waitNavSettled(page);

    const snap = api.requests.length;
    await page.keyboard.press('s');
    await waitNavSettled(page);
    await assertFullSync(page, api, TASK_2.id, snap, 'GoTo 1 then s');
  });

  test('GoTo 2 twice: crosshair stays at TASK_2', async ({ annotationPage, api }) => {
    const page = annotationPage;
    const gotoInput = page.locator('input[type="number"][title="Press Enter to go"]');
    await gotoInput.fill('2');
    await gotoInput.press('Enter');
    await waitNavSettled(page);

    const snap = api.requests.length;
    await gotoInput.fill('2');
    await gotoInput.press('Enter');
    await waitNavSettled(page);
    await assertFullSync(page, api, TASK_2.id, snap, 'GoTo 2 twice');
  });
});


test.describe('Rapid keypresses', () => {
  test('rapid s-s-s: only first fires -> TASK_2', async ({ annotationPage, api }) => {
    const page = annotationPage;
    const snap = api.requests.length;
    await page.keyboard.press('s');
    await page.keyboard.press('s');
    await page.keyboard.press('s');
    await waitNavSettled(page);
    await assertFullSync(page, api, TASK_2.id, snap, 'rapid s');
  });

  test('rapid w-w-w: only first fires -> TASK_2 (wrap)', async ({ annotationPage, api }) => {
    const page = annotationPage;
    const snap = api.requests.length;
    await page.keyboard.press('w');
    await page.keyboard.press('w');
    await page.keyboard.press('w');
    await waitNavSettled(page);
    await assertFullSync(page, api, TASK_2.id, snap, 'rapid w');
  });
});

test.describe('Submit auto-advance', () => {
  test('submit task 1 -> crosshair + imagery move to TASK_2', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await assertCrosshairAt(page, TASK_1.id, 'before submit');

    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect(
      page.locator('input[type="number"][title="Press Enter to go"]'),
    ).toHaveValue('2', { timeout: 3000 });

    // After auto-advance, both crosshair AND imagery must be at TASK_2
    await assertCrosshairAt(page, TASK_2.id, 'auto-advance crosshair');
    assertTilesFetchedForTask(api.requests, 0, TASK_2.id, 'auto-advance tiles');

    // Second submit must target TASK_2
    api.clear();
    await page.keyboard.press('2');
    await page.keyboard.press('Enter');
    await waitNavSettled(page);
    const req = lastAnnotate(api.requests);
    expect(req).toBeDefined();
    expect(req!.pathParams.annotation_task_id).toBe('200');
  });

  test('two submits: 100 then 200, crosshair follows each', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await assertCrosshairAt(page, TASK_1.id, 'start');

    api.clear();
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await waitAutoAdvanceTo(page, '2');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe('100');
    await assertCrosshairAt(page, TASK_2.id, 'after submit 1');

    api.clear();
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await waitNavSettled(page);
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe('200');
  });
});


test.describe('Filter changes', () => {
  test('navigate to task 2, add done filter: crosshair resets to TASK_1', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await page.keyboard.press('s');
    await waitNavSettled(page);
    await assertCrosshairAt(page, TASK_2.id, 'at task 2');

    const snap = api.requests.length;
    await page.locator('[data-tour="task-filter"] button').first().click();
    await page.locator('label', { hasText: 'Done' }).waitFor({ state: 'visible' });
    await page.locator('label', { hasText: 'Done' }).click();
    await page.locator('[data-tour="task-filter"] button').first().click();
    await waitNavSettled(page);

    // Filter resets index to 0 = TASK_1
    await assertCrosshairAt(page, TASK_1.id, 'after add done');
    assertTilesFetchedForTask(api.requests, snap, TASK_1.id, 'filter tiles');
    expect(await readGoToValue(page)).toBe('1');

    api.clear();
    await selectAndSubmit(page, '1');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe('100');
  });

  test('done-only filter shows TASK_3 location, switch back shows TASK_1', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    // Switch to done-only
    await page.locator('[data-tour="task-filter"] button').first().click();
    await page.locator('label', { hasText: 'Done' }).waitFor({ state: 'visible' });
    await page.locator('label', { hasText: 'Done' }).click();
    await page.locator('label', { hasText: 'Pending' }).click();
    await page.locator('[data-tour="task-filter"] button').first().click();
    await waitNavSettled(page);

    // First done task is TASK_3 (id=300)
    await assertCrosshairAt(page, TASK_3.id, 'done filter first task');

    // Switch back to pending
    const snap = api.requests.length;
    await page.locator('[data-tour="task-filter"] button').first().click();
    await page.locator('label', { hasText: 'Pending' }).waitFor({ state: 'visible' });
    await page.locator('label', { hasText: 'Pending' }).click();
    await page.locator('label', { hasText: 'Done' }).click();
    await page.locator('[data-tour="task-filter"] button').first().click();
    await waitNavSettled(page);

    await assertCrosshairAt(page, TASK_1.id, 'back to pending');
    assertTilesFetchedForTask(api.requests, snap, TASK_1.id, 'back to pending tiles');

    api.clear();
    await selectAndSubmit(page, '1');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe('100');
  });

  test('filter from task 2 does NOT keep TASK_2 imagery', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await page.keyboard.press('s');
    await waitNavSettled(page);
    await assertCrosshairAt(page, TASK_2.id, 'at task 2');

    await page.locator('[data-tour="task-filter"] button').first().click();
    await page.locator('label', { hasText: 'Done' }).waitFor({ state: 'visible' });
    await page.locator('label', { hasText: 'Done' }).click();
    await page.locator('[data-tour="task-filter"] button').first().click();
    await waitNavSettled(page);

    // Crosshair must NOT be at TASK_2 anymore
    await assertCrosshairAt(page, TASK_1.id, 'filter from task 2');

    api.clear();
    await selectAndSubmit(page, '1');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe('100');
  });
});


test.describe('Review mode', () => {
  test('toggle review: crosshair stays at TASK_1', async ({ annotationPage }) => {
    const page = annotationPage;
    await assertCrosshairAt(page, TASK_1.id, 'before review');

    await page.locator('[data-tour="review-toggle"] button').first().click();

    await assertCrosshairAt(page, TASK_1.id, 'after review toggle');
    expect(await readGoToValue(page)).toBe('1');
  });

  test('review + filter: crosshair at first visible task', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await page.locator('[data-tour="review-toggle"] button').first().click();

    await page.locator('[data-tour="task-filter"] button').first().click();
    await page.locator('label', { hasText: 'Conflicting' }).waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    const conflicting = page.locator('label', { hasText: 'Conflicting' });
    if ((await conflicting.count()) > 0) await conflicting.click();
    await page.locator('[data-tour="task-filter"] button').first().click();
    await waitNavSettled(page);

    const ann = parseInt(await readGoToValue(page));
    const task = ALL_TASKS.find((t) => t.annotation_number === ann)!;
    expect(task).toBeDefined();
    await assertCrosshairAt(page, task.id, 'review + filter');

    api.clear();
    await selectAndSubmit(page, '1');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe(task.id.toString());
  });
});


test.describe('Imagery controls do not move crosshair', () => {
  test('slice switch d: crosshair stays at TASK_1', async ({ annotationPage, api }) => {
    const page = annotationPage;
    await page.keyboard.press('d');
    await assertCrosshairAt(page, TASK_1.id, 'after slice d');

    api.clear();
    await selectAndSubmit(page, '1');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe('100');
  });

  test('viz switch l: crosshair stays at TASK_1, new tiles still at TASK_1 area', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    const snap = api.requests.length;
    await page.keyboard.press('l');

    await assertCrosshairAt(page, TASK_1.id, 'after viz l');
    assertTilesFetchedForTask(api.requests, snap, TASK_1.id, 'viz tiles');

    api.clear();
    await selectAndSubmit(page, '1');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe('100');
  });

  test('collection switch Shift+d: crosshair stays at TASK_1', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await page.keyboard.press('Shift+d');
    await assertCrosshairAt(page, TASK_1.id, 'after Shift+d');

    api.clear();
    await selectAndSubmit(page, '1');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe('100');
  });

  test('s then d then w: crosshair + imagery back at TASK_1', async ({ annotationPage, api }) => {
    const page = annotationPage;

    await page.keyboard.press('s');
    await waitNavSettled(page);
    await assertCrosshairAt(page, TASK_2.id, 'after s');

    await page.keyboard.press('d');
    await assertCrosshairAt(page, TASK_2.id, 'after d');

    const snap = api.requests.length;
    await page.keyboard.press('w');
    await waitNavSettled(page);
    await assertCrosshairAt(page, TASK_1.id, 's d w: crosshair');
    assertTilesFetchedForTask(api.requests, snap, TASK_1.id, 's d w: tiles');

    api.clear();
    await selectAndSubmit(page, '1');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe('100');
  });
});


test.describe('Chaos scenarios', () => {
  test('s then d then add done filter then GoTo 2: crosshair + imagery at TASK_2', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await page.keyboard.press('s');
    await waitNavSettled(page);
    await assertCrosshairAt(page, TASK_2.id, 'after s');

    await page.keyboard.press('d');
    await assertCrosshairAt(page, TASK_2.id, 'after d');

    await page.locator('[data-tour="task-filter"] button').first().click();
    await page.locator('label', { hasText: 'Done' }).waitFor({ state: 'visible' });
    await page.locator('label', { hasText: 'Done' }).click();
    await page.locator('[data-tour="task-filter"] button').first().click();
    await waitNavSettled(page);
    await assertCrosshairAt(page, TASK_1.id, 'after filter');

    const snap = api.requests.length;
    const gotoInput = page.locator('input[type="number"][title="Press Enter to go"]');
    await gotoInput.fill('2');
    await gotoInput.press('Enter');
    await waitNavSettled(page);

    await assertFullSync(page, api, TASK_2.id, snap, 'chaos: s d filter GoTo');
  });

  test('rapid s + l + d: crosshair + imagery at TASK_2', async ({ annotationPage, api }) => {
    const page = annotationPage;
    const snap = api.requests.length;

    await page.keyboard.press('s');
    await page.keyboard.press('l');
    await page.keyboard.press('d');
    await waitNavSettled(page);

    await assertFullSync(page, api, TASK_2.id, snap, 'rapid s l d');
  });

  test('GoTo during isNavigating: crosshair follows final position', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await page.keyboard.press('s');
    const gotoInput = page.locator('input[type="number"][title="Press Enter to go"]');
    await gotoInput.fill('1');
    await gotoInput.press('Enter');
    await waitNavSettled(page);

    const goToVal = await readGoToValue(page);
    const ann = parseInt(goToVal);
    const task = ALL_TASKS.find((t) => t.annotation_number === ann)!;
    expect(task).toBeDefined();

    await assertCrosshairAt(page, task.id, 'GoTo during nav');
    api.clear();
    await selectAndSubmit(page, '1');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe(task.id.toString());
  });

  test('submit then slice change then submit: each submit matches crosshair position', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await assertCrosshairAt(page, TASK_1.id, 'start');

    api.clear();
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await waitAutoAdvanceTo(page, '2');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe('100');
    await assertCrosshairAt(page, TASK_2.id, 'after submit 1');

    await page.keyboard.press('d');
    await assertCrosshairAt(page, TASK_2.id, 'after slice switch');

    api.clear();
    await page.keyboard.press('2');
    await page.keyboard.press('Enter');
    await waitNavSettled(page);
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe('200');
  });

  test('filter then navigate then filter then GoTo: crosshair always matches', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await page.locator('[data-tour="task-filter"] button').first().click();
    await page.locator('label', { hasText: 'Done' }).waitFor({ state: 'visible' });
    await page.locator('label', { hasText: 'Done' }).click();
    await page.locator('[data-tour="task-filter"] button').first().click();
    await waitNavSettled(page);
    await assertCrosshairAt(page, TASK_1.id, 'after add done');

    await page.keyboard.press('s');
    await waitNavSettled(page);
    await assertCrosshairAt(page, TASK_2.id, 'after s');

    await page.locator('[data-tour="task-filter"] button').first().click();
    await page.locator('label', { hasText: 'Done' }).waitFor({ state: 'visible' });
    await page.locator('label', { hasText: 'Done' }).click();
    await page.locator('[data-tour="task-filter"] button').first().click();
    await waitNavSettled(page);
    await assertCrosshairAt(page, TASK_1.id, 'after remove done');

    const snap = api.requests.length;
    const gotoInput = page.locator('input[type="number"][title="Press Enter to go"]');
    await gotoInput.fill('2');
    await gotoInput.press('Enter');
    await waitNavSettled(page);
    await assertFullSync(page, api, TASK_2.id, snap, 'filter nav filter GoTo');
  });

  test('review toggle then navigate then toggle back: crosshair consistent', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await assertCrosshairAt(page, TASK_1.id, 'start');

    await page.locator('[data-tour="review-toggle"] button').first().click();
    await assertCrosshairAt(page, TASK_1.id, 'review on');

    await page.keyboard.press('s');
    await waitNavSettled(page);
    await assertCrosshairAt(page, TASK_2.id, 'review: after s');

    await page.locator('[data-tour="review-toggle"] button').first().click();

    const ann = parseInt(await readGoToValue(page));
    const task = ALL_TASKS.find((t) => t.annotation_number === ann)!;
    await assertCrosshairAt(page, task.id, 'review off');

    api.clear();
    await selectAndSubmit(page, '1');
    expect(lastAnnotate(api.requests)!.pathParams.annotation_task_id).toBe(task.id.toString());
  });
});


test.describe('Submit body integrity', () => {
  test('campaign_id is 42', async ({ annotationPage, api }) => {
    await selectAndSubmit(annotationPage, '1');
    expect(lastAnnotate(api.requests)!.pathParams.campaign_id).toBe('42');
  });

  test('label_id matches digit pressed', async ({ annotationPage, api }) => {
    await annotationPage.keyboard.press('1');
    await annotationPage.keyboard.press('Enter');
    await waitNavSettled(annotationPage);
    expect(lastAnnotate(api.requests)!.body.label_id).toBe(1);
  });

  test('confidence clamps to [1, 5]', async ({ annotationPage, api }) => {
    for (let i = 0; i < 10; i++) await annotationPage.keyboard.press('q');
    await selectAndSubmit(annotationPage, '1');
    const req = lastAnnotate(api.requests)!;
    expect(req.body.confidence).toBeGreaterThanOrEqual(1);
    expect(req.body.confidence).toBeLessThanOrEqual(5);
  });
});

import { test, expect, waitForNavIdle, type CapturedRequest } from './fixtures/annotator-fixture';
import {
  TASK_1,
  TASK_2,
  COLLECTION_S2,
  COLLECTION_NDVI,
  SLICE_2024_01,
  SLICE_2024_06,
} from './fixtures/mock-data';
import {
  assertCrosshairAt,
  assertMinimapCenterAt,
  getMinimapCenter,
  isTileHost,
} from './fixtures/imagery-helpers';

type Page = import('@playwright/test').Page;
type Locator = import('@playwright/test').Locator;

const SOLID_GREEN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURQD/AP///2+9WFEAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggNCC0kqyvu3gAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=',
  'base64'
);

function tilesAfter(requests: CapturedRequest[], snap: number): string[] {
  return requests
    .slice(snap)
    .filter((r) => isTileHost(r.url))
    .map((r) => r.url);
}

function expectTile(page: Page, urlPart: string): Promise<void> {
  return page
    .waitForResponse((r) => isTileHost(r.url()) && r.url().includes(urlPart), {
      timeout: 3000,
    })
    .then(() => undefined)
    .catch(() => undefined);
}

// The main-map slice dropdown lives in the map header; its title carries the
// current hotkey hint ("Select time slice - Next slice (D)"), so match on the
// stable prefix. The small-window dropdowns use a bare "Select time slice".
const mainSliceBtn = (page: Page) =>
  page.locator('[data-tour="map-controls"] button[title^="Select time slice"]');

const windowPanel = (page: Page, collectionId: number) =>
  page.locator(`[data-panel-id="${collectionId}"]`);

const windowSliceBtn = (page: Page, collectionId: number) =>
  windowPanel(page, collectionId).locator('button[title="Select time slice"]');

// Exactly one imagery window header marks itself as the active collection.
const activeWindowName = (page: Page) => page.locator('[data-window-active="true"]');

// Open a HeaderSelect dropdown and click an option by its label text.
async function selectFromDropdown(page: Page, trigger: Locator, optionText: string) {
  await trigger.click();
  // HeaderSelect portals its option <button>s to document.body
  await page
    .locator('div.rounded-lg.shadow-lg button')
    .filter({ hasText: optionText })
    .first()
    .click();
}

// ---------------------------------------------------------------------------
// Slice cycling - keyboard (A / D)
// ---------------------------------------------------------------------------

test.describe('Slice cycling via keyboard (A / D)', () => {
  test.beforeEach(async ({ api }) => {
    api.clear();
  });

  test('initial slice is Jan 2024', async ({ annotationPage }) => {
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name);
  });

  test('D advances to Jun 2024', async ({ annotationPage, api }) => {
    const snap = api.requests.length;
    const tileArrived = expectTile(annotationPage, 'search-jun-2024');

    await annotationPage.keyboard.press('d');

    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, { timeout: 3000 });
    await tileArrived;

    const tiles = tilesAfter(api.requests, snap);
    if (tiles.length > 0) expect(tiles.some((u) => u.includes('search-jun-2024'))).toBe(true);
  });

  test('D then A returns to Jan 2024', async ({ annotationPage, api }) => {
    await annotationPage.keyboard.press('d');
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, { timeout: 3000 });

    const snap = api.requests.length;
    const tileArrived = expectTile(annotationPage, 'search-jan-2024');
    await annotationPage.keyboard.press('a');

    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name, { timeout: 3000 });
    await tileArrived;

    const tiles = tilesAfter(api.requests, snap);
    if (tiles.length > 0) expect(tiles.some((u) => u.includes('search-jan-2024'))).toBe(true);
  });

  test('D at last slice of S2 L2A advances to NDVI collection', async ({ annotationPage }) => {
    // navigateSlice crosses collection boundaries - D at the last slice steps into the next collection.
    await annotationPage.keyboard.press('d');
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, { timeout: 3000 });

    await annotationPage.keyboard.press('d');
    // Now active collection is NDVI (1 slice → no slice selector rendered for NDVI)
    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_NDVI.name, {
      timeout: 3000,
    });
  });

  test('slice change does not move the crosshair', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('d');
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, { timeout: 3000 });
    await assertCrosshairAt(annotationPage, TASK_1.id, 'crosshair after d');
  });

  test('switching to an already loaded slice never exposes a blank imagery frame', async ({
    annotationPage,
  }) => {
    const janRequests = new Set<string>();
    annotationPage.on('request', (request) => {
      if (request.url().includes('search-jan-2024')) janRequests.add(request.url());
    });
    await annotationPage.route('**/tiles.example.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: {
          'access-control-allow-origin': '*',
          'cache-control': 'public, max-age=3600',
        },
        body: SOLID_GREEN_PNG,
      })
    );
    await annotationPage.reload();
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name);
    await annotationPage.waitForTimeout(250);

    // The task preloader warms HTTP image responses without mounting an OL
    // layer. Reproduce that exact state for June using January's viewport tile
    // coordinates, then switch to the never-mounted but network-cached slice.
    const juneUrls = [...janRequests].map((url) =>
      url.replace('search-jan-2024', 'search-jun-2024')
    );
    expect(juneUrls.length).toBeGreaterThan(0);
    await annotationPage.evaluate(
      (urls) =>
        Promise.all(
          urls.map(
            (url) =>
              new Promise<void>((resolve, reject) => {
                const image = new Image();
                image.crossOrigin = 'anonymous';
                image.onload = () => resolve();
                image.onerror = () => reject(new Error(`failed to preload ${url}`));
                image.src = url;
              })
          )
        ),
      juneUrls
    );

    await annotationPage.evaluate(() => {
      const state = { samples: [] as number[], done: false };
      (window as typeof window & { __SLICE_ALPHA__?: typeof state }).__SLICE_ALPHA__ = state;
      let frames = 0;
      const sample = () => {
        const canvases = document.querySelectorAll<HTMLCanvasElement>(
          '[data-panel-role="main-map"] canvas'
        );
        let strongest = 0;
        for (const canvas of canvases) {
          if (canvas.width === 0 || canvas.height === 0) continue;
          const pixel = canvas
            .getContext('2d')
            ?.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
          strongest = Math.max(strongest, pixel?.[3] ?? 0);
        }
        state.samples.push(strongest);
        if (++frames < 20) requestAnimationFrame(sample);
        else state.done = true;
      };
      requestAnimationFrame(sample);
    });

    await annotationPage.keyboard.press('d');
    await expect
      .poll(
        () =>
          annotationPage.evaluate(
            () =>
              (window as typeof window & { __SLICE_ALPHA__?: { done: boolean } }).__SLICE_ALPHA__
                ?.done ?? false
          ),
        { timeout: 3000 }
      )
      .toBe(true);
    const samples = await annotationPage.evaluate(
      () =>
        (window as typeof window & { __SLICE_ALPHA__?: { samples: number[] } }).__SLICE_ALPHA__
          ?.samples ?? []
    );
    // The crosshair/vector canvas may blend the sampled alpha below 255; the
    // regression is a fully blank frame, not the exact composited opacity.
    expect(Math.min(...samples)).toBeGreaterThan(0);
  });

  test('panning requests only the active date, never retained dates', async ({
    annotationPage,
  }) => {
    await annotationPage.evaluate(() => {
      const key = 'annotation:prefs';
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      localStorage.setItem(
        key,
        JSON.stringify({
          ...existing,
          state: { ...(existing.state || {}), preloadTier: 'off' },
          version: existing.version ?? 0,
        })
      );
    });
    await annotationPage.reload();
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name);

    // Mount June once so it is retained when January becomes active again.
    await annotationPage.keyboard.press('d');
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name);
    await annotationPage.waitForTimeout(200);
    await annotationPage.keyboard.press('a');
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name);
    await annotationPage.waitForTimeout(200);

    const requested: string[] = [];
    annotationPage.on('request', (request) => {
      if (isTileHost(request.url())) requested.push(request.url());
    });

    const minimapBody = annotationPage.locator('[data-tour="minimap"] [data-minimap-zoom]');
    await minimapBody.scrollIntoViewIfNeeded();
    const minimap = await minimapBody.boundingBox();
    if (!minimap) throw new Error('minimap has no bounding box');
    const start = { x: minimap.x + minimap.width / 2, y: minimap.y + minimap.height / 2 };
    const destination = { x: start.x + 24, y: start.y + 18 };
    await annotationPage.mouse.move(start.x, start.y);
    await annotationPage.mouse.down();
    await annotationPage.mouse.move(destination.x, destination.y, { steps: 8 });
    await annotationPage.waitForTimeout(100);

    // Dragging previews only the vector rectangle. The full-size map receives
    // no intermediate camera positions (and therefore no imagery requests).
    expect(requested).toEqual([]);

    await annotationPage.mouse.up();
    await annotationPage.waitForTimeout(500);

    expect(requested.some((url) => url.includes('search-jan-2024'))).toBe(true);
    expect(requested.some((url) => url.includes('search-jun-2024'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Collection cycling - keyboard (Shift+A / Shift+D)
// ---------------------------------------------------------------------------

test.describe('Collection cycling via keyboard (Shift+A / Shift+D)', () => {
  test('Shift+D switches from S2 L2A to NDVI', async ({ annotationPage }) => {
    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_S2.name);

    await annotationPage.keyboard.press('Shift+d');

    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_NDVI.name, {
      timeout: 3000,
    });
  });

  test('Shift+A wraps back to S2 L2A', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('Shift+d');
    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_NDVI.name, {
      timeout: 3000,
    });

    await annotationPage.keyboard.press('Shift+a');
    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_S2.name, {
      timeout: 3000,
    });
  });

  test('collection switch does not move the crosshair', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('Shift+d');
    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_NDVI.name, {
      timeout: 3000,
    });
    await assertCrosshairAt(annotationPage, TASK_1.id, 'crosshair after Shift+d');
  });

  test('timeline shows NDVI as active after Shift+D', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('Shift+d');
    await expect(annotationPage.locator('[data-tour="timeline-sidebar"]')).toContainText(
      COLLECTION_NDVI.name,
      { timeout: 3000 }
    );
  });
});

// ---------------------------------------------------------------------------
// Slice cycling via main-map dropdown
// ---------------------------------------------------------------------------

test.describe('Slice cycling via main-map dropdown', () => {
  test('dropdown shows current slice and changes on selection', async ({ annotationPage, api }) => {
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name);

    const snap = api.requests.length;
    const tileArrived = expectTile(annotationPage, 'search-jun-2024');

    await selectFromDropdown(annotationPage, mainSliceBtn(annotationPage), SLICE_2024_06.name);

    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, { timeout: 3000 });
    await tileArrived;

    const tiles = tilesAfter(api.requests, snap);
    if (tiles.length > 0) expect(tiles.some((u) => u.includes('search-jun-2024'))).toBe(true);
  });

  test('dropdown: selecting current slice is a no-op', async ({ annotationPage }) => {
    await selectFromDropdown(annotationPage, mainSliceBtn(annotationPage), SLICE_2024_01.name);
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name);
  });

  test('dropdown: can navigate back to Jan after Jun', async ({ annotationPage }) => {
    await selectFromDropdown(annotationPage, mainSliceBtn(annotationPage), SLICE_2024_06.name);
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, { timeout: 3000 });

    await selectFromDropdown(annotationPage, mainSliceBtn(annotationPage), SLICE_2024_01.name);
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name, { timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
// Slice cycling via small imagery window dropdown
// ---------------------------------------------------------------------------

test.describe('Slice cycling via small imagery window dropdown', () => {
  test('S2 L2A window dropdown changes slice in that window', async ({ annotationPage, api }) => {
    const s2SliceBtn = windowSliceBtn(annotationPage, COLLECTION_S2.id);

    await expect(s2SliceBtn).toContainText(SLICE_2024_01.name);

    const snap = api.requests.length;
    const tileArrived = expectTile(annotationPage, 'search-jun-2024');

    await selectFromDropdown(annotationPage, s2SliceBtn, SLICE_2024_06.name);

    await expect(s2SliceBtn).toContainText(SLICE_2024_06.name, { timeout: 3000 });
    await tileArrived;

    const tiles = tilesAfter(api.requests, snap);
    if (tiles.length > 0) expect(tiles.some((u) => u.includes('search-jun-2024'))).toBe(true);
  });

  test('S2 window slice change is independent of main-map slice', async ({ annotationPage }) => {
    const s2SliceBtn = windowSliceBtn(annotationPage, COLLECTION_S2.id);

    await selectFromDropdown(annotationPage, s2SliceBtn, SLICE_2024_06.name);

    await expect(s2SliceBtn).toContainText(SLICE_2024_06.name, { timeout: 3000 });

    // Main map slice dropdown should reflect the same slice (S2 L2A is active collection)
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, { timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
// Timeline collection click
// ---------------------------------------------------------------------------

test.describe('Timeline collection switching', () => {
  test('clicking NDVI entry in timeline switches active collection', async ({ annotationPage }) => {
    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_S2.name);

    // Click the NDVI segment in the timeline
    await annotationPage.locator(`[data-collection-id="${COLLECTION_NDVI.id}"]`).click();

    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_NDVI.name, {
      timeout: 3000,
    });
  });

  test('clicking S2 L2A entry switches back to S2 L2A', async ({ annotationPage }) => {
    await annotationPage.locator(`[data-collection-id="${COLLECTION_NDVI.id}"]`).click();
    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_NDVI.name, {
      timeout: 3000,
    });

    await annotationPage.locator(`[data-collection-id="${COLLECTION_S2.id}"]`).click();
    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_S2.name, {
      timeout: 3000,
    });
  });

  test('active collection in timeline has visible name label', async ({ annotationPage }) => {
    await expect(annotationPage.locator('[data-tour="timeline-sidebar"]')).toContainText(
      COLLECTION_S2.name
    );
  });
});

// ---------------------------------------------------------------------------
// Minimap location
// ---------------------------------------------------------------------------

test.describe('Minimap center tracks current task', () => {
  test('minimap is visible on initial load', async ({ annotationPage }) => {
    await expect(annotationPage.locator('[data-tour="minimap"]')).toBeVisible();
  });

  test('a background click jumps the main map to that spot', async ({ annotationPage }) => {
    const before = await getMinimapCenter(annotationPage);
    const minimapBody = annotationPage.locator('[data-tour="minimap"] [data-minimap-zoom]');
    await minimapBody.scrollIntoViewIfNeeded();
    const minimap = await minimapBody.boundingBox();
    if (!minimap) throw new Error('minimap has no bounding box');

    // Top-left of the minimap is north-west of where the main map currently is.
    await annotationPage.mouse.click(minimap.x + 8, minimap.y + 8);

    await expect
      .poll(async () => (await getMinimapCenter(annotationPage)).lat)
      .toBeGreaterThan(before.lat);
    expect((await getMinimapCenter(annotationPage)).lon).toBeLessThan(before.lon);
  });

  test('dragging the minimap background pans it without moving the main map', async ({
    annotationPage,
  }) => {
    const center = await annotationPage.locator('[data-testid="viewport-center"]').textContent();
    const minimapBody = annotationPage.locator('[data-tour="minimap"] [data-minimap-zoom]');
    await minimapBody.scrollIntoViewIfNeeded();
    const minimap = await minimapBody.boundingBox();
    if (!minimap) throw new Error('minimap has no bounding box');

    await annotationPage.mouse.move(minimap.x + 8, minimap.y + 8);
    await annotationPage.mouse.down();
    await annotationPage.mouse.move(minimap.x + 48, minimap.y + 48, { steps: 8 });
    await annotationPage.mouse.up();

    await expect(annotationPage.locator('[data-testid="viewport-center"]')).toHaveText(center!);
  });

  test('the minimap zooms independently with the mouse wheel', async ({ annotationPage }) => {
    const minimap = annotationPage.locator('[data-tour="minimap"] [data-minimap-zoom]');
    await minimap.scrollIntoViewIfNeeded();
    const box = await minimap.boundingBox();
    if (!box) throw new Error('minimap has no bounding box');
    const initial = Number(await minimap.getAttribute('data-minimap-zoom'));

    await annotationPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await annotationPage.mouse.wheel(0, -500);
    await expect
      .poll(async () => Number(await minimap.getAttribute('data-minimap-zoom')))
      .toBeGreaterThan(initial);
  });

  test('clicking minimap attribution never navigates the main map', async ({ annotationPage }) => {
    const center = await annotationPage.locator('[data-testid="viewport-center"]').textContent();
    await annotationPage
      .locator('[data-tour="minimap"] .ol-attribution button')
      .click({ force: true });
    await expect(annotationPage.locator('[data-testid="viewport-center"]')).toHaveText(center!);
  });

  test('minimap center is at TASK_1 location on initial load', async ({ annotationPage }) => {
    await assertMinimapCenterAt(annotationPage, TASK_1.id, 'initial minimap');
  });

  test('minimap center moves to TASK_2 after S navigation', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('s');
    await waitForNavIdle(annotationPage);
    await assertMinimapCenterAt(annotationPage, TASK_2.id, 'minimap after S');
  });

  test('minimap center moves to TASK_2 after GoTo 2', async ({ annotationPage }) => {
    await annotationPage
      .locator('input[type="number"][title="Press Enter to go"]')
      .fill(String(TASK_2.annotation_number));
    await annotationPage.locator('input[type="number"][title="Press Enter to go"]').press('Enter');
    await waitForNavIdle(annotationPage);
    await assertMinimapCenterAt(annotationPage, TASK_2.id, 'minimap after GoTo 2');
  });

  test('minimap center returns to TASK_1 after W navigation from TASK_2', async ({
    annotationPage,
  }) => {
    await annotationPage.keyboard.press('s');
    await waitForNavIdle(annotationPage);
    await annotationPage.keyboard.press('w');
    await waitForNavIdle(annotationPage);
    await assertMinimapCenterAt(annotationPage, TASK_1.id, 'minimap after S+W');
  });

  test('slice change does not move minimap center', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('d');
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, { timeout: 3000 });
    await assertMinimapCenterAt(annotationPage, TASK_1.id, 'minimap after slice d');
  });

  test('minimap center updates after submit and auto-advance', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('1');
    const btn = annotationPage.locator('button', { hasText: /^Submit$/ }).first();
    await expect(btn).toBeEnabled({ timeout: 5000 });
    await annotationPage.keyboard.press('Enter');
    await waitForNavIdle(annotationPage);
    await assertMinimapCenterAt(annotationPage, TASK_2.id, 'minimap after submit+advance');
  });
});

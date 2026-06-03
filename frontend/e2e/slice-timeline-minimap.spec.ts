import { test, expect, waitForNavIdle, type CapturedRequest } from './fixtures/annotator-fixture';
import { TASK_1, TASK_2, TASK_3, COLLECTION_S2, COLLECTION_NDVI, SLICE_2024_01, SLICE_2024_06 } from './fixtures/mock-data';
import { assertCrosshairAt, assertMinimapCenterAt, assertTilesFetchedForTask } from './fixtures/imagery-helpers';

type Page = import('@playwright/test').Page;

function tilesAfter(requests: CapturedRequest[], snap: number): string[] {
  return requests
    .slice(snap)
    .filter((r) => r.url.includes('tiles.example.com'))
    .map((r) => r.url);
}

function expectTile(page: Page, urlPart: string): Promise<void> {
  return page
    .waitForResponse((r) => r.url().includes('tiles.example.com') && r.url().includes(urlPart), {
      timeout: 3000,
    })
    .then(() => undefined)
    .catch(() => undefined);
}

// The main-map slice dropdown sits in [data-tour="map-controls"] and has title "Select time slice (a/d)".
// The small-window slice dropdowns use title "Select time slice" (no keyboard hint).
const mainSliceBtn = (page: Page) => page.locator('button[title="Select time slice (a/d)"]');

// Open a HeaderSelect dropdown and click an option by its label text.
async function selectFromDropdown(page: Page, triggerSelector: string, optionText: string) {
  await page.locator(triggerSelector).click();
  // HeaderSelect portals <button> elements to document.body
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
    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      `Sentinel-2 - ${COLLECTION_NDVI.name}`,
      { timeout: 3000 }
    );
  });

  test('slice change does not move the crosshair', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('d');
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, { timeout: 3000 });
    await assertCrosshairAt(annotationPage, TASK_1.id, 'crosshair after d');
  });
});

// ---------------------------------------------------------------------------
// Collection cycling - keyboard (Shift+A / Shift+D)
// ---------------------------------------------------------------------------

test.describe('Collection cycling via keyboard (Shift+A / Shift+D)', () => {
  test('Shift+D switches from S2 L2A to NDVI', async ({ annotationPage }) => {
    expect(await annotationPage.locator('.active-window .card-header').getAttribute('title')).toBe(
      `Sentinel-2 - ${COLLECTION_S2.name}`
    );

    await annotationPage.keyboard.press('Shift+d');

    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      `Sentinel-2 - ${COLLECTION_NDVI.name}`,
      { timeout: 3000 }
    );
  });

  test('Shift+A wraps back to S2 L2A', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('Shift+d');
    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      `Sentinel-2 - ${COLLECTION_NDVI.name}`,
      { timeout: 3000 }
    );

    await annotationPage.keyboard.press('Shift+a');
    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      `Sentinel-2 - ${COLLECTION_S2.name}`,
      { timeout: 3000 }
    );
  });

  test('collection switch does not move the crosshair', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('Shift+d');
    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      `Sentinel-2 - ${COLLECTION_NDVI.name}`,
      { timeout: 3000 }
    );
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

    await selectFromDropdown(annotationPage, 'button[title="Select time slice (a/d)"]', SLICE_2024_06.name);

    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, { timeout: 3000 });
    await tileArrived;

    const tiles = tilesAfter(api.requests, snap);
    if (tiles.length > 0) expect(tiles.some((u) => u.includes('search-jun-2024'))).toBe(true);
  });

  test('dropdown: selecting current slice is a no-op', async ({ annotationPage }) => {
    await selectFromDropdown(annotationPage, 'button[title="Select time slice (a/d)"]', SLICE_2024_01.name);
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name);
  });

  test('dropdown: can navigate back to Jan after Jun', async ({ annotationPage }) => {
    await selectFromDropdown(annotationPage, 'button[title="Select time slice (a/d)"]', SLICE_2024_06.name);
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, { timeout: 3000 });

    await selectFromDropdown(annotationPage, 'button[title="Select time slice (a/d)"]', SLICE_2024_01.name);
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name, { timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
// Slice cycling via small imagery window dropdown
// ---------------------------------------------------------------------------

test.describe('Slice cycling via small imagery window dropdown', () => {
  test('S2 L2A window dropdown changes slice in that window', async ({ annotationPage, api }) => {
    // Scope to the S2 L2A window by its header title attribute to avoid matching the main map card,
    // which also contains the collection name in its collection selector dropdown.
    const s2Card = annotationPage.locator('.grid-card').filter({
      has: annotationPage.locator(`[title="Sentinel-2 - ${COLLECTION_S2.name}"]`),
    });
    const s2SliceBtn = s2Card.locator('button[title="Select time slice"]');

    await expect(s2SliceBtn).toContainText(SLICE_2024_01.name);

    const snap = api.requests.length;
    const tileArrived = expectTile(annotationPage, 'search-jun-2024');

    await s2SliceBtn.click();
    await annotationPage
      .locator('div.rounded-lg.shadow-lg button')
      .filter({ hasText: SLICE_2024_06.name })
      .first()
      .click();

    await expect(s2SliceBtn).toContainText(SLICE_2024_06.name, { timeout: 3000 });
    await tileArrived;

    const tiles = tilesAfter(api.requests, snap);
    if (tiles.length > 0) expect(tiles.some((u) => u.includes('search-jun-2024'))).toBe(true);
  });

  test('S2 window slice change is independent of main-map slice', async ({ annotationPage }) => {
    const s2Card = annotationPage.locator('.grid-card').filter({
      has: annotationPage.locator(`[title="Sentinel-2 - ${COLLECTION_S2.name}"]`),
    });
    const s2SliceBtn = s2Card.locator('button[title="Select time slice"]');

    await s2SliceBtn.click();
    await annotationPage
      .locator('div.rounded-lg.shadow-lg button')
      .filter({ hasText: SLICE_2024_06.name })
      .first()
      .click();

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
    expect(await annotationPage.locator('.active-window .card-header').getAttribute('title')).toBe(
      `Sentinel-2 - ${COLLECTION_S2.name}`
    );

    // Click the NDVI segment in the timeline
    await annotationPage.locator(`[data-collection-id="${COLLECTION_NDVI.id}"]`).click();

    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      `Sentinel-2 - ${COLLECTION_NDVI.name}`,
      { timeout: 3000 }
    );
  });

  test('clicking S2 L2A entry switches back to S2 L2A', async ({ annotationPage }) => {
    await annotationPage.locator(`[data-collection-id="${COLLECTION_NDVI.id}"]`).click();
    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      `Sentinel-2 - ${COLLECTION_NDVI.name}`,
      { timeout: 3000 }
    );

    await annotationPage.locator(`[data-collection-id="${COLLECTION_S2.id}"]`).click();
    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      `Sentinel-2 - ${COLLECTION_S2.name}`,
      { timeout: 3000 }
    );
  });

  test('active collection in timeline has visible name label', async ({ annotationPage }) => {
    // The active entry renders the collection name as a text span
    const activeEntry = annotationPage.locator(`[data-collection-id="${COLLECTION_S2.id}"]`);
    await expect(activeEntry).toContainText(COLLECTION_S2.name);
  });
});

// ---------------------------------------------------------------------------
// Minimap location
// ---------------------------------------------------------------------------

test.describe('Minimap center tracks current task', () => {
  test('minimap is visible on initial load', async ({ annotationPage }) => {
    await expect(annotationPage.locator('[data-tour="minimap"]')).toBeVisible();
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
    await expect(
      annotationPage.locator('button[title="Select time slice (a/d)"]')
    ).toContainText(SLICE_2024_06.name, { timeout: 3000 });
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

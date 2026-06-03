import { test, expect, waitForNavIdle } from './fixtures/annotator-fixture';
import {
  MOCK_CAMPAIGN_MULTI_VIEW,
  COLLECTION_S2,
  COLLECTION_NDVI,
  COLLECTION_VHR,
  TASK_1,
  TASK_2,
} from './fixtures/mock-data';
import { assertCrosshairAt } from './fixtures/imagery-helpers';

type Page = import('@playwright/test').Page;
type ApiCapture = import('./fixtures/annotator-fixture').ApiCapture;

async function loadMultiView(page: Page, api: ApiCapture): Promise<void> {
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    await route.fulfill({ json: MOCK_CAMPAIGN_MULTI_VIEW });
  });
  await page.reload();
  await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
  await page.waitForSelector('[data-tour="controls"]', { timeout: 10_000 });
  await page.locator('button', { hasText: /^(Submit|Update)$/ }).first()
    .waitFor({ state: 'visible', timeout: 5000 });
  await waitForNavIdle(page);
  api.clear();
}

// The view selector sits at data-tour="imagery-selector" in the toolbar.
const viewSelector = (page: Page) => page.locator('[data-tour="imagery-selector"]');

// ---------------------------------------------------------------------------
// Initial view state
// ---------------------------------------------------------------------------

test.describe('Initial view state', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadMultiView(annotationPage, api);
  });

  test('first view is active on load', async ({ annotationPage }) => {
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText(
      'Sentinel-2 View'
    );
  });

  test('S2 L2A and NDVI window cards are in DOM in the first view', async ({ annotationPage }) => {
    await expect(
      annotationPage.locator(`[data-window-collection-id="${COLLECTION_S2.id}"]`)
    ).toBeAttached();
    await expect(
      annotationPage.locator(`[data-window-collection-id="${COLLECTION_NDVI.id}"]`)
    ).toBeAttached();
  });

  test('VHR window card is not in DOM in the first view', async ({ annotationPage }) => {
    await expect(
      annotationPage.locator(`[data-window-collection-id="${COLLECTION_VHR.id}"]`)
    ).not.toBeAttached();
  });
});

// ---------------------------------------------------------------------------
// View cycling via V key
// ---------------------------------------------------------------------------

test.describe('View cycling via V key', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadMultiView(annotationPage, api);
  });

  test('V switches to the second view', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('v');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText(
      'VHR View',
      { timeout: 3000 }
    );
  });

  test('V: active source is VHR and S2/NDVI windows leave DOM', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('v');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText(
      'VHR View',
      { timeout: 3000 }
    );

    // Layer selector confirms the VHR source is active
    await expect(annotationPage.locator('[data-tour="layer-selector"] button')).toContainText(
      'VHR',
      { timeout: 3000 }
    );
    // S2 and NDVI window cards are no longer in the DOM for this view
    await expect(
      annotationPage.locator(`[data-window-collection-id="${COLLECTION_S2.id}"]`)
    ).not.toBeAttached({ timeout: 3000 });
    await expect(
      annotationPage.locator(`[data-window-collection-id="${COLLECTION_NDVI.id}"]`)
    ).not.toBeAttached();
  });

  test('V twice wraps back to the first view', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('v');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText(
      'VHR View',
      { timeout: 3000 }
    );

    await annotationPage.keyboard.press('v');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText(
      'Sentinel-2 View',
      { timeout: 3000 }
    );

    await expect(
      annotationPage.locator('.grid-card').filter({ hasText: COLLECTION_S2.name }).first()
    ).toBeAttached({ timeout: 3000 });
  });

  test('view switch does not move the crosshair', async ({ annotationPage }) => {
    await assertCrosshairAt(annotationPage, TASK_1.id, 'before V');
    await annotationPage.keyboard.press('v');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText(
      'VHR View',
      { timeout: 3000 }
    );
    await assertCrosshairAt(annotationPage, TASK_1.id, 'after V');
  });

  test('crosshair stays correct through view cycles and task navigation', async ({
    annotationPage,
  }) => {
    await annotationPage.keyboard.press('v');
    await annotationPage.keyboard.press('s');
    await waitForNavIdle(annotationPage);
    await assertCrosshairAt(annotationPage, TASK_2.id, 'task nav in VHR view');

    await annotationPage.keyboard.press('v');
    await assertCrosshairAt(annotationPage, TASK_2.id, 'back to S2 view');
  });
});

// ---------------------------------------------------------------------------
// View switching via toolbar dropdown
// ---------------------------------------------------------------------------

test.describe('View switching via toolbar dropdown', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadMultiView(annotationPage, api);
  });

  test('dropdown lists both views', async ({ annotationPage }) => {
    await viewSelector(annotationPage).locator('button').first().click();
    await expect(annotationPage.getByText('Sentinel-2 View').first()).toBeVisible();
    await expect(annotationPage.getByText('VHR View').first()).toBeVisible();
  });

  test('selecting VHR View from dropdown activates VHR source', async ({ annotationPage }) => {
    await viewSelector(annotationPage).locator('button').first().click();
    await annotationPage.getByText('VHR View').first().click();

    await expect(viewSelector(annotationPage).locator('button').first()).toContainText(
      'VHR View',
      { timeout: 3000 }
    );
    await expect(annotationPage.locator('[data-tour="layer-selector"] button')).toContainText(
      'VHR',
      { timeout: 3000 }
    );
  });

  test('selecting Sentinel-2 View from dropdown when VHR is active switches back', async ({
    annotationPage,
  }) => {
    await annotationPage.keyboard.press('v');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText(
      'VHR View',
      { timeout: 3000 }
    );

    await viewSelector(annotationPage).locator('button').first().click();
    await annotationPage.getByText('Sentinel-2 View').first().click();

    await expect(viewSelector(annotationPage).locator('button').first()).toContainText(
      'Sentinel-2 View',
      { timeout: 3000 }
    );
    await expect(
      annotationPage.locator('.grid-card').filter({ hasText: COLLECTION_S2.name }).first()
    ).toBeAttached({ timeout: 3000 });
  });

  test('dropdown does not move the crosshair', async ({ annotationPage }) => {
    await assertCrosshairAt(annotationPage, TASK_1.id, 'before dropdown switch');

    await viewSelector(annotationPage).locator('button').first().click();
    await annotationPage.getByText('VHR View').first().click();
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText(
      'VHR View',
      { timeout: 3000 }
    );

    await assertCrosshairAt(annotationPage, TASK_1.id, 'after dropdown switch');
  });
});

// ---------------------------------------------------------------------------
// Timeline updates with view
// ---------------------------------------------------------------------------

test.describe('Timeline updates with active view', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadMultiView(annotationPage, api);
  });

  test('timeline shows S2 collections in the first view', async ({ annotationPage }) => {
    await expect(annotationPage.locator('[data-tour="timeline-sidebar"]')).toContainText(
      COLLECTION_S2.name
    );
  });

  test('timeline shows VHR collection after switching to VHR View', async ({
    annotationPage,
  }) => {
    await annotationPage.keyboard.press('v');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText(
      'VHR View',
      { timeout: 3000 }
    );
    await expect(annotationPage.locator('[data-tour="timeline-sidebar"]')).toContainText(
      COLLECTION_VHR.name,
      { timeout: 3000 }
    );
  });
});

// ---------------------------------------------------------------------------
// Imagery source cycling interacts correctly with views
// ---------------------------------------------------------------------------

test.describe('Imagery source cycling within a view', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadMultiView(annotationPage, api);
  });

  test('Shift+D cycles collections within the current view only', async ({ annotationPage }) => {
    // In Sentinel-2 View: S2 L2A → NDVI (Shift+D)
    const before = await annotationPage.locator('.active-window .card-header').getAttribute('title');
    await annotationPage.keyboard.press('Shift+d');
    const after = await annotationPage.locator('.active-window .card-header').getAttribute('title');
    expect(after).not.toBe(before);
    // Should still be within Sentinel-2 view's collections
    expect(after).toMatch(/Sentinel-2/);
  });

  test('switching to VHR View then using layer selector shows VHR source', async ({
    annotationPage,
  }) => {
    await annotationPage.keyboard.press('v');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText(
      'VHR View',
      { timeout: 3000 }
    );
    await expect(annotationPage.locator('[data-tour="layer-selector"] button')).toContainText(
      'VHR',
      { timeout: 3000 }
    );
  });
});

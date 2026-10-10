import { test, expect, waitForNavIdle } from './fixtures/annotator-fixture';
import {
  MOCK_CAMPAIGN_MULTI_VIEW,
  MOCK_CAMPAIGN,
  COLLECTION_S2,
  COLLECTION_NDVI,
  COLLECTION_VHR,
  TASK_1,
  TASK_2,
} from './fixtures/mock-data';
import { assertCrosshairAt } from './fixtures/imagery-helpers';

type Page = import('@playwright/test').Page;
type Locator = import('@playwright/test').Locator;
type ApiCapture = import('./fixtures/annotator-fixture').ApiCapture;

async function mockVisibleImagery(page: Page): Promise<void> {
  await page.route('**/tiles.example.com/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURQD/AP///2+9WFEAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggNCC0kqyvu3gAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=',
        'base64'
      ),
    })
  );
}

async function expectImageryPainted(panel: Locator): Promise<void> {
  await expect
    .poll(() =>
      panel.locator('canvas').evaluateAll((canvases) =>
        canvases.some((canvas) => {
          if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) {
            return false;
          }
          const pixel = canvas
            .getContext('2d')
            ?.getImageData(Math.floor(canvas.width / 4), Math.floor(canvas.height / 4), 1, 1).data;
          return pixel?.[0] === 0 && pixel[1] === 255 && pixel[2] === 0 && pixel[3] === 255;
        })
      )
    )
    .toBe(true);
}

async function loadMultiView(page: Page, api: ApiCapture): Promise<void> {
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    await route.fulfill({ json: MOCK_CAMPAIGN_MULTI_VIEW });
  });
  await page.reload();
  await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
  await page.waitForSelector('[data-tour="controls"]', { timeout: 10_000 });
  await page
    .locator('button', { hasText: /^(Submit|Update)$/ })
    .first()
    .waitFor({ state: 'visible', timeout: 5000 });
  await waitForNavIdle(page);
  api.clear();
}

// The view selector sits at data-tour="imagery-selector" in the toolbar.
const viewSelector = (page: Page) => page.locator('[data-tour="imagery-selector"]');

// One canvas panel per collection window, keyed by collection id.
const windowPanel = (page: Page, collectionId: number) =>
  page.locator(`[data-panel-id="${collectionId}"]`);

/** A window's title carries whether its collection is the active one. */
const windowTitle = (page: Page, collectionId: number) =>
  windowPanel(page, collectionId).locator('.card-header [data-window-active]');

const layerButton = (page: Page) => page.locator('[data-tour="layer-selector"] button');
const collectionButton = (page: Page) => page.locator('[data-tour="collection-picker"] button');

for (const readyAtCreation of [false, true]) {
  test(`first-view maps paint imagery after saving without a reload (${readyAtCreation ? 'registered' : 'registering'})`, async ({
    annotationPage: page,
  }) => {
    let ready = readyAtCreation;
    let created = false;
    const view = {
      ...MOCK_CAMPAIGN.imagery_views[0],
      default_canvas_layout: {
        ...MOCK_CAMPAIGN.imagery_views[0].default_canvas_layout,
        layout_data: MOCK_CAMPAIGN.imagery_views[0].default_canvas_layout.layout_data.filter(
          (item) => item.i === String(COLLECTION_S2.id)
        ),
      },
    };
    const source = MOCK_CAMPAIGN.imagery_sources[0];
    await page.route('**/api/campaigns/*/detailed', (route) =>
      route.fulfill({
        json: {
          ...MOCK_CAMPAIGN,
          viewer_is_admin: true,
          registration_status: ready ? 'ready' : 'registering',
          imagery_views: created ? [view] : [],
          imagery_sources: [
            {
              ...source,
              collections: [
                {
                  ...COLLECTION_S2,
                  slices: COLLECTION_S2.slices.map((slice) => ({
                    ...slice,
                    tile_urls: ready ? slice.tile_urls : [],
                  })),
                },
              ],
            },
          ],
        },
      })
    );
    await page.route('**/api/*/imagery/views', (route) => {
      created = true;
      return route.fulfill({ status: 201, json: view });
    });
    await page.route('**/api/*/new-layout', (route) => route.fulfill({ status: 201, json: {} }));
    await mockVisibleImagery(page);

    await page.reload();
    if (!readyAtCreation) {
      await page.getByRole('button', { name: 'Set up layout anyway' }).click();
    }
    await page.getByTestId('create-first-view').click();
    const mainMap = page.locator('[data-panel-role="main-map"]');
    const windowMap = windowPanel(page, COLLECTION_S2.id);
    const mainNotice = mainMap.getByTestId('imagery-registration-notice');
    const windowNotice = windowMap.getByTestId('imagery-registration-notice');
    await expect(page.getByTestId('edit-placeholder-main')).toBeVisible();
    await page.getByTestId('save-required-default').click();
    await expect(page.getByTestId('edit-layout-trigger')).toBeVisible();
    if (!readyAtCreation) {
      await expect(mainNotice).toContainText('Imagery will appear automatically');
      await expect(windowNotice).toBeVisible();
      await expect(
        windowPanel(page, COLLECTION_S2.id).getByText('No imagery', { exact: true })
      ).toHaveCount(0);

      ready = true;
      await page.waitForResponse('**/api/campaigns/*/detailed');
    }
    await expect(mainNotice).toHaveCount(0);
    await expect(windowNotice).toHaveCount(0);
    await expect(layerButton(page)).toContainText('True Color');
    await expectImageryPainted(mainMap);
    await expectImageryPainted(windowMap);
  });
}

test('a registration response started before first-view creation does not discard the new view', async ({
  annotationPage: page,
}) => {
  let created = false;
  let reads = 0;
  let releaseRefresh = () => {};
  let markRefreshStarted = () => {};
  const heldRefresh = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const refreshStarted = new Promise<void>((resolve) => {
    markRefreshStarted = resolve;
  });
  const view = MOCK_CAMPAIGN.imagery_views[0];
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    const snapshot = {
      ...MOCK_CAMPAIGN,
      viewer_is_admin: true,
      registration_status: reads === 0 ? 'registering' : 'ready',
      imagery_views: created ? [view] : [],
    };
    if (++reads === 2) {
      markRefreshStarted();
      await heldRefresh;
    }
    await route.fulfill({ json: snapshot });
  });
  await page.route('**/api/*/imagery/views', (route) => {
    created = true;
    return route.fulfill({ status: 201, json: view });
  });
  await page.route('**/api/*/new-layout', (route) => route.fulfill({ status: 201, json: {} }));
  await mockVisibleImagery(page);

  await page.reload();
  await page.getByRole('button', { name: 'Set up layout anyway' }).click();
  await refreshStarted;
  await page.getByTestId('create-first-view').click();
  await page.getByTestId('save-required-default').click();
  const staleResponse = page.waitForResponse('**/api/campaigns/*/detailed');
  releaseRefresh();
  await staleResponse;
  await expect(page.getByTestId('edit-layout-trigger')).toBeVisible({ timeout: 1000 });
  await expectImageryPainted(page.locator('[data-panel-role="main-map"]'));
  await expectImageryPainted(windowPanel(page, COLLECTION_S2.id));
});

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
    await expect(windowPanel(annotationPage, COLLECTION_S2.id)).toBeAttached();
    await expect(windowPanel(annotationPage, COLLECTION_NDVI.id)).toBeAttached();
  });

  test('VHR window card is not in DOM in the first view', async ({ annotationPage }) => {
    await expect(windowPanel(annotationPage, COLLECTION_VHR.id)).not.toBeAttached();
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
    await annotationPage.keyboard.press('u');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText('VHR View', {
      timeout: 3000,
    });
  });

  test('V: active source is VHR and S2/NDVI windows leave DOM', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('u');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText('VHR View', {
      timeout: 3000,
    });

    // The VHR view holds a single source, so the layer selector shows only the
    // visualization name; the timeline is scoped to the active source, so its
    // collection is what proves the source switched.
    await expect(annotationPage.locator('[data-tour="timeline-sidebar"]')).toContainText(
      COLLECTION_VHR.name,
      { timeout: 3000 }
    );
    // S2 and NDVI window cards are no longer in the DOM for this view
    await expect(windowPanel(annotationPage, COLLECTION_S2.id)).not.toBeAttached({ timeout: 3000 });
    await expect(windowPanel(annotationPage, COLLECTION_NDVI.id)).not.toBeAttached();
  });

  test('V twice wraps back to the first view', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('u');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText('VHR View', {
      timeout: 3000,
    });

    await annotationPage.keyboard.press('u');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText(
      'Sentinel-2 View',
      { timeout: 3000 }
    );

    // A view carries its own window cards, so the S2 view's come back with it.
    await expect(windowPanel(annotationPage, COLLECTION_S2.id)).toBeAttached({ timeout: 3000 });
  });

  test('view switch does not move the crosshair', async ({ annotationPage }) => {
    await assertCrosshairAt(annotationPage, TASK_1.id, 'before V');
    await annotationPage.keyboard.press('u');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText('VHR View', {
      timeout: 3000,
    });
    await assertCrosshairAt(annotationPage, TASK_1.id, 'after V');
  });

  test('crosshair stays correct through view cycles and task navigation', async ({
    annotationPage,
  }) => {
    await annotationPage.keyboard.press('u');
    await annotationPage.keyboard.press('s');
    await waitForNavIdle(annotationPage);
    await assertCrosshairAt(annotationPage, TASK_2.id, 'task nav in VHR view');

    await annotationPage.keyboard.press('u');
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

    await expect(viewSelector(annotationPage).locator('button').first()).toContainText('VHR View', {
      timeout: 3000,
    });
    await expect(annotationPage.locator('[data-tour="timeline-sidebar"]')).toContainText(
      COLLECTION_VHR.name,
      { timeout: 3000 }
    );
  });

  test('selecting Sentinel-2 View from dropdown when VHR is active switches back', async ({
    annotationPage,
  }) => {
    await annotationPage.keyboard.press('u');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText('VHR View', {
      timeout: 3000,
    });

    await viewSelector(annotationPage).locator('button').first().click();
    await annotationPage.getByText('Sentinel-2 View').first().click();

    await expect(viewSelector(annotationPage).locator('button').first()).toContainText(
      'Sentinel-2 View',
      { timeout: 3000 }
    );
    // A view carries its own window cards, so the S2 view's come back with it.
    await expect(windowPanel(annotationPage, COLLECTION_S2.id)).toBeAttached({ timeout: 3000 });
  });

  test('dropdown does not move the crosshair', async ({ annotationPage }) => {
    await assertCrosshairAt(annotationPage, TASK_1.id, 'before dropdown switch');

    await viewSelector(annotationPage).locator('button').first().click();
    await annotationPage.getByText('VHR View').first().click();
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText('VHR View', {
      timeout: 3000,
    });

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

  test('timeline shows VHR collection after switching to VHR View', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('u');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText('VHR View', {
      timeout: 3000,
    });
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
    await expect(collectionButton(annotationPage)).toContainText(COLLECTION_S2.name);
    await expect(windowTitle(annotationPage, COLLECTION_S2.id)).toHaveAttribute(
      'data-window-active',
      'true'
    );

    await annotationPage.keyboard.press('Shift+d');

    await expect(collectionButton(annotationPage)).toContainText(COLLECTION_NDVI.name, {
      timeout: 3000,
    });
    await expect(windowTitle(annotationPage, COLLECTION_NDVI.id)).toHaveAttribute(
      'data-window-active',
      'true',
      { timeout: 3000 }
    );
    await expect(windowTitle(annotationPage, COLLECTION_S2.id)).toHaveAttribute(
      'data-window-active',
      'false'
    );
    // Stepping never leaves the view: VHR's collection has no window here.
    await expect(windowPanel(annotationPage, COLLECTION_VHR.id)).not.toBeAttached();
  });

  test('switching to VHR View narrows the layer selector to VHR visualizations', async ({
    annotationPage,
  }) => {
    // Sentinel-2 View offers both of its source's visualizations.
    await layerButton(annotationPage).click();
    const menu = annotationPage.locator('body > div.fixed.shadow-lg');
    await expect(menu.getByRole('button', { name: 'True Color', exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'False Color', exact: true })).toBeVisible();
    // The trigger toggles; HeaderSelect has no Escape handling.
    await layerButton(annotationPage).click();
    await expect(menu).toHaveCount(0);

    await annotationPage.keyboard.press('u');
    await expect(viewSelector(annotationPage).locator('button').first()).toContainText('VHR View', {
      timeout: 3000,
    });

    // VHR publishes a single visualization, so the selector lists only that one.
    await layerButton(annotationPage).click();
    await expect(menu.getByRole('button', { name: 'True Color', exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'False Color', exact: true })).toHaveCount(0);
  });
});

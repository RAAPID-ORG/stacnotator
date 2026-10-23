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
import type { CanvasLayoutCreate } from '../src/api/client';

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
                    tiles: ready ? slice.tiles : [],
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
    await expect(page.getByTestId('hidden-tray')).toContainText('Setting up the workspace');
    await expect(page.getByTestId('first-view-setup-banner')).toHaveCount(0);
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

test('layout dragging stops if the mouse button was released outside the window', async ({
  annotationPage: page,
}) => {
  await page.getByTestId('edit-layout-trigger').click();
  await page.getByRole('button', { name: 'Minimize edit layout', exact: true }).click();
  const panel = page.locator('[data-panel-id="main"]');
  const header = await panel.locator('.card-header').boundingBox();
  if (!header) throw new Error('Main map header is missing');
  await page.mouse.move(header.x + 30, header.y + header.height / 2);
  await page.mouse.down();
  await page.mouse.move(header.x + 70, header.y + 40, { steps: 4 });
  await expect(panel).toHaveClass(/react-draggable-dragging/);

  // The browser may miss mouseup outside its window; the next move reveals
  // that no button is held, rather than beginning another drag.
  await panel.evaluate((node) =>
    node.ownerDocument.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, buttons: 0, clientX: 200, clientY: 200 })
    )
  );
  await expect(panel).not.toHaveClass(/react-draggable-dragging/);
  await expect(page.locator('.react-grid-placeholder')).toHaveCount(0);
  await page.mouse.up();
  const dropped = await panel.boundingBox();
  await page.mouse.move(header.x + 120, header.y + 80, { steps: 4 });
  await expect.poll(() => panel.boundingBox()).toEqual(dropped);
});

test('dragging a panel body scrolls both canvas edges and saves its new position', async ({
  annotationPage: page,
}) => {
  let saved: CanvasLayoutCreate | undefined;
  await page.route('**/api/campaigns/*/detailed', (route) =>
    route.fulfill({
      json: {
        ...MOCK_CAMPAIGN,
        personal_main_canvas_layout: {
          id: 99,
          user_id: null,
          layout_data: [
            { i: 'main', x: 0, y: 0, w: 30, h: 8 },
            { i: 'controls', x: 44, y: 80, w: 16, h: 8 },
            { i: 'minimap', x: 32, y: 60, w: 12, h: 4 },
          ],
        },
        imagery_views: MOCK_CAMPAIGN.imagery_views.map((view) => ({
          ...view,
          default_canvas_layout: {
            ...view.default_canvas_layout,
            layout_data: [],
            hidden: ['10', '20'],
          },
        })),
      },
    })
  );
  await page.route('**/api/*/new-layout', async (route) => {
    saved = route.request().postDataJSON().layout;
    await route.fulfill({ status: 201, json: {} });
  });
  await page.reload();
  await page.getByTestId('edit-layout-trigger').click();
  await page.getByRole('button', { name: 'Minimize edit layout', exact: true }).click();
  const canvas = page.locator('[data-tour="canvas"]');
  const panel = page.locator('[data-panel-id="minimap"]');
  const body = page.getByTestId('edit-placeholder-minimap');
  await body.scrollIntoViewIfNeeded();
  expect(await canvas.evaluate((node) => node.scrollTop)).toBeGreaterThan(300);
  const bounds = await canvas.boundingBox();
  let grip = await body.boundingBox();
  if (!bounds || !grip) throw new Error('Scrollable canvas or minimap body is missing');
  const x = grip.x + grip.width / 4;
  await page.mouse.move(x, grip.y + grip.height / 3);
  await page.mouse.down();
  await page.mouse.move(x, bounds.y + 8, { steps: 6 });
  await expect(panel).toHaveClass(/react-draggable-dragging/);
  // Keep the pointer still: scrolling must carry the panel all the way up.
  await expect.poll(() => canvas.evaluate((node) => node.scrollTop)).toBe(0);
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.y - bounds.y).toBeLessThan(15);

  grip = await body.boundingBox();
  const panelBox = await panel.boundingBox();
  if (!grip || !panelBox) throw new Error('Dropped minimap body is missing');
  const grabOffset = grip.y - panelBox.y + grip.height / 3;
  const bottom = bounds.y + bounds.height - 8;
  await page.mouse.move(x, grip.y + grip.height / 3);
  await page.mouse.down();
  await page.mouse.move(x, bottom, { steps: 6 });
  await expect.poll(() => canvas.evaluate((node) => node.scrollTop)).toBeGreaterThan(200);
  await expect
    .poll(async () => Math.abs((await panel.boundingBox())!.y + grabOffset - bottom))
    .toBeLessThan(3);
  await page.mouse.up();
  await expect(panel).not.toHaveClass(/react-draggable-dragging/);
  await expect(page.locator('.react-grid-placeholder')).toHaveCount(0);
  const stoppedAt = await canvas.evaluate((node) => node.scrollTop);
  await page.mouse.move(x, bounds.y + 8);
  const afterRelease = await canvas.evaluate(async (node) => {
    for (let i = 0; i < 4; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return node.scrollTop;
  });
  expect(afterRelease).toBe(stoppedAt);

  await page.getByRole('button', { name: 'Show edit layout', exact: true }).click();
  await page.getByTestId('save-menu-trigger').click();
  const saving = page.waitForResponse('**/api/*/new-layout');
  await page.getByTestId('save-personal').click();
  await saving;
  expect(saved?.main_layout_data?.find((item) => item.i === 'minimap')?.y).toBeGreaterThan(0);
});

test('imagery bodies drag instead of hiding and task text fields stay interactive', async ({
  annotationPage: page,
}) => {
  await page.getByTestId('edit-layout-trigger').click();
  await page.getByRole('button', { name: 'Minimize edit layout', exact: true }).click();
  const controls = page.locator('[data-panel-id="controls"]');
  const comment = controls.locator('[data-task-comment-input]');
  await comment.scrollIntoViewIfNeeded();
  const field = await comment.boundingBox();
  if (!field) throw new Error('Task comment field is missing');
  await page.mouse.move(field.x + 20, field.y + 15);
  await page.mouse.down();
  await page.mouse.move(field.x + 40, field.y + 15, { steps: 3 });
  await expect(controls).not.toHaveClass(/react-draggable-dragging/);
  await page.mouse.up();
  await comment.fill('Still editable while arranging panels');
  await expect(comment).toHaveValue('Still editable while arranging panels');

  const panel = page.locator('[data-panel-id="10"]');
  const body = page.getByTestId('edit-placeholder-10');
  await body.scrollIntoViewIfNeeded();
  await body.click();
  await expect(panel).toBeVisible();
  const grip = await body.boundingBox();
  const before = await panel.boundingBox();
  if (!grip || !before) throw new Error('Imagery panel body is missing');
  await page.mouse.move(grip.x + grip.width / 3, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 3 + 450, grip.y + grip.height / 2, { steps: 8 });
  await expect(panel).toHaveClass(/react-draggable-dragging/);
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())?.x).toBeGreaterThan(before.x + 200);
  await page.getByTestId('hide-panel-10').click();
  await expect(panel).toHaveCount(0);
});

test('layout resizing stops on window blur and the next resize still works', async ({
  annotationPage: page,
}) => {
  await page.getByTestId('edit-layout-trigger').click();
  await page.getByRole('button', { name: 'Minimize edit layout', exact: true }).click();
  const panel = page.locator('[data-panel-id="main"]');
  const handle = panel.locator('.react-resizable-handle-se');
  const box = await handle.boundingBox();
  if (!box) throw new Error('Main map resize handle is missing');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 60, box.y - 30, { steps: 4 });
  await expect(panel).toHaveClass(/resizing/);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(panel).not.toHaveClass(/resizing/);
  await expect(page.locator('.react-grid-placeholder')).toHaveCount(0);
  await page.mouse.up();
  const dropped = await panel.boundingBox();
  await page.mouse.move(box.x - 100, box.y - 60, { steps: 4 });
  await expect.poll(() => panel.boundingBox()).toEqual(dropped);

  const nextHandle = await panel.locator('.react-resizable-handle-w').boundingBox();
  if (!nextHandle || !dropped) throw new Error('Resized main map is missing');
  await page.mouse.move(nextHandle.x + nextHandle.width / 2, nextHandle.y + nextHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(nextHandle.x + 40, nextHandle.y + nextHandle.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(panel).not.toHaveClass(/resizing/);
  await expect.poll(async () => (await panel.boundingBox())?.width).toBeLessThan(dropped.width);
});

test('the floating layout panel moves, resizes, and releases cancelled gestures', async ({
  annotationPage: page,
}) => {
  await page.getByTestId('edit-layout-trigger').click();
  const tray = page.getByTestId('hidden-tray');
  const header = page.getByTestId('move-hidden-tray');
  const before = await tray.boundingBox();
  const handle = await header.boundingBox();
  if (!before || !handle) throw new Error('Layout panel is missing');
  await page.mouse.move(handle.x + 80, handle.y + 10);
  await page.mouse.down();
  await page.mouse.move(handle.x - 20, handle.y - 60, { steps: 4 });
  await header.dispatchEvent('pointercancel');
  await page.mouse.up();
  const moved = await tray.boundingBox();
  if (!moved) throw new Error('Moved layout panel is missing');
  expect(moved.x).toBeLessThan(before.x);
  expect(moved.y).toBeLessThan(before.y);
  await page.mouse.move(handle.x - 80, handle.y - 100, { steps: 4 });
  await expect.poll(() => tray.boundingBox()).toEqual(moved);

  const resize = page.getByTestId('resize-hidden-tray');
  const resizeBox = await resize.boundingBox();
  if (!resizeBox) throw new Error('Layout panel resize handle is missing');
  await page.mouse.move(resizeBox.x + 5, resizeBox.y + 5);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x - 40, resizeBox.y - 30, { steps: 4 });
  await resize.dispatchEvent('pointercancel');
  await page.mouse.up();
  const resized = await tray.boundingBox();
  if (!resized) throw new Error('Resized layout panel is missing');
  expect(resized.width).toBeGreaterThan(moved.width);
  await page.mouse.move(resizeBox.x - 80, resizeBox.y - 60, { steps: 4 });
  await expect.poll(() => tray.boundingBox()).toEqual(resized);
  await page.getByRole('button', { name: 'Minimize edit layout', exact: true }).click();
  await expect(tray).toHaveCount(0);
  await page.getByTitle('Show edit layout', { exact: true }).click();
  await expect.poll(() => tray.boundingBox()).toEqual(resized);
});

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

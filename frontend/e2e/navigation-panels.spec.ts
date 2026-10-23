import { test, expect } from './fixtures/annotator-fixture';
import {
  COLLECTION_NDVI,
  COLLECTION_S2,
  MOCK_CAMPAIGN,
  MOCK_CAMPAIGN_MULTI_SOURCE,
} from './fixtures/mock-data';
import type { CanvasLayoutCreate, CanvasLayoutItem, ImageryViewOut } from '../src/api/client';

for (const admin of [false, true]) {
  test(`${admin ? 'admin' : 'annotator'}: Edit Layout footer actions fit after resizing and moving the popover`, async ({
    annotationPage: page,
  }) => {
    await page.route('**/api/campaigns/*/detailed', (route) =>
      route.fulfill({ json: { ...MOCK_CAMPAIGN, viewer_is_admin: admin } })
    );
    await page.route('**/api/*/new-layout', (route) => route.fulfill({ status: 201, json: {} }));
    await page.reload();
    await page.getByTestId('edit-layout-trigger').click();
    const tray = page.getByTestId('hidden-tray');
    const header = page.getByTestId('move-hidden-tray');
    const actions = page.getByTestId('layout-footer-actions');
    await expect(header.getByText('Edit Layout', { exact: true })).toBeVisible();
    await expect(header.getByRole('button', { name: /^(Save|Reset|Cancel)$/ })).toHaveCount(0);
    const toolbar = page.locator('[data-tour="toolbar"]');
    await expect(toolbar.getByTestId('save-menu-trigger')).toHaveCount(0);
    await expect(toolbar.getByRole('button', { name: /^(Reset|Cancel)$/ })).toHaveCount(0);
    await expect(
      page.getByText('Drag headers to move panels; resize from any edge.', { exact: true })
    ).toHaveCount(0);

    const resize = await page.getByTestId('resize-hidden-tray').boundingBox();
    if (!resize) throw new Error('Layout resize handle is missing');
    await page.mouse.move(resize.x + 4, resize.y + 4);
    await page.mouse.down();
    await page.mouse.move(resize.x + 400, resize.y + 500, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await tray.boundingBox())?.width).toBeLessThan(285);

    const grip = await header.boundingBox();
    if (!grip) throw new Error('Layout header is missing');
    await page.mouse.move(grip.x + 45, grip.y + 8);
    await page.mouse.down();
    await page.mouse.move(45, 20, { steps: 6 });
    await page.mouse.up();
    await page.setViewportSize({ width: 800, height: 400 });
    await expect(async () => {
      const bounds = await header.boundingBox();
      if (!bounds) throw new Error('Moved layout header is missing');
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(800);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(400);
    }).toPass({ timeout: 5000 });
    await expect(actions.getByRole('button')).toHaveText(['Reset', 'Cancel', 'Save']);
    for (const name of ['Save', 'Reset', 'Cancel']) {
      const button = actions.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      expect(
        await button.evaluate((node) => {
          const footer = node.closest('[data-testid="layout-footer-actions"]')!;
          const bounds = node.getBoundingClientRect();
          const outer = footer.getBoundingClientRect();
          const hit = document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2
          );
          return (
            bounds.left >= outer.left &&
            bounds.right <= outer.right &&
            bounds.top >= outer.top &&
            bounds.bottom <= outer.bottom &&
            Math.abs(bounds.y + bounds.height / 2 - (outer.y + outer.height / 2)) < 1 &&
            (hit === node || (hit !== null && node.contains(hit)))
          );
        })
      ).toBe(true);
    }
    await actions.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Reset Layout?' })).toBeVisible();
    await page.getByRole('button', { name: 'Reset', exact: true }).last().click();
    await expect(page.getByRole('heading', { name: 'Reset Layout?' })).toHaveCount(0);
    await actions.getByTestId('save-menu-trigger').click();
    await expect(actions.getByTestId('save-default')).toHaveCount(admin ? 1 : 0);
    const menuBounds = await actions.getByTestId('save-menu').boundingBox();
    const saveBounds = await actions.getByTestId('save-menu-trigger').boundingBox();
    if (!menuBounds || !saveBounds) throw new Error('Upward Save menu is missing');
    expect(menuBounds.y).toBeGreaterThanOrEqual(0);
    expect(menuBounds.y + menuBounds.height).toBeLessThan(saveBounds.y);
    expect(menuBounds.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(800);
    const saving = page.waitForResponse('**/api/*/new-layout');
    await actions.getByTestId('save-personal').click();
    expect((await saving).request().postDataJSON().should_be_default).toBe(false);
    await expect(page.getByTestId('edit-layout-trigger')).toBeVisible();
  });
}

test('desktop slice navigation follows campaign defaults and preserves a personal opt-out', async ({
  annotationPage: page,
}) => {
  let saved: CanvasLayoutCreate | undefined;
  await page.route('**/api/campaigns/*/detailed', (route) =>
    route.fulfill({
      json: {
        ...MOCK_CAMPAIGN,
        default_main_canvas_layout: {
          ...MOCK_CAMPAIGN.default_main_canvas_layout,
          layout_data: MOCK_CAMPAIGN.default_main_canvas_layout.layout_data.map((item) =>
            item.i === 'main' ? { ...item, slice_navigation: true } : item
          ),
        },
        personal_main_canvas_layout: saved
          ? { id: 99, user_id: null, layout_data: saved.main_layout_data }
          : null,
      },
    })
  );
  await page.route('**/api/*/new-layout', async (route) => {
    saved = route.request().postDataJSON().layout;
    await route.fulfill({ status: 201, json: {} });
  });
  await page.reload();
  await expect(page.getByTestId('slice-navigation')).toBeVisible();
  await page.getByTestId('edit-layout-trigger').click();
  const checkbox = page.getByLabel('Slice navigation buttons', { exact: true });
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await page.getByTestId('save-menu-trigger').click();
  const saving = page.waitForResponse('**/api/*/new-layout');
  await page.getByTestId('save-personal').click();
  await saving;
  expect(saved?.main_layout_data?.find((item) => item.i === 'main')?.slice_navigation).toBe(false);
  await page.reload();
  await expect(page.getByTestId('slice-navigation')).toHaveCount(0);
  await page.getByTestId('edit-layout-trigger').click();
  await expect(checkbox).not.toBeChecked();
});

test('saving a new source shows an orange off-canvas warning before persisting', async ({
  annotationPage: page,
}) => {
  await page.route(/\/api\/campaigns\/\d+(\/detailed)?(\?.*)?$/, (route) =>
    route.fulfill({ json: { ...MOCK_CAMPAIGN, viewer_is_admin: true } })
  );
  await page.route(/\/api\/campaigns\/\d+\/(custom-maps|vector-layers)(\?.*)?$/, (route) =>
    route.fulfill({ json: [] })
  );
  await page.goto('/projects/7/campaigns/42/settings?tab=imagery');
  await page.getByRole('button', { name: 'Create source', exact: true }).click();
  await page.getByRole('button', { name: /Custom \(other\)/ }).click();
  await page.getByRole('button', { name: /No - I have raw XYZ tile URLs/ }).click();
  await page
    .getByPlaceholder('https://.../tiles/{z}/{x}/{y}', { exact: true })
    .fill('https://tiles.example.com/test/{z}/{x}/{y}.png');
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  const warning = page.getByRole('heading', { name: 'New sources start off the canvas' });
  await expect(warning).toBeVisible();
  await expect(warning.locator('svg')).toHaveClass(/text-orange-500/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
});

for (const mode of ['tasks', 'open']) {
  test(`${mode}: source order saves on the view and selects the first source after reload`, async ({
    annotationPage: page,
  }) => {
    const view = { ...MOCK_CAMPAIGN_MULTI_SOURCE.imagery_views[0], source_ids: [1, 2] };
    const alternateView = { ...view, id: 2, name: 'Alternate view', source_ids: [2, 1] };
    await page.route(/\/api\/campaigns\/\d+(\/detailed)?(\?.*)?$/, (route) =>
      route.fulfill({
        json: {
          ...MOCK_CAMPAIGN_MULTI_SOURCE,
          mode,
          viewer_is_admin: true,
          imagery_views: [view, alternateView],
        },
      })
    );
    await page.route('**/api/*/imagery/views/1', (route) => {
      const body: Pick<ImageryViewOut, 'source_ids'> = route.request().postDataJSON();
      view.source_ids = body.source_ids;
      return route.fulfill({ json: view });
    });
    await page.route(/\/api\/campaigns\/\d+\/(custom-maps|vector-layers)(\?.*)?$/, (route) =>
      route.fulfill({ json: [] })
    );
    await page.reload();
    const activeLayer = page.locator('[data-tour="layer-selector"] button').first();
    await expect(activeLayer).toContainText('Sentinel-2');
    await page.getByTestId('edit-layout-trigger').click();
    const sources = page.getByTestId('view-sources');
    const firstSource = sources.locator('[data-source-id]').first();
    await expect(firstSource).toContainText('Sentinel-2');
    await page.getByTestId('view-picker-trigger').click();
    await page.getByRole('button', { name: alternateView.name, exact: true }).click();
    await expect(firstSource).toContainText('VHR');
    await page.getByTestId('view-picker-trigger').click();
    await page.getByRole('button', { name: view.name, exact: true }).click();
    await expect(firstSource).toContainText('Sentinel-2');
    await expect(sources.getByRole('button', { name: 'Move source Sentinel-2 up' })).toBeDisabled();
    const saving = page.waitForResponse('**/api/*/imagery/views/1');
    await sources
      .getByRole('button', {
        name: mode === 'tasks' ? 'Move source VHR up' : 'Move source Sentinel-2 down',
      })
      .click();
    expect((await saving).request().postDataJSON()).toEqual({ source_ids: [2, 1] });
    await expect(firstSource).toContainText('VHR');
    await expect(sources.getByRole('button', { name: 'Move source VHR up' })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.reload();
    await expect(activeLayer).toContainText('VHR');
    await page.getByTestId('edit-layout-trigger').click();
    await expect(firstSource).toContainText('VHR');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByTitle('Campaign Settings', { exact: true }).click();
    await page.getByRole('tab', { name: 'Imagery', exact: true }).click();
    await expect(page.getByLabel('Order sources in view', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Move source / })).toHaveCount(0);
    await expect(page.getByTestId('view-admin')).toHaveCount(0);
  });
}

test('non-admins can edit their layout without view or source-order administration', async ({
  annotationPage: page,
}) => {
  await page.route('**/api/campaigns/*/detailed', (route) =>
    route.fulfill({ json: { ...MOCK_CAMPAIGN_MULTI_SOURCE, viewer_is_admin: false } })
  );
  await page.reload();
  await page.getByTestId('edit-layout-trigger').click();
  await expect(page.getByLabel('Timeline in a separate panel')).toBeVisible();
  await expect(page.getByTestId('view-admin')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Move source / })).toHaveCount(0);
});

test('work list follows settings in both task and explore modes', async ({
  annotationPage: page,
}) => {
  await page.route('**/api/campaigns/*/detailed', (route) =>
    route.fulfill({ json: { ...MOCK_CAMPAIGN, viewer_is_admin: true } })
  );
  await page.reload();

  const workList = page.locator(
    'button[title="Campaign Settings"] + [data-testid="open-work-list"]'
  );
  await expect(workList).toHaveText('All tasks');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(workList).toHaveText('All annotations');
});

for (const orientation of ['horizontal', 'vertical']) {
  test(`${orientation}: timeline clicks do not outline the track and keyboard focus highlights only the selection`, async ({
    annotationPage: page,
  }) => {
    await page.route('**/api/campaigns/*/detailed', (route) =>
      route.fulfill({
        json: {
          ...MOCK_CAMPAIGN,
          personal_main_canvas_layout: {
            id: 99,
            user_id: null,
            layout_data: [
              ...MOCK_CAMPAIGN.default_main_canvas_layout.layout_data,
              { i: 'timeline', x: 0, y: 55, w: 16, h: 6, orientation },
            ],
          },
        },
      })
    );
    await page.reload();
    const timeline = page.getByTestId('imagery-timeline');
    const slider = timeline.getByRole('slider');
    await slider.press('Home');
    await expect(slider).toBeFocused();
    await expect(slider).toHaveCSS('box-shadow', 'none');
    const selected = timeline.getByText(COLLECTION_S2.name, { exact: true }).locator('..');
    await expect(selected).not.toHaveCSS('box-shadow', 'none');
    await expect(selected).toHaveCSS('outline-style', 'none');

    await timeline.locator(`[data-collection-id="${COLLECTION_NDVI.id}"]`).click();
    await expect(slider).toHaveAttribute('aria-valuetext', COLLECTION_NDVI.name);
    await expect(slider).toHaveCSS('box-shadow', 'none');
    await expect(slider).toHaveCSS('outline-style', 'none');
    await slider.press('Home');
    await expect(slider).toHaveAttribute('aria-valuetext', COLLECTION_S2.name);
  });
}

test('long horizontal timeline labels stay between the endpoint dates', async ({
  annotationPage: page,
}) => {
  const source = MOCK_CAMPAIGN.imagery_sources[0];
  const collections = source.collections.map((collection) => ({
    ...collection,
    name: `${collection.name} with a very long collection name that must not overlap the endpoint dates`,
  }));
  await page.route('**/api/campaigns/*/detailed', (route) =>
    route.fulfill({
      json: {
        ...MOCK_CAMPAIGN,
        imagery_sources: [{ ...source, collections }],
        personal_main_canvas_layout: {
          id: 99,
          user_id: null,
          layout_data: [
            ...MOCK_CAMPAIGN.default_main_canvas_layout.layout_data.map((item) =>
              item.i === 'main' ? { ...item, x: 12, w: 32 } : item
            ),
            { i: 'timeline', x: 0, y: 0, w: 12, h: 4, orientation: 'horizontal' },
          ],
        },
      },
    })
  );
  await page.reload();

  const timeline = page.getByTestId('imagery-timeline');
  const slider = timeline.getByRole('slider');
  for (const [key, collection] of [
    ['Home', collections[0]],
    ['End', collections[1]],
  ] as const) {
    await slider.press(key);
    await expect(slider).toHaveAttribute('aria-valuetext', collection.name);
    const label = timeline.getByText(collection.name, { exact: true });
    await expect
      .poll(async () => {
        const bounds = await label.locator('..').boundingBox();
        const start = await timeline.locator(':scope > span').first().boundingBox();
        const end = await timeline.locator(':scope > span').last().boundingBox();
        return (
          !!bounds &&
          !!start &&
          !!end &&
          bounds.x >= start.x + start.width &&
          bounds.x + bounds.width <= end.x
        );
      })
      .toBe(true);
    expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  }
});

test('detach, resize, save and reload navigation panels with one-click imagery choices', async ({
  annotationPage: page,
}) => {
  let saved: CanvasLayoutCreate | undefined;
  await page.route('**/api/*/new-layout', async (route) => {
    saved = route.request().postDataJSON().layout;
    await route.fulfill({ status: 201, json: {} });
  });
  await page.route('**/api/campaigns/*/detailed', (route) =>
    route.fulfill({
      json: {
        ...MOCK_CAMPAIGN,
        personal_main_canvas_layout: saved
          ? { id: 99, user_id: null, layout_data: saved.main_layout_data }
          : null,
      },
    })
  );

  await page.getByTestId('edit-layout-trigger').click();
  await page.getByLabel('Timeline in a separate panel').check();
  await expect
    .poll(async () => {
      const map = await page.locator('[data-panel-id="main"]').boundingBox();
      const timeline = await page.locator('[data-panel-id="timeline"]').boundingBox();
      return (
        !!map &&
        !!timeline &&
        Math.abs(timeline.x + timeline.width + 6 - map.x) < 2 &&
        Math.abs(timeline.y - map.y) < 2 &&
        Math.abs(timeline.height - map.height) < 2
      );
    })
    .toBe(true);
  await page.getByLabel('Timeline orientation', { exact: true }).selectOption('horizontal');
  await expect
    .poll(async () => {
      const map = await page.locator('[data-panel-id="main"]').boundingBox();
      const timeline = await page.locator('[data-panel-id="timeline"]').boundingBox();
      return (
        !!map &&
        !!timeline &&
        Math.abs(map.y + map.height + 6 - timeline.y) < 2 &&
        Math.abs(timeline.x - map.x) < 2 &&
        Math.abs(timeline.width - map.width) < 2
      );
    })
    .toBe(true);
  await page.getByLabel('Imagery controls in a separate panel').check();
  await page.getByLabel('Imagery controls orientation', { exact: true }).selectOption('vertical');
  await expect(page.getByLabel('Show all imagery options')).toHaveCount(0);
  await page.getByLabel('Slice navigation buttons', { exact: true }).check();
  await page.getByRole('button', { name: 'Minimize edit layout', exact: true }).click();

  const imageryPanel = page.locator('[data-panel-id="imagery"]');
  await expect(
    imageryPanel.getByRole('radiogroup', { name: 'Imagery sources', exact: true })
  ).toBeVisible();
  for (const section of ['Collections', 'Dates']) {
    await expect(imageryPanel.getByRole('radiogroup', { name: section, exact: true })).toHaveCount(
      0
    );
    await expect(
      imageryPanel.getByRole('button', { name: `Expand ${section}`, exact: true })
    ).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(imageryPanel.locator('button[title^="Select layer"]')).toHaveCount(0);

  const timelinePanel = page.locator('[data-panel-id="timeline"]');
  await expect(timelinePanel.getByRole('slider')).toHaveCount(0);
  const timelineHeader = timelinePanel.locator('.panel-drag-handle.editable');
  await expect(timelineHeader).toContainText('Timeline');
  await expect
    .poll(async () => {
      const panel = await timelinePanel.boundingBox();
      const header = await timelineHeader.boundingBox();
      return panel && header ? Math.abs(panel.height - header.height) : Infinity;
    })
    .toBeLessThan(3);
  await timelinePanel.scrollIntoViewIfNeeded();
  const before = await timelinePanel.boundingBox();
  const handle = await timelinePanel.locator('.react-resizable-handle-e').boundingBox();
  if (!before || !handle) throw new Error('Timeline panel or resize handle missing');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x - 60, handle.y + handle.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await timelinePanel.boundingBox())?.width)
    .toBeLessThan(before.width);

  const dragFrom = await timelineHeader.boundingBox();
  if (!dragFrom) throw new Error('Full-size timeline drag header missing');
  await page.mouse.move(dragFrom.x + dragFrom.width / 4, dragFrom.y + dragFrom.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(dragFrom.x + dragFrom.width / 4 + 24, dragFrom.y + dragFrom.height * 0.6, {
    steps: 6,
  });
  await page.mouse.up();
  await expect.poll(async () => (await timelinePanel.boundingBox())?.x).toBeGreaterThan(dragFrom.x);

  await page.getByRole('button', { name: 'Show edit layout', exact: true }).click();
  await imageryPanel.getByRole('button', { name: 'Expand Collections', exact: true }).click();
  await imageryPanel.getByRole('button', { name: 'Expand Dates', exact: true }).click();
  await page.getByTestId('save-menu-trigger').click();
  const saving = page.waitForResponse('**/api/*/new-layout');
  await page.getByTestId('save-personal').click();
  await saving;
  await expect(page.getByTestId('edit-layout-trigger')).toBeVisible();
  expect(saved?.main_layout_data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ i: 'timeline', orientation: 'horizontal' }),
      expect.objectContaining({
        i: 'imagery',
        orientation: 'vertical',
        expanded_sections: ['collections', 'slices'],
      }),
      expect.objectContaining({ i: 'main', slice_navigation: true }),
    ])
  );

  await page.reload();
  await expect(timelinePanel.locator('.card-header')).toHaveCount(0);
  await expect(timelinePanel.getByRole('slider')).toHaveAttribute('aria-orientation', 'horizontal');
  await expect(imageryPanel.locator('[data-tour="map-controls"]')).toHaveAttribute(
    'data-orientation',
    'vertical'
  );
  await expect(page.locator('[data-panel-id="main"] [data-tour="layer-selector"]')).toHaveCount(0);
  await expect(page.locator('[data-panel-id="main"] [data-testid="imagery-timeline"]')).toHaveCount(
    0
  );
  await expect(page.getByTestId('slice-navigation')).toBeVisible();
  const mainPanel = page.locator('[data-panel-id="main"]');
  const navigation = mainPanel.getByTestId('slice-navigation');
  await expect(navigation).toBeVisible();
  expect(
    await navigation
      .getByRole('button')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))
  ).toEqual(['Previous collection', 'Previous slice', 'Next slice', 'Next collection']);
  const mapBounds = await mainPanel.locator('[data-map-loading]').boundingBox();
  const navigationBounds = await navigation.boundingBox();
  if (!mapBounds || !navigationBounds) throw new Error('Map or navigation bounds missing');
  expect(
    Math.abs(navigationBounds.x + navigationBounds.width / 2 - mapBounds.x - mapBounds.width / 2)
  ).toBeLessThan(2);
  expect(navigationBounds.y).toBeGreaterThan(mapBounds.y);
  expect(navigationBounds.y + navigationBounds.height).toBeLessThan(mapBounds.y + mapBounds.height);
  await expect(mainPanel.locator('[data-slice-comment-open]')).toBeVisible();
  await expect(imageryPanel.locator('[data-slice-comment-open]')).toHaveCount(0);
  await expect(imageryPanel.getByRole('button', { name: /^(Expand|Collapse) / })).toHaveCount(0);
  await expect(imageryPanel.getByText(/^(Collections|Dates)$/)).toHaveCount(0);
  for (const control of ['map-focus', 'crosshair-toggle', 'view-sync-toggle']) {
    await expect(mainPanel.getByTestId(control)).toBeVisible();
    await expect(imageryPanel.getByTestId(control)).toHaveCount(0);
  }

  const layers = imageryPanel.getByRole('group', {
    name: 'Sentinel-2 visualizations',
    exact: true,
  });
  await layers.getByRole('button', { name: 'False Color', exact: true }).click();
  await expect(layers.getByRole('button', { name: 'False Color', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const collections = imageryPanel.getByRole('radiogroup', { name: 'Collections', exact: true });
  await collections.getByRole('radio', { name: COLLECTION_NDVI.name, exact: true }).check();
  await expect(timelinePanel.getByRole('slider')).toHaveAttribute(
    'aria-valuetext',
    COLLECTION_NDVI.name
  );
  await timelinePanel.getByRole('slider').press('Home');
  await timelinePanel.locator(`[data-collection-id="${COLLECTION_NDVI.id}"]`).click();
  await expect(timelinePanel.getByRole('slider')).toHaveAttribute(
    'aria-valuetext',
    COLLECTION_NDVI.name
  );
  await timelinePanel.getByRole('slider').focus();
  await page.keyboard.press('Home');
  await expect(
    collections.getByRole('radio', { name: COLLECTION_S2.name, exact: true })
  ).toBeChecked();

  const slices = imageryPanel.getByRole('radiogroup', { name: 'Dates', exact: true });
  const firstSlice = await slices.getByRole('radio', { checked: true }).inputValue();
  await page
    .getByTestId('slice-navigation')
    .getByRole('button', { name: 'Next slice', exact: true })
    .click();
  await expect(slices.getByRole('radio', { checked: true })).not.toHaveValue(firstSlice);
  await navigation.getByRole('button', { name: 'Next collection', exact: true }).click();
  await expect(timelinePanel.getByRole('slider')).toHaveAttribute(
    'aria-valuetext',
    COLLECTION_NDVI.name
  );
  await navigation.getByRole('button', { name: 'Previous collection', exact: true }).click();
  await expect(timelinePanel.getByRole('slider')).toHaveAttribute(
    'aria-valuetext',
    COLLECTION_S2.name
  );
});

for (const orientation of ['horizontal', 'vertical'] as const) {
  test(`${orientation}: source choices and their smaller visualization section stay in sync`, async ({
    annotationPage: page,
  }) => {
    await page.route('**/api/campaigns/*/detailed', (route) =>
      route.fulfill({
        json: {
          ...MOCK_CAMPAIGN_MULTI_SOURCE,
          personal_main_canvas_layout: {
            id: 99,
            user_id: null,
            layout_data: [
              ...MOCK_CAMPAIGN.default_main_canvas_layout.layout_data,
              {
                i: 'imagery',
                x: 0,
                y: 55,
                w: 20,
                h: 12,
                orientation,
                expanded_sections: [],
              },
            ],
          },
        },
      })
    );
    await page.reload();
    const panel = page.locator('[data-panel-id="imagery"]');
    const pickers = panel.locator('[data-tour="collection-picker"], [data-tour="slice-picker"]');
    await expect(pickers).toHaveCount(2);
    const spacing = await pickers.evaluateAll(
      (sections, orientation) =>
        sections.map((section) => {
          const outer = section.getBoundingClientRect();
          const inner = section.firstElementChild!.getBoundingClientRect();
          const style = getComputedStyle(section);
          return orientation === 'vertical'
            ? {
                before: inner.top - outer.top - parseFloat(style.borderTopWidth),
                after: outer.bottom - inner.bottom - parseFloat(style.borderBottomWidth),
              }
            : {
                before: inner.left - outer.left - parseFloat(style.borderLeftWidth),
                after: outer.right - inner.right - parseFloat(style.borderRightWidth),
              };
        }),
      orientation
    );
    for (const { before, after } of spacing) {
      expect(before).toBeGreaterThan(0);
      expect(Math.abs(before - after)).toBeLessThan(1);
    }
    const sources = panel.getByRole('radiogroup', { name: 'Imagery sources', exact: true });
    const visualizations = panel.getByRole('group', {
      name: 'Sentinel-2 visualizations',
      exact: true,
    });
    const vhrVisualizations = panel.getByRole('group', { name: 'VHR visualizations', exact: true });
    await expect(sources.getByRole('radio', { name: 'VHR', exact: true })).toBeChecked();
    await sources.getByRole('radio', { name: 'Sentinel-2', exact: true }).check();
    await visualizations.getByRole('button', { name: 'False Color', exact: true }).click();
    await expect(sources.getByRole('radio', { name: 'Sentinel-2', exact: true })).toBeChecked();
    await expect(
      visualizations.getByRole('button', { name: 'False Color', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    await sources.getByRole('radio', { name: 'VHR', exact: true }).check();
    await expect(
      visualizations.getByRole('button', { name: 'False Color', exact: true })
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(
      vhrVisualizations.getByRole('button', { name: 'True Color', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    await sources.getByRole('radio', { name: 'VHR', exact: true }).blur();
    await page.keyboard.press('i');
    await expect(sources.getByRole('radio', { name: 'Sentinel-2', exact: true })).toBeChecked();
    await expect(
      visualizations.getByRole('button', { name: 'False Color', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    await vhrVisualizations.getByRole('button', { name: 'True Color', exact: true }).click();
    await expect(sources.getByRole('radio', { name: 'VHR', exact: true })).toBeChecked();
    await expect(panel.getByRole('button', { name: /^(Expand|Collapse) / })).toHaveCount(0);
    await expect(panel.getByText(/^(Collections|Dates)$/)).toHaveCount(0);
    await page.getByTestId('edit-layout-trigger').click();
    await page.getByRole('button', { name: 'Minimize edit layout', exact: true }).click();
    for (const section of ['Collections', 'Dates']) {
      const dropdown = panel.locator(
        section === 'Collections'
          ? 'button[title^="Select collection"]'
          : 'button[title^="Select time slice"]'
      );
      await expect(dropdown).toBeVisible();
      await expect(
        panel.getByRole('button', { name: `Expand ${section}`, exact: true })
      ).toHaveText('Expand');
      await panel.getByRole('button', { name: `Expand ${section}`, exact: true }).click();
      await expect(panel.getByRole('radiogroup', { name: section, exact: true })).toBeVisible();
      await panel.getByRole('button', { name: `Collapse ${section}`, exact: true }).click();
      await expect(panel.getByRole('radiogroup', { name: section, exact: true })).toHaveCount(0);
    }
    await panel.getByRole('button', { name: 'Expand Collections', exact: true }).click();
    await page.getByRole('button', { name: 'Show edit layout', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(panel.getByRole('radiogroup', { name: 'Collections', exact: true })).toHaveCount(
      0
    );
    await expect(panel.getByRole('button', { name: /^(Expand|Collapse) / })).toHaveCount(0);
    await expect(sources).toBeVisible();
  });
}

test('cancel and reset restore integrated controls and desktop overlay defaults', async ({
  annotationPage: page,
}) => {
  await page.locator(`[data-collection-id="${COLLECTION_NDVI.id}"]`).click();
  await expect(page.getByRole('slider', { name: 'Imagery timeline' })).toHaveAttribute(
    'aria-valuetext',
    COLLECTION_NDVI.name
  );
  await page.getByTestId('edit-layout-trigger').click();
  await page.getByLabel('Timeline in a separate panel').check();
  await page.getByLabel('Imagery controls in a separate panel').check();
  await page.getByLabel('Slice navigation buttons', { exact: true }).check();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('[data-panel-id="timeline"], [data-panel-id="imagery"]')).toHaveCount(
    0
  );
  await expect(page.getByTestId('slice-navigation')).toHaveCount(0);
  await expect(page.locator('[data-panel-id="main"] [data-tour="layer-selector"]')).toBeVisible();
  await expect(
    page.locator('[data-panel-id="main"] [data-testid="imagery-timeline"]')
  ).toBeVisible();

  await page.getByTestId('edit-layout-trigger').click();
  await page.getByLabel('Timeline in a separate panel').check();
  await page.getByLabel('Imagery controls in a separate panel').check();
  await page.getByLabel('Slice navigation buttons', { exact: true }).check();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reset Layout?' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset', exact: true }).last().click();
  await expect(page.getByLabel('Timeline in a separate panel')).not.toBeChecked();
  await expect(page.getByLabel('Imagery controls in a separate panel')).not.toBeChecked();
  await expect(page.getByLabel('Slice navigation buttons', { exact: true })).not.toBeChecked();
});

test.describe('touch devices', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('mobile keeps compact map controls even with detached desktop panels', async ({
    annotationPage: page,
  }) => {
    const items: CanvasLayoutItem[] = [
      ...MOCK_CAMPAIGN.default_main_canvas_layout.layout_data,
      { i: 'timeline', x: 0, y: 55, w: 40, h: 5, orientation: 'horizontal' },
      {
        i: 'imagery',
        x: 40,
        y: 55,
        w: 20,
        h: 20,
        orientation: 'vertical',
        expanded_sections: ['sources', 'slices'],
      },
    ];
    await page.route('**/api/campaigns/*/detailed', (route) =>
      route.fulfill({
        json: {
          ...MOCK_CAMPAIGN,
          personal_main_canvas_layout: { id: 99, user_id: null, layout_data: items },
        },
      })
    );
    await page.reload();
    await expect(page.locator('[data-panel-id="timeline"], [data-panel-id="imagery"]')).toHaveCount(
      0
    );
    await expect(page.locator('[data-panel-id="main"] [data-tour="layer-selector"]')).toBeVisible();
    await expect(
      page.locator('[data-panel-id="main"] [data-testid="imagery-timeline"]')
    ).toBeVisible();
    await expect(page.getByTestId('slice-navigation')).toBeVisible();
  });
});

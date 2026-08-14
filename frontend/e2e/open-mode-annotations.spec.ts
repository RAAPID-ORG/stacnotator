import { test, expect } from './fixtures/annotator-fixture';
import type { ApiCapture } from './fixtures/annotator-fixture';
import {
  MOCK_CAMPAIGN,
  MOCK_CAMPAIGN_OPEN_MODE,
  MOCK_CAMPAIGN_OPEN_MODE_NO_TS,
  OPEN_ANN_CENTER,
  OPEN_ANN_NE_FLAGGED,
  OPEN_ANN_SW_POLYGON,
  OPEN_MODE_CENTER,
  TASK_3,
} from './fixtures/mock-data';
import {
  assertCoordsMatch,
  boxSelectWholeCanvas,
  clickMapAt,
  clickMapCenter,
  ctrlClickMapCenter,
  drawPolygon,
  fitAllAnnotations,
  getMinimapCenter,
  parseWkt,
  waitForMinimapCenter,
  waitForBatchDelete,
  waitForCreate,
  waitForDelete,
  waitForUpdate,
} from './fixtures/imagery-helpers';

type Page = import('@playwright/test').Page;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function loadOpenMode(
  page: Page,
  api: ApiCapture,
  opts: { noTimeseries?: boolean } = {}
): Promise<void> {
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    await route.fulfill({
      json: opts.noTimeseries ? MOCK_CAMPAIGN_OPEN_MODE_NO_TS : MOCK_CAMPAIGN_OPEN_MODE,
    });
  });
  await page.reload();
  await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
  await page.locator('[title="Pan (P)"]').waitFor({ state: 'visible', timeout: 10_000 });
  // Map laid out -> minimap reports a centre.
  await page
    .locator('[data-testid="viewport-center"]')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  api.clear();
}

const tool = (page: Page, title: string) => page.locator(`[title="${title}"]`);
const controls = (page: Page) => page.locator('[data-tour="controls"]');
const ACTIVE = /bg-brand-50/;

// ---------------------------------------------------------------------------
// Mode renders correctly
// ---------------------------------------------------------------------------

test.describe('Open mode renders', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadOpenMode(annotationPage, api);
  });

  test('renders ControlsOpenMode tools and no Submit/Update button', async ({ annotationPage }) => {
    await expect(tool(annotationPage, 'Pan (P)')).toBeVisible();
    await expect(tool(annotationPage, 'Annotate (R)')).toBeVisible();
    await expect(tool(annotationPage, 'Edit (E)')).toBeVisible();
    await expect(tool(annotationPage, 'Probe time series (T)')).toBeVisible();
    await expect(annotationPage.locator('button', { hasText: /^(Submit|Update)$/ })).toHaveCount(0);
  });

  test('does not bulk-load every annotation on open (served as tiles instead)', async ({
    annotationPage,
    api,
  }) => {
    // The whole-campaign GET /annotations is gone; annotations come from
    // viewport vector tiles. Assert the bulk-load call is never made.
    const bulkLoads = api.requests.filter(
      (r) => r.method === 'GET' && r.pathname.endsWith('/annotations')
    );
    expect(bulkLoads).toHaveLength(0);
    await expect(controls(annotationPage)).toBeVisible();
  });

  // No crosshair assertion: the crosshair marks the task point, so Explore
  // (which has no focus point) deliberately turns it off - see loadCampaign's
  // `crosshair: workMode === 'tasks'`.
  test('minimap centre is the bbox centre on load', async ({ annotationPage }) => {
    const c = await getMinimapCenter(annotationPage);
    assertCoordsMatch(c, OPEN_MODE_CENTER, 'initial centre');
  });

  test('default active tool is Pan', async ({ annotationPage }) => {
    await expect(tool(annotationPage, 'Pan (P)')).toHaveClass(ACTIVE);
  });
});

// ---------------------------------------------------------------------------
// Tools & label selection
// ---------------------------------------------------------------------------

test.describe('Tools and label selection', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadOpenMode(annotationPage, api);
  });

  test('P / R / E / T activate the matching tool', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('r');
    await expect(tool(annotationPage, 'Annotate (R)')).toHaveClass(ACTIVE);
    await annotationPage.keyboard.press('e');
    await expect(tool(annotationPage, 'Edit (E)')).toHaveClass(ACTIVE);
    await annotationPage.keyboard.press('t');
    await expect(tool(annotationPage, 'Probe time series (T)')).toHaveClass(ACTIVE);
    await annotationPage.keyboard.press('p');
    await expect(tool(annotationPage, 'Pan (P)')).toHaveClass(ACTIVE);
  });

  test('clicking a tool button activates it', async ({ annotationPage }) => {
    await tool(annotationPage, 'Edit (E)').click();
    await expect(tool(annotationPage, 'Edit (E)')).toHaveClass(ACTIVE);
  });

  test('1 / 2 / 3 select the label, show ✓, and switch to Annotate', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('1');
    await expect(tool(annotationPage, 'Annotate (R)')).toHaveClass(ACTIVE);
    await expect(controls(annotationPage)).toContainText('Selected: Tree');
    await expect(controls(annotationPage)).toContainText('Type: Point');

    await annotationPage.keyboard.press('2');
    await expect(controls(annotationPage)).toContainText('Selected: Field');
    await expect(controls(annotationPage)).toContainText('Type: Polygon');
  });

  test('label rows show the geometry icon per type', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('r'); // reveal label list
    const list = controls(annotationPage);
    await expect(list).toContainText('●'); // point (tree)
    await expect(list).toContainText('▰'); // polygon (field)
    await expect(list).toContainText('━'); // line (road)
  });

  test('Timeseries tool is not offered when the campaign has no time series', async ({
    annotationPage,
    api,
  }) => {
    await loadOpenMode(annotationPage, api, { noTimeseries: true });
    await expect(tool(annotationPage, 'Timeseries (T)')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Creating annotations (position + geometry correctness)
// ---------------------------------------------------------------------------

test.describe('Creating annotations', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadOpenMode(annotationPage, api);
  });

  test('point draw at centre posts a POINT at the viewport centre', async ({
    annotationPage,
    api,
  }) => {
    await annotationPage.keyboard.press('1'); // point label -> annotate
    const center = await getMinimapCenter(annotationPage);

    await Promise.all([waitForCreate(annotationPage), clickMapCenter(annotationPage)]);

    const posts = api.requests.filter(
      (r) => r.method === 'POST' && r.pathname.endsWith('/create-annotation')
    );
    expect(posts).toHaveLength(1);
    const body = posts[0].body;
    expect(body.label_id).toBe(1);
    expect(body.confidence).toBeNull();
    const wkt = parseWkt(body.geometry_wkt);
    expect(wkt.type).toBe('POINT');
    assertCoordsMatch({ lat: wkt.lat, lon: wkt.lon }, center, 'point draw centre');
  });

  test('point draw east of centre posts a POINT with a larger longitude', async ({
    annotationPage,
    api,
  }) => {
    await annotationPage.keyboard.press('1');
    const center = await getMinimapCenter(annotationPage);

    await Promise.all([waitForCreate(annotationPage), clickMapAt(annotationPage, 100, 0)]);

    const body = api.requests.find(
      (r) => r.method === 'POST' && r.pathname.endsWith('/create-annotation')
    )!.body;
    const wkt = parseWkt(body.geometry_wkt);
    expect(wkt.type).toBe('POINT');
    expect(wkt.lon).toBeGreaterThan(center.lon);
  });

  test('polygon draw posts a POLYGON', async ({ annotationPage, api }) => {
    await annotationPage.keyboard.press('2'); // polygon label
    await Promise.all([
      waitForCreate(annotationPage),
      drawPolygon(annotationPage, [
        [-50, -40],
        [50, -40],
        [0, 50],
      ]),
    ]);
    const body = api.requests.find(
      (r) => r.method === 'POST' && r.pathname.endsWith('/create-annotation')
    )!.body;
    expect(parseWkt(body.geometry_wkt).type).toBe('POLYGON');
    expect(body.label_id).toBe(2);
  });

  test('line draw posts a LINESTRING', async ({ annotationPage, api }) => {
    await annotationPage.keyboard.press('3'); // line label
    await Promise.all([
      waitForCreate(annotationPage),
      drawPolygon(annotationPage, [
        [-50, 0],
        [50, 0],
      ]),
    ]);
    const body = api.requests.find(
      (r) => r.method === 'POST' && r.pathname.endsWith('/create-annotation')
    )!.body;
    expect(parseWkt(body.geometry_wkt).type).toBe('LINESTRING');
    expect(body.label_id).toBe(3);
  });

  test('drawing does not change the active imagery', async ({ annotationPage }) => {
    const layerBtn = annotationPage.locator('[data-tour="layer-selector"] button').first();
    const before = await layerBtn.textContent();
    await annotationPage.keyboard.press('1');
    await Promise.all([waitForCreate(annotationPage), clickMapCenter(annotationPage)]);
    await expect(layerBtn).toHaveText(before ?? '');
  });
});

// ---------------------------------------------------------------------------
// Load & display existing annotations
// ---------------------------------------------------------------------------

// NOTE: open-mode annotations now render as MVT vector tiles served by the
// backend, not as features loaded into the client. The describe blocks below
// require selecting an *existing* annotation by clicking its rendered tile,
// which the mocked E2E backend cannot produce (no real tile data). These flows
// are verified end-to-end against a real backend instead; making them run here
// needs a real-backend E2E harness (follow-up). Skipped until then.

// ---------------------------------------------------------------------------
// Editing geometry (PUT)
// ---------------------------------------------------------------------------

test.describe.skip('Editing annotations', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadOpenMode(annotationPage, api);
  });

  test('select centre annotation, move it, save -> PUT with new geometry', async ({
    annotationPage,
    api,
  }) => {
    await annotationPage.keyboard.press('e');
    await clickMapCenter(annotationPage);
    await expect(controls(annotationPage)).toContainText(
      `Selected annotation #${OPEN_ANN_CENTER.id}`
    );

    // Alt+drag translates the whole feature.
    const box = await annotationPage
      .locator('[data-panel-role="main-map"] canvas')
      .first()
      .boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await annotationPage.keyboard.down('Alt');
    await annotationPage.mouse.move(cx, cy);
    await annotationPage.mouse.down();
    await annotationPage.mouse.move(cx + 60, cy + 40, { steps: 8 });
    await annotationPage.mouse.up();
    await annotationPage.keyboard.up('Alt');

    await Promise.all([
      waitForUpdate(annotationPage),
      annotationPage.locator('[title="Confirm edits (Enter)"]').click(),
    ]);

    const put = api.requests.find(
      (r) => r.method === 'PUT' && r.pathname.endsWith(`/annotations/${OPEN_ANN_CENTER.id}/update`)
    );
    expect(put).toBeTruthy();
    expect(put!.body.geometry_wkt).toBeTruthy();
    const moved = parseWkt(put!.body.geometry_wkt);
    const original = parseWkt(OPEN_ANN_CENTER.geometry.geometry);
    expect(Math.abs(moved.lon - original.lon) + Math.abs(moved.lat - original.lat)).toBeGreaterThan(
      0
    );
  });

  test('Esc cancels an edit without a PUT', async ({ annotationPage, api }) => {
    await annotationPage.keyboard.press('e');
    await clickMapCenter(annotationPage);
    await expect(controls(annotationPage)).toContainText('Selected annotation #');

    const box = await annotationPage
      .locator('[data-panel-role="main-map"] canvas')
      .first()
      .boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await annotationPage.keyboard.down('Alt');
    await annotationPage.mouse.move(cx, cy);
    await annotationPage.mouse.down();
    await annotationPage.mouse.move(cx + 60, cy, { steps: 6 });
    await annotationPage.mouse.up();
    await annotationPage.keyboard.up('Alt');

    await annotationPage.keyboard.press('Escape');
    await expect(controls(annotationPage)).not.toContainText('Selected annotation #');
    expect(api.requests.some((r) => r.method === 'PUT')).toBe(false);
  });

  test('clicking empty space clears the selection', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('e');
    await clickMapCenter(annotationPage);
    await expect(controls(annotationPage)).toContainText('Selected annotation #');
    await clickMapAt(annotationPage, 220, 160); // empty area
    await expect(controls(annotationPage)).not.toContainText('Selected annotation #');
  });
});

// ---------------------------------------------------------------------------
// Delete (DELETE)
// ---------------------------------------------------------------------------

test.describe.skip('Deleting annotations', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadOpenMode(annotationPage, api);
  });

  test('select centre annotation and delete -> DELETE, count decrements', async ({
    annotationPage,
    api,
  }) => {
    await annotationPage.keyboard.press('e');
    await clickMapCenter(annotationPage);
    await expect(controls(annotationPage)).toContainText(
      `Selected annotation #${OPEN_ANN_CENTER.id}`
    );

    await Promise.all([
      waitForDelete(annotationPage),
      annotationPage.locator('[title="Delete annotation (Delete)"]').click(),
    ]);

    const del = api.requests.find(
      (r) => r.method === 'DELETE' && r.pathname.endsWith(`/annotations/${OPEN_ANN_CENTER.id}`)
    );
    expect(del).toBeTruthy();
    await expect(controls(annotationPage)).not.toContainText('Selected annotation #');
  });
});

// ---------------------------------------------------------------------------
// Multi-select & delete-key (edit mode)
// ---------------------------------------------------------------------------

const editControls = (page: Page) => page.locator('[data-testid="edit-controls"]');

test.describe.skip('Multi-select and delete key', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadOpenMode(annotationPage, api);
  });

  test('Shift+drag box-selects every annotation and shows the count', async ({
    annotationPage,
  }) => {
    await annotationPage.keyboard.press('e');
    await fitAllAnnotations(annotationPage, OPEN_MODE_CENTER);
    await boxSelectWholeCanvas(annotationPage);
    await expect(editControls(annotationPage)).toHaveAttribute('data-selected-count', '3');
  });

  test('Ctrl+click removes a feature from a box selection', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('e');
    await fitAllAnnotations(annotationPage, OPEN_MODE_CENTER);
    await boxSelectWholeCanvas(annotationPage);
    await expect(editControls(annotationPage)).toHaveAttribute('data-selected-count', '3');

    // The centre annotation (OPEN_ANN_CENTER) toggles out of the selection.
    await ctrlClickMapCenter(annotationPage);
    await expect(editControls(annotationPage)).toHaveAttribute('data-selected-count', '2');
  });

  test('Delete key on a box selection batch-deletes all selected annotations', async ({
    annotationPage,
    api,
  }) => {
    await annotationPage.keyboard.press('e');
    await fitAllAnnotations(annotationPage, OPEN_MODE_CENTER);
    await boxSelectWholeCanvas(annotationPage);
    await expect(editControls(annotationPage)).toHaveAttribute('data-selected-count', '3');

    await Promise.all([
      waitForBatchDelete(annotationPage),
      annotationPage.keyboard.press('Delete'),
    ]);

    const post = api.requests.find(
      (r) => r.method === 'POST' && r.pathname.endsWith('/annotations/batch-delete')
    );
    expect(post).toBeTruthy();
    expect([...(post!.body.annotation_ids as number[])].sort((a, b) => a - b)).toEqual([
      OPEN_ANN_CENTER.id,
      OPEN_ANN_NE_FLAGGED.id,
      OPEN_ANN_SW_POLYGON.id,
    ]);

    // All annotations gone -> the edit controls are removed.
    await expect(editControls(annotationPage)).toHaveCount(0);
  });

  test('Delete key on a single selection issues a single DELETE', async ({
    annotationPage,
    api,
  }) => {
    await annotationPage.keyboard.press('e');
    await clickMapCenter(annotationPage);
    await expect(editControls(annotationPage)).toHaveAttribute('data-selected-count', '1');

    await Promise.all([waitForDelete(annotationPage), annotationPage.keyboard.press('Delete')]);

    const del = api.requests.find(
      (r) => r.method === 'DELETE' && r.pathname.endsWith(`/annotations/${OPEN_ANN_CENTER.id}`)
    );
    expect(del).toBeTruthy();
    expect(api.requests.some((r) => r.pathname.endsWith('/annotations/batch-delete'))).toBe(false);
    await expect(editControls(annotationPage)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Flag for review (PUT)
// ---------------------------------------------------------------------------

test.describe.skip('Flag for review', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadOpenMode(annotationPage, api);
  });

  test('F flags the selected annotation -> PUT flagged_for_review true', async ({
    annotationPage,
    api,
  }) => {
    await annotationPage.keyboard.press('e');
    await clickMapCenter(annotationPage);
    await expect(controls(annotationPage)).toContainText(
      `Selected annotation #${OPEN_ANN_CENTER.id}`
    );
    const checkbox = controls(annotationPage).locator('input[type="checkbox"]');
    await expect(checkbox).not.toBeChecked();

    await Promise.all([waitForUpdate(annotationPage), annotationPage.keyboard.press('f')]);

    const put = api.requests.find(
      (r) => r.method === 'PUT' && r.pathname.endsWith(`/annotations/${OPEN_ANN_CENTER.id}/update`)
    );
    expect(put).toBeTruthy();
    expect(put!.body.flagged_for_review).toBe(true);
    expect(put!.body.geometry_wkt).toBeNull();
    await expect(checkbox).toBeChecked();
  });

  test('a pre-flagged annotation shows checked and can be unflagged', async ({
    annotationPage,
    api,
  }) => {
    // Select the flagged NE annotation by clicking its rendered tile (needs the
    // real-backend harness to produce tile data; see the note above).
    await annotationPage.keyboard.press('e');
    await clickMapCenter(annotationPage);
    await expect(controls(annotationPage)).toContainText(
      `Selected annotation #${OPEN_ANN_NE_FLAGGED.id}`
    );
    const checkbox = controls(annotationPage).locator('input[type="checkbox"]');
    await expect(checkbox).toBeChecked();

    await Promise.all([waitForUpdate(annotationPage), annotationPage.keyboard.press('f')]);
    const put = api.requests.find(
      (r) =>
        r.method === 'PUT' && r.pathname.endsWith(`/annotations/${OPEN_ANN_NE_FLAGGED.id}/update`)
    );
    expect(put!.body.flagged_for_review).toBe(false);
    await expect(checkbox).not.toBeChecked();
  });

  test('flagging via the checkbox also issues a PUT', async ({ annotationPage, api }) => {
    await annotationPage.keyboard.press('e');
    await clickMapCenter(annotationPage);
    const checkbox = controls(annotationPage).locator('input[type="checkbox"]');
    await Promise.all([waitForUpdate(annotationPage), checkbox.check()]);
    const put = api.requests.find(
      (r) => r.method === 'PUT' && r.pathname.endsWith(`/annotations/${OPEN_ANN_CENTER.id}/update`)
    );
    expect(put!.body.flagged_for_review).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Annotations page "View" deep link
// ---------------------------------------------------------------------------

test.describe('Annotations page View deep link', () => {
  test.beforeEach(async ({ annotationPage }) => {
    // The annotations page fetches the plain campaign record; the annotator
    // fixtures only mock /detailed, so the catch-all would serve {}.
    await annotationPage.route('**/api/campaigns/42', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({ json: MOCK_CAMPAIGN });
    });
  });

  test('View on a standalone annotation opens Explore centred on it, even for a tasks campaign', async ({
    annotationPage,
  }) => {
    const page = annotationPage;
    await page.goto('/projects/7/campaigns/42/annotations');
    const row = page
      .getByRole('row')
      .filter({ has: page.getByText(String(OPEN_ANN_NE_FLAGGED.id), { exact: true }) });
    await row.getByRole('button', { name: 'View' }).click();

    // Explore controls, not the task-mode panel (MOCK_CAMPAIGN.mode === 'tasks').
    await expect(tool(page, 'Pan (P)')).toBeVisible({ timeout: 15_000 });
    // Centred on the annotation, not the campaign bbox centre (50.5, 30.5).
    await waitForMinimapCenter(page, { lat: 50.8, lon: 30.8 }, 'view-deep-link');
    // And selected, so its details show in the controls panel.
    await expect(controls(page)).toContainText(`Selected annotation #${OPEN_ANN_NE_FLAGGED.id}`);
    // Re-check after the map has rendered and published its own view: the OL
    // map itself must sit on the annotation, not just the store seed.
    const settled = await getMinimapCenter(page);
    expect(Math.abs(settled.lat - 50.8)).toBeLessThan(0.01);
    expect(Math.abs(settled.lon - 30.8)).toBeLessThan(0.01);
  });

  test('View on a task-bound annotation opens Tasks mode on its task', async ({
    annotationPage,
  }) => {
    const page = annotationPage;
    const taskBound = { ...OPEN_ANN_CENTER, id: 9050, annotation_task_id: TASK_3.id };
    await page.route('**/api/campaigns/*/annotations', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({ json: [taskBound] });
    });

    await page.goto('/projects/7/campaigns/42/annotations');
    await page.getByRole('button', { name: 'View' }).click();

    // Tasks mode, positioned on TASK_3, with the review list visible.
    await expect(page.locator('input[type="number"][title="Press Enter to go"]')).toHaveValue(
      String(TASK_3.annotation_number),
      { timeout: 15_000 }
    );
    await expect(page.getByTestId('review-list')).toBeVisible();
  });
});

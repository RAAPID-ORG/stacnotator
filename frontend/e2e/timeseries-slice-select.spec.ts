import { test, expect, waitForNavIdle } from './fixtures/annotator-fixture';
import {
  MOCK_CAMPAIGN_WITH_TIMESERIES,
  MOCK_TIMESERIES_ENTRY,
  MOCK_TIMESERIES_DATA,
  SLICE_2024_01,
  SLICE_2024_06,
  MOCK_CAMPAIGN_MONTHS,
  MONTHS_TIMESERIES_ENTRY,
  MONTHS_TIMESERIES_DATA,
  COLLECTION_MAR_2022,
  COLLECTION_SEP_2022,
} from './fixtures/mock-data';
import { isTileHost } from './fixtures/imagery-helpers';

type Page = import('@playwright/test').Page;
type ApiCapture = import('./fixtures/annotator-fixture').ApiCapture;

// Tasks-mode campaign with a timeseries (Jan -> Sep 2024 NDVI) and an active
// collection (S2 L2A) holding two slices: Jan 2024 and Jun 2024.
async function loadWithTimeseries(page: Page, api: ApiCapture): Promise<void> {
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    await route.fulfill({ json: MOCK_CAMPAIGN_WITH_TIMESERIES });
  });
  await page.route(`**/api/timeseries/${MOCK_TIMESERIES_ENTRY.id}/**`, async (route) => {
    await route.fulfill({ json: { data: MOCK_TIMESERIES_DATA } });
  });
  await page.reload();
  await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
  await page.waitForSelector('[data-tour="timeseries"]', { timeout: 10_000 });
  await waitForNavIdle(page);
  api.clear();
}

const chartCanvas = (page: Page) => page.locator('[data-tour="timeseries"] canvas');
// The main-map slice dropdown reflects which slice is shown in the main view.
const mainSliceBtn = (page: Page) => page.locator('button[title="Select time slice (a/d)"]');

// Click the chart at a horizontal fraction of its width (0 = earliest dates,
// 1 = latest); out-of-plot x values clamp to the first/last label.
//
// Presses and releases a few px apart on purpose: a real pointer click always
// carries that much jitter, and the chart's drag-zoom must not mistake it for
// a zoom (which would swallow the click). A pixel-perfect canvas.click() would
// hide that regression.
async function clickChartAtFraction(page: Page, fraction: number): Promise<void> {
  const canvas = chartCanvas(page);
  await expect(canvas).toBeVisible({ timeout: 5000 });
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('chart canvas has no bounding box');
  const x = box.x + box.width * fraction;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 4, y + 3);
  await page.mouse.up();
}

function expectTile(page: Page, urlPart: string): Promise<void> {
  return page
    .waitForResponse(
      (r) => isTileHost(r.url()) && r.url().includes(urlPart),
      { timeout: 3000 }
    )
    .then(() => undefined)
    .catch(() => undefined);
}

test.describe('Click timeseries to select nearest slice', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadWithTimeseries(annotationPage, api);
    await expect(chartCanvas(annotationPage)).toBeVisible({ timeout: 5000 });
  });

  test('starts on the Jan 2024 slice (cover slice)', async ({ annotationPage }) => {
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name);
  });

  test('clicking the right side of the chart selects the Jun 2024 slice', async ({
    annotationPage,
  }) => {
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name);

    await clickChartAtFraction(annotationPage, 0.95);

    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, {
      timeout: 3000,
    });
  });

  test('clicking the left side returns to the Jan 2024 slice', async ({ annotationPage }) => {
    await clickChartAtFraction(annotationPage, 0.95);
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, {
      timeout: 3000,
    });

    await clickChartAtFraction(annotationPage, 0.05);
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name, {
      timeout: 3000,
    });
  });

  test('selecting a slice via the chart loads that slice imagery in the main view', async ({
    annotationPage,
  }) => {
    const tileArrived = expectTile(annotationPage, 'search-jun-2024');

    await clickChartAtFraction(annotationPage, 0.95);

    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, {
      timeout: 3000,
    });
    await tileArrived;
  });

  test('clicking near the already-active slice keeps it selected (no-op)', async ({
    annotationPage,
  }) => {
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name);

    await clickChartAtFraction(annotationPage, 0.05);
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name);
  });
});

// ---------------------------------------------------------------------------
// Cross-collection selection: the real-world shape where each collection
// covers one month and the source holds many. A click on a date outside the
// active collection must switch the active collection, not collapse to its
// cover slice. This guards the bug where selection only searched the active
// collection and always landed on slice 0.
// ---------------------------------------------------------------------------

async function loadMonthsCampaign(page: Page, api: ApiCapture): Promise<void> {
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    await route.fulfill({ json: MOCK_CAMPAIGN_MONTHS });
  });
  await page.route(`**/api/timeseries/${MONTHS_TIMESERIES_ENTRY.id}/**`, async (route) => {
    await route.fulfill({ json: { data: MONTHS_TIMESERIES_DATA } });
  });
  await page.reload();
  await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
  await page.waitForSelector('[data-tour="timeseries"]', { timeout: 10_000 });
  await waitForNavIdle(page);
  api.clear();
}

// The header of the window card whose collection is currently active.
const activeWindowTitle = (page: Page) =>
  page.locator('.active-window .card-header').first();

test.describe('Chart click switches active collection (month-per-collection)', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadMonthsCampaign(annotationPage, api);
    await expect(chartCanvas(annotationPage)).toBeVisible({ timeout: 5000 });
  });

  test('starts on the first collection (Mar 2022) cover slice', async ({ annotationPage }) => {
    await expect(activeWindowTitle(annotationPage)).toHaveAttribute(
      'title',
      `Imagery - ${COLLECTION_MAR_2022.name}`
    );
    await expect(mainSliceBtn(annotationPage)).toContainText('Cover');
  });

  test('clicking a late-year date switches the active collection to Sep 2022', async ({
    annotationPage,
  }) => {
    const tileArrived = expectTile(annotationPage, 'sep2022');

    await clickChartAtFraction(annotationPage, 0.95);

    await expect(activeWindowTitle(annotationPage)).toHaveAttribute(
      'title',
      `Imagery - ${COLLECTION_SEP_2022.name}`,
      { timeout: 3000 }
    );
    await tileArrived;
  });

  test('a specific weekly slice is selected, not the month Cover', async ({ annotationPage }) => {
    await clickChartAtFraction(annotationPage, 0.95);

    await expect(activeWindowTitle(annotationPage)).toHaveAttribute(
      'title',
      `Imagery - ${COLLECTION_SEP_2022.name}`,
      { timeout: 3000 }
    );
    // Midpoint matching prefers the narrow weekly slice over the month Cover.
    await expect(mainSliceBtn(annotationPage)).not.toContainText('Cover');
  });

  test('clicking back near spring returns to Mar 2022', async ({ annotationPage }) => {
    await clickChartAtFraction(annotationPage, 0.95);
    await expect(activeWindowTitle(annotationPage)).toHaveAttribute(
      'title',
      `Imagery - ${COLLECTION_SEP_2022.name}`,
      { timeout: 3000 }
    );

    await clickChartAtFraction(annotationPage, 0.18);
    await expect(activeWindowTitle(annotationPage)).toHaveAttribute(
      'title',
      `Imagery - ${COLLECTION_MAR_2022.name}`,
      { timeout: 3000 }
    );
  });
});

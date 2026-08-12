import { test, expect, waitForNavIdle } from './fixtures/annotator-fixture';
import {
  MOCK_CAMPAIGN_WITH_TIMESERIES,
  MOCK_CAMPAIGN_MULTI_SOURCE_WITH_TIMESERIES,
  MOCK_TIMESERIES_ENTRY,
  MOCK_TIMESERIES_DATA,
  COLLECTION_S2,
  COLLECTION_VHR_MULTI,
  SLICE_2024_01,
  SLICE_2024_06,
} from './fixtures/mock-data';

type Page = import('@playwright/test').Page;
type ApiCapture = import('./fixtures/annotator-fixture').ApiCapture;

// Regression spec for the multi-source active-window chart indicator bug: the
// band the chart paints over the active slice is drawn from the shared imagery
// address (collection + slice), so any path that changes what is shown WITHOUT
// going through that address leaves the indicator stale.
//
// The band itself is canvas-drawn and has no DOM node, so the assertions read
// the same address off the two header controls fed by it: the active window
// header (collection) and the main-map slice picker (slice).

const chartCanvas = (page: Page) => page.locator('[data-tour="timeseries"] canvas');
const activeWindowName = (page: Page) => page.locator('[data-window-active="true"]');
const mainSliceBtn = (page: Page) =>
  page.locator('[data-tour="map-controls"] button[title^="Select time slice"]');

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

async function useCampaign(page: Page, api: ApiCapture, campaign: object): Promise<void> {
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    await route.fulfill({ json: campaign });
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

// ---------------------------------------------------------------------------
// Control: single-source chart click still moves the indicator. If this goes
// red, the harness (not the multi-source bug) is at fault.
// ---------------------------------------------------------------------------

test.describe('Control: single-source chart click updates the indicator', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await useCampaign(annotationPage, api, MOCK_CAMPAIGN_WITH_TIMESERIES);
  });

  test('starts on Jan 2024 and moves to Jun 2024 after a right-side click', async ({
    annotationPage,
  }) => {
    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_S2.name);
    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_01.name);

    await clickChartAtFraction(annotationPage, 0.95);

    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, { timeout: 3000 });
    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_S2.name);
  });
});

// ---------------------------------------------------------------------------
// P1/P2/P3 against a two-source campaign: source A (Sentinel-2, collection
// 10) covers Jan/Jun 2024; source B (VHR, collection 40) covers two weekly
// slices in Sep 2024. Source A is the default active window.
// ---------------------------------------------------------------------------

test.describe('Multi-source: active-window indicator', () => {
  const [SEP_WK1, SEP_WK2] = COLLECTION_VHR_MULTI.slices;

  test.beforeEach(async ({ annotationPage, api }) => {
    await useCampaign(annotationPage, api, MOCK_CAMPAIGN_MULTI_SOURCE_WITH_TIMESERIES);
    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_S2.name);
  });

  test('P1: clicking the chart at a date inside source B coverage switches the indicator to source B', async ({
    annotationPage,
  }) => {
    // Sep 23 (fraction ~0.95 of the Jan-Sep series) sits far closer to
    // source B's Sep slices than to source A's Jan/Jun slices - the desired
    // cross-source nearest-slice search should land on collection 40.
    await clickChartAtFraction(annotationPage, 0.95);

    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_VHR_MULTI.name, {
      timeout: 3000,
    });
    await expect(mainSliceBtn(annotationPage)).toContainText(SEP_WK2.name);
  });

  test('P2: changing source B window slice via its slice picker updates the indicator', async ({
    annotationPage,
  }) => {
    const vhrWindow = annotationPage.locator(`[data-panel-id="${COLLECTION_VHR_MULTI.id}"]`);
    await vhrWindow.locator('button[title="Select time slice"]').click();
    await annotationPage
      .locator('div.rounded-lg.shadow-lg button')
      .filter({ hasText: SEP_WK2.name })
      .first()
      .click();

    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_VHR_MULTI.name, {
      timeout: 3000,
    });
    await expect(mainSliceBtn(annotationPage)).toContainText(SEP_WK2.name);
  });

  test('P3: activating source B window via its header click updates the indicator', async ({
    annotationPage,
  }) => {
    await annotationPage
      .locator(`[data-panel-id="${COLLECTION_VHR_MULTI.id}"] .card-header`)
      .click({ position: { x: 4, y: 4 } });

    await expect(activeWindowName(annotationPage)).toHaveText(COLLECTION_VHR_MULTI.name, {
      timeout: 3000,
    });
    // Activation lands on the window's own remembered slice - its cover here.
    await expect(mainSliceBtn(annotationPage)).toContainText(SEP_WK1.name);
  });
});

import { test, expect, waitForNavIdle } from './fixtures/annotator-fixture';
import {
  MOCK_CAMPAIGN_WITH_TIMESERIES,
  MOCK_CAMPAIGN_MULTI_SOURCE_WITH_TIMESERIES,
  MOCK_TIMESERIES_ENTRY,
  MOCK_TIMESERIES_DATA,
  SLICE_2024_01,
  SLICE_2024_06,
} from './fixtures/mock-data';

type Page = import('@playwright/test').Page;
type ApiCapture = import('./fixtures/annotator-fixture').ApiCapture;

// Reproduction spec for the multi-source active-window chart indicator bug:
// the amber band on the timeseries chart is driven by map.store's
// activeCollectionId/activeSliceIndex only, so any path that changes what's
// shown WITHOUT going through those two fields leaves the indicator stale.
//
// Chart container carries data-indicator-* attributes (added purely for test
// observability - the marker itself is canvas-drawn and not otherwise
// assertable). See TimeSeriesChart.tsx.

const chartCanvas = (page: Page) => page.locator('[data-tour="timeseries"] canvas');
const indicator = (page: Page) => page.locator('[data-indicator-collection-id]');

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
    await expect(indicator(annotationPage)).toHaveAttribute(
      'data-indicator-start',
      SLICE_2024_01.start_date
    );

    await clickChartAtFraction(annotationPage, 0.95);

    await expect(indicator(annotationPage)).toHaveAttribute(
      'data-indicator-start',
      SLICE_2024_06.start_date,
      { timeout: 3000 }
    );
    await expect(indicator(annotationPage)).toHaveAttribute(
      'data-indicator-end',
      SLICE_2024_06.end_date
    );
  });
});

// ---------------------------------------------------------------------------
// P1/P2/P3 against a two-source campaign: source A (Sentinel-2, collection
// 10) covers Jan/Jun 2024; source B (VHR, collection 40) covers two weekly
// slices in Sep 2024. Source A is the default active window.
// ---------------------------------------------------------------------------

test.describe('Multi-source: active-window indicator', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await useCampaign(annotationPage, api, MOCK_CAMPAIGN_MULTI_SOURCE_WITH_TIMESERIES);
    await expect(indicator(annotationPage)).toHaveAttribute('data-indicator-collection-id', '10');
  });

  test('P1: clicking the chart at a date inside source B coverage switches the indicator to source B', async ({
    annotationPage,
  }) => {
    // Sep 23 (fraction ~0.95 of the Jan-Sep series) sits far closer to
    // source B's Sep slices than to source A's Jan/Jun slices - the desired
    // cross-source nearest-slice search should land on collection 40.
    await clickChartAtFraction(annotationPage, 0.95);

    await expect(indicator(annotationPage)).toHaveAttribute('data-indicator-collection-id', '40', {
      timeout: 3000,
    });
  });

  test('P2: changing source B window slice via its WindowSliceSelect updates the indicator', async ({
    annotationPage,
  }) => {
    const vhrWindow = annotationPage.locator('[data-window-collection-id="40"]');
    await vhrWindow.locator('button[title="Select time slice"]').click();
    await annotationPage.locator('button', { hasText: 'Sep Wk2' }).click();

    await expect(indicator(annotationPage)).toHaveAttribute('data-indicator-collection-id', '40', {
      timeout: 3000,
    });
    await expect(indicator(annotationPage)).toHaveAttribute('data-indicator-start', '2024-09-08');
  });

  test('P3: activating source B window via its header click updates the indicator', async ({
    annotationPage,
  }) => {
    await annotationPage.locator('[title="VHR - VHR Sept"]').click();

    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      'VHR - VHR Sept',
      { timeout: 3000 }
    );
    await expect(indicator(annotationPage)).toHaveAttribute('data-indicator-collection-id', '40', {
      timeout: 3000,
    });
  });
});

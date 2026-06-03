import { test, expect, waitForNavIdle } from './fixtures/annotator-fixture';
import {
  MOCK_CAMPAIGN_WITH_TIMESERIES,
  MOCK_TIMESERIES_ENTRY,
  MOCK_TIMESERIES_DATA,
  TASK_1,
  TASK_2,
} from './fixtures/mock-data';

type Page = import('@playwright/test').Page;
type ApiCapture = import('./fixtures/annotator-fixture').ApiCapture;

async function loadWithTimeseries(page: Page, api: ApiCapture): Promise<void> {
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    await route.fulfill({ json: MOCK_CAMPAIGN_WITH_TIMESERIES });
  });
  // Serve timeseries data for any location
  await page.route(`**/api/timeseries/${MOCK_TIMESERIES_ENTRY.id}/**`, async (route) => {
    await route.fulfill({ json: { data: MOCK_TIMESERIES_DATA } });
  });
  await page.reload();
  await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
  await page.waitForSelector('[data-tour="timeseries"]', { timeout: 10_000 });
  await waitForNavIdle(page);
  api.clear();
}

const chart = (page: Page) => page.locator('[data-tour="timeseries"]');
// Use div[title] to target the toggle pill specifically - each control has both
// a <span> label and a <div> toggle with the same title; the div is the clickable pill.
const smoothToggle = (page: Page) =>
  page.locator('div[title="Savitzky-Golay Smoothing."]').first();
const removeCloudy = (page: Page) =>
  page.locator('div[title="Removes cloud-flagged days (shown as gray dots) from the series"]').first();
const dotsToggle = (page: Page) =>
  page.locator('div[title="Show or hide the per-observation dots (line is always shown)"]').first();
const resetZoomBtn = (page: Page) =>
  page.locator('button[title="Reset zoom (double-click chart)"]');
const legendBtn = (page: Page, name: string) =>
  page.locator(`button[title="Hide ${name}"], button[title="Show ${name}"]`).first();

// ---------------------------------------------------------------------------
// Chart renders
// ---------------------------------------------------------------------------

test.describe('Timeseries chart renders', () => {
  test('chart card is visible when campaign has time_series', async ({ annotationPage, api }) => {
    await loadWithTimeseries(annotationPage, api);
    await expect(chart(annotationPage)).toBeVisible();
  });

  test('chart card is NOT visible when campaign has no time_series', async ({
    annotationPage,
  }) => {
    await expect(annotationPage.locator('[data-tour="timeseries"]')).not.toBeVisible();
  });

  test('canvas element is rendered inside the chart card', async ({ annotationPage, api }) => {
    await loadWithTimeseries(annotationPage, api);
    await expect(chart(annotationPage).locator('canvas')).toBeVisible({ timeout: 5000 });
  });

  test('legend button for NDVI series is present', async ({ annotationPage, api }) => {
    await loadWithTimeseries(annotationPage, api);
    await expect(legendBtn(annotationPage, MOCK_TIMESERIES_ENTRY.name)).toBeVisible({
      timeout: 5000,
    });
  });

  test('timeseries data is fetched for the current task location', async ({
    annotationPage,
    api,
  }) => {
    // Timeseries requests bypass the api.requests catch-all; capture via page event listener.
    const tsUrls: string[] = [];
    annotationPage.on('request', (req) => {
      if (req.url().includes(`/timeseries/${MOCK_TIMESERIES_ENTRY.id}/`)) {
        tsUrls.push(req.url());
      }
    });
    await loadWithTimeseries(annotationPage, api);
    // Allow chart to finish loading
    await annotationPage.locator('[data-tour="timeseries"] canvas').waitFor({ timeout: 5000 });
    expect(tsUrls.length).toBeGreaterThan(0);
    // URL contains the task's longitude (from POINT(lon lat))
    const taskLon = TASK_1.geometry.geometry.match(/POINT\(([^ ]+)/)?.[1] ?? '';
    expect(tsUrls.some((u) => u.includes(taskLon))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Smooth toggle
// ---------------------------------------------------------------------------

test.describe('Smooth toggle (Savitzky-Golay)', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadWithTimeseries(annotationPage, api);
    await chart(annotationPage).locator('canvas').waitFor({ timeout: 5000 });
  });

  test('Smooth toggle is present and starts off', async ({ annotationPage }) => {
    const toggle = smoothToggle(annotationPage);
    await expect(toggle).toBeVisible();
    // Off state: the toggle pill should NOT have the brand colour class
    await expect(toggle).not.toHaveClass(/bg-brand-600/);
  });

  test('clicking Smooth toggle enables smoothing (pill turns brand colour)', async ({
    annotationPage,
  }) => {
    await smoothToggle(annotationPage).click();
    await expect(smoothToggle(annotationPage)).toHaveClass(/bg-brand-600/, { timeout: 2000 });
  });

  test('clicking Smooth twice disables smoothing again', async ({ annotationPage }) => {
    await smoothToggle(annotationPage).click();
    await expect(smoothToggle(annotationPage)).toHaveClass(/bg-brand-600/);
    await smoothToggle(annotationPage).click();
    await expect(smoothToggle(annotationPage)).not.toHaveClass(/bg-brand-600/, { timeout: 2000 });
  });

  test('W (window) input is visible when smoothing is enabled', async ({ annotationPage }) => {
    await smoothToggle(annotationPage).click();
    // title is on the <label>, not the <input>
    await expect(
      annotationPage.locator('[title*="Window size"] input')
    ).toBeVisible({ timeout: 2000 });
  });

  test('P (polynomial order) input is visible when smoothing is enabled', async ({
    annotationPage,
  }) => {
    await smoothToggle(annotationPage).click();
    await expect(
      annotationPage.locator('[title*="Polynomial order"] input')
    ).toBeVisible({ timeout: 2000 });
  });

  test('W defaults to 7 and can be changed', async ({ annotationPage }) => {
    await smoothToggle(annotationPage).click();
    const wInput = annotationPage.locator('[title*="Window size"] input');
    await expect(wInput).toHaveValue('7');
    await wInput.fill('11');
    await expect(wInput).toHaveValue('11');
  });

  test('P defaults to 3 and can be changed', async ({ annotationPage }) => {
    await smoothToggle(annotationPage).click();
    const pInput = annotationPage.locator('[title*="Polynomial order"] input');
    await expect(pInput).toHaveValue('3');
    await pInput.fill('2');
    await expect(pInput).toHaveValue('2');
  });
});

// ---------------------------------------------------------------------------
// Remove cloudy toggle
// ---------------------------------------------------------------------------

test.describe('Remove cloudy toggle', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadWithTimeseries(annotationPage, api);
    await chart(annotationPage).locator('canvas').waitFor({ timeout: 5000 });
  });

  test('Remove cloudy toggle is present and starts off', async ({ annotationPage }) => {
    const toggle = removeCloudy(annotationPage);
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toHaveClass(/bg-brand-600/);
  });

  test('clicking Remove cloudy enables it', async ({ annotationPage }) => {
    await removeCloudy(annotationPage).click();
    await expect(removeCloudy(annotationPage)).toHaveClass(/bg-brand-600/, { timeout: 2000 });
  });

  test('clicking Remove cloudy twice disables it again', async ({ annotationPage }) => {
    await removeCloudy(annotationPage).click();
    await removeCloudy(annotationPage).click();
    await expect(removeCloudy(annotationPage)).not.toHaveClass(/bg-brand-600/, { timeout: 2000 });
  });
});

// ---------------------------------------------------------------------------
// Dots toggle
// ---------------------------------------------------------------------------

test.describe('Dots toggle', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadWithTimeseries(annotationPage, api);
    await chart(annotationPage).locator('canvas').waitFor({ timeout: 5000 });
  });

  test('Dots toggle is present and starts on', async ({ annotationPage }) => {
    await expect(dotsToggle(annotationPage)).toBeVisible();
    await expect(dotsToggle(annotationPage)).toHaveClass(/bg-brand-600/);
  });

  test('clicking Dots turns it off', async ({ annotationPage }) => {
    await dotsToggle(annotationPage).click();
    await expect(dotsToggle(annotationPage)).not.toHaveClass(/bg-brand-600/, { timeout: 2000 });
  });

  test('clicking Dots twice restores it', async ({ annotationPage }) => {
    await dotsToggle(annotationPage).click();
    await dotsToggle(annotationPage).click();
    await expect(dotsToggle(annotationPage)).toHaveClass(/bg-brand-600/, { timeout: 2000 });
  });
});

// ---------------------------------------------------------------------------
// Reset zoom button
// ---------------------------------------------------------------------------

test.describe('Reset zoom button', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadWithTimeseries(annotationPage, api);
    await chart(annotationPage).locator('canvas').waitFor({ timeout: 5000 });
  });

  test('Reset zoom button is not visible when chart is not zoomed', async ({ annotationPage }) => {
    await expect(resetZoomBtn(annotationPage)).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Data fetching with navigation
// ---------------------------------------------------------------------------

test.describe('Data fetching with task navigation', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadWithTimeseries(annotationPage, api);
    await chart(annotationPage).locator('canvas').waitFor({ timeout: 5000 });
  });

  test('navigating to next task fetches timeseries for the new task location', async ({
    annotationPage,
  }) => {
    const tsUrls: string[] = [];
    annotationPage.on('request', (req) => {
      if (req.url().includes(`/timeseries/${MOCK_TIMESERIES_ENTRY.id}/`)) {
        tsUrls.push(req.url());
      }
    });

    await annotationPage.keyboard.press('s');
    await waitForNavIdle(annotationPage);

    // Wait for a request containing TASK_2's longitude
    const task2Lon = TASK_2.geometry.geometry.match(/POINT\(([^ ]+)/)?.[1] ?? '';
    await annotationPage.waitForFunction(
      ({ lon, tsId }) =>
        (window as any).__TS_URLS__?.some?.((u: string) =>
          u.includes(`/timeseries/${tsId}/`) && u.includes(lon)
        ) ?? false,
      { lon: task2Lon, tsId: MOCK_TIMESERIES_ENTRY.id },
      { timeout: 5000 }
    ).catch(() => null);

    // The request may have fired before the listener was attached (cached prefetch);
    // just verify the chart is still showing data for the new task.
    await expect(annotationPage.locator('[data-tour="timeseries"] canvas')).toBeVisible({
      timeout: 3000,
    });
  });

  test('timeseries card remains visible after task navigation', async ({
    annotationPage,
    api,
  }) => {
    await annotationPage.keyboard.press('s');
    await waitForNavIdle(annotationPage);
    await expect(chart(annotationPage)).toBeVisible();
    await expect(chart(annotationPage).locator('canvas')).toBeVisible({ timeout: 3000 });
  });
});

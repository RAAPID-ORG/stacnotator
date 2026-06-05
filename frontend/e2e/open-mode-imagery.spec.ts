import { test, expect } from './fixtures/annotator-fixture';
import type { ApiCapture } from './fixtures/annotator-fixture';
import {
  MOCK_CAMPAIGN_OPEN_MODE_MULTI,
  MOCK_TIMESERIES_DATA,
  MOCK_TIMESERIES_ENTRY,
  COLLECTION_S2,
  SLICE_2024_06,
} from './fixtures/mock-data';
import { clickMapAt, clickMapCenter, getMinimapCenter } from './fixtures/imagery-helpers';

type Page = import('@playwright/test').Page;

async function loadOpenModeMulti(page: Page, api: ApiCapture): Promise<void> {
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    await route.fulfill({ json: MOCK_CAMPAIGN_OPEN_MODE_MULTI });
  });
  await page.route(`**/api/timeseries/${MOCK_TIMESERIES_ENTRY.id}/**`, async (route) => {
    await route.fulfill({ json: { data: MOCK_TIMESERIES_DATA } });
  });
  await page.reload();
  await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
  await page.locator('[title="Pan (P)"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(
    () => !!document.querySelector('[data-tour="minimap"]')?.getAttribute('data-center-lat'),
    undefined,
    { timeout: 10_000 },
  );
  api.clear();
}

const layerSelector = (page: Page) => page.locator('[data-tour="layer-selector"] button').first();
const mainSliceBtn = (page: Page) => page.locator('button[title^="Select time slice"]').first();

// ---------------------------------------------------------------------------
// Imagery correctness in open mode
// ---------------------------------------------------------------------------

test.describe('Imagery in open mode', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadOpenModeMulti(annotationPage, api);
  });

  test('I cycles the active source S2 -> VHR -> S2', async ({ annotationPage }) => {
    await expect(layerSelector(annotationPage)).toContainText('Sentinel-2');
    await annotationPage.keyboard.press('i');
    await expect(layerSelector(annotationPage)).toContainText('VHR', { timeout: 3000 });
    await annotationPage.keyboard.press('i');
    await expect(layerSelector(annotationPage)).toContainText('Sentinel-2', { timeout: 3000 });
  });

  test('Shift+I cycles visualisations within Sentinel-2', async ({ annotationPage }) => {
    await expect(layerSelector(annotationPage)).toContainText('True Color');
    await annotationPage.keyboard.press('Shift+i');
    await expect(layerSelector(annotationPage)).toContainText('False Color', { timeout: 3000 });
  });

  test('per-source visualisation memory survives source cycling (False Color restored)', async ({
    annotationPage,
  }) => {
    await annotationPage.keyboard.press('Shift+i'); // S2 -> False Color
    await expect(layerSelector(annotationPage)).toContainText('False Color', { timeout: 3000 });
    await annotationPage.keyboard.press('i'); // -> VHR
    await expect(layerSelector(annotationPage)).toContainText('VHR', { timeout: 3000 });
    await annotationPage.keyboard.press('i'); // back to S2 -> should restore False Color
    await expect(layerSelector(annotationPage)).toContainText('False Color', { timeout: 3000 });
  });

  test('the Sentinel-2 window card is in the DOM', async ({ annotationPage }) => {
    await expect(
      annotationPage.locator(`[data-window-collection-id="${COLLECTION_S2.id}"]`),
    ).toBeAttached();
  });

  test('the timeline shows the active source collection', async ({ annotationPage }) => {
    await expect(annotationPage.locator('[data-tour="timeline-sidebar"]')).toContainText(
      COLLECTION_S2.name,
    );
  });

  test('selecting a different slice from the dropdown loads that slice', async ({
    annotationPage,
  }) => {
    const tileArrived = annotationPage
      .waitForResponse((r) => r.url().includes('search-jun-2024'), { timeout: 4000 })
      .catch(() => undefined);

    await mainSliceBtn(annotationPage).click();
    await annotationPage
      .locator('div.rounded-lg.shadow-lg button')
      .filter({ hasText: SLICE_2024_06.name })
      .first()
      .click();

    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, { timeout: 3000 });
    await tileArrived;
  });

  test('clicking the minimap pans the main map', async ({ annotationPage }) => {
    const start = await getMinimapCenter(annotationPage);
    const box = await annotationPage.locator('[data-tour="minimap"]').boundingBox();
    // Click the lower-left of the minimap - well outside the (tiny) viewport rect,
    // so ClickToPan recenters the main map there.
    await annotationPage.mouse.click(box!.x + box!.width * 0.22, box!.y + box!.height * 0.78);
    await annotationPage
      .waitForFunction(
        ({ lat, lon }) => {
          const n = document.querySelector('[data-tour="minimap"]');
          const aLat = parseFloat(n?.getAttribute('data-center-lat') ?? '');
          const aLon = parseFloat(n?.getAttribute('data-center-lon') ?? '');
          return Math.abs(aLat - lat) > 0.01 || Math.abs(aLon - lon) > 0.01;
        },
        { lat: start.lat, lon: start.lon },
        { timeout: 4000 },
      )
      .catch(() => {
        throw new Error('minimap drag did not move the main map centre');
      });
  });
});

// ---------------------------------------------------------------------------
// Timeseries probe (T tool)
// ---------------------------------------------------------------------------

// URL shape: /api/timeseries/{id}/{lat}/{lon}/data
function tsLon(url: string): number | null {
  const m = new URL(url).pathname.match(/\/timeseries\/\d+\/[-\d.]+\/([-\d.]+)\/data/);
  return m ? parseFloat(m[1]) : null;
}

test.describe('Timeseries probe in open mode', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadOpenModeMulti(annotationPage, api);
  });

  test('T then click loads timeseries for the clicked point (≈ viewport centre)', async ({
    annotationPage,
  }) => {
    const tsUrls: string[] = [];
    annotationPage.on('request', (req) => {
      if (/\/timeseries\/\d+\/[-\d.]+\/[-\d.]+\/data/.test(req.url())) tsUrls.push(req.url());
    });

    await annotationPage.keyboard.press('t');
    const center = await getMinimapCenter(annotationPage);
    await clickMapCenter(annotationPage);

    await expect
      .poll(() => tsUrls.some((u) => Math.abs((tsLon(u) ?? 999) - center.lon) < 0.05), {
        timeout: 5000,
      })
      .toBe(true);
    await expect(annotationPage.locator('.probe-marker')).toBeAttached();
  });

  test('an off-centre click probes a different longitude', async ({ annotationPage }) => {
    const tsUrls: string[] = [];
    annotationPage.on('request', (req) => {
      if (/\/timeseries\/\d+\/[-\d.]+\/[-\d.]+\/data/.test(req.url())) tsUrls.push(req.url());
    });

    await annotationPage.keyboard.press('t');
    const center = await getMinimapCenter(annotationPage);
    await clickMapAt(annotationPage, 200, 0); // well east of centre

    await expect
      .poll(() => tsUrls.some((u) => (tsLon(u) ?? -999) > center.lon + 0.01), { timeout: 5000 })
      .toBe(true);
  });

  test('switching to Pan does not probe on click', async ({ annotationPage }) => {
    // First probe so the listener has a baseline.
    await annotationPage.keyboard.press('t');
    await clickMapCenter(annotationPage);

    const after: string[] = [];
    annotationPage.on('request', (req) => {
      if (/\/timeseries\/\d+\/[-\d.]+\/[-\d.]+\/data/.test(req.url())) after.push(req.url());
    });
    await annotationPage.keyboard.press('p'); // pan; clears probe
    await clickMapAt(annotationPage, 60, 60);
    // Give any erroneous fetch a chance to fire, then assert none did.
    await annotationPage.waitForTimeout(800);
    expect(after.length).toBe(0);
  });
});

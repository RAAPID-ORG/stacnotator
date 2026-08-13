import { test, expect } from './fixtures/annotator-fixture';
import type { ApiCapture } from './fixtures/annotator-fixture';
import {
  MOCK_CAMPAIGN_OPEN_MODE_MULTI,
  MOCK_TIMESERIES_DATA,
  MOCK_TIMESERIES_ENTRY,
  COLLECTION_S2,
  COLLECTION_VHR,
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
  await page
    .locator('[data-testid="viewport-center"]')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  api.clear();
}

const layerSelector = (page: Page) => page.locator('[data-tour="layer-selector"] button').first();
const mainSliceBtn = (page: Page) => page.locator('button[title^="Select time slice"]').first();
/** A small imagery window card, addressed by the collection it shows. */
const windowCard = (page: Page, collectionId: number) =>
  page.locator(`[data-panel-id="${collectionId}"]`);

// The map opens on the chronologically first collection of the view that has a
// window, which is VHR (2023) rather than Sentinel-2 (2024) in this fixture.

// ---------------------------------------------------------------------------
// Imagery correctness in open mode
// ---------------------------------------------------------------------------

test.describe('Imagery in open mode', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadOpenModeMulti(annotationPage, api);
  });

  test('I cycles the active source VHR -> S2 -> VHR', async ({ annotationPage }) => {
    await expect(layerSelector(annotationPage)).toContainText('VHR');
    await annotationPage.keyboard.press('i');
    await expect(layerSelector(annotationPage)).toContainText('Sentinel-2', { timeout: 3000 });
    await annotationPage.keyboard.press('i');
    await expect(layerSelector(annotationPage)).toContainText('VHR', { timeout: 3000 });
  });

  test('Shift+I cycles visualisations within Sentinel-2', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('i'); // VHR has one visualisation; S2 has two
    await expect(layerSelector(annotationPage)).toContainText('Sentinel-2', { timeout: 3000 });
    await expect(layerSelector(annotationPage)).toContainText('True Color');
    await annotationPage.keyboard.press('Shift+i');
    await expect(layerSelector(annotationPage)).toContainText('False Color', { timeout: 3000 });
  });

  test('per-source visualisation memory survives source cycling (False Color restored)', async ({
    annotationPage,
  }) => {
    await annotationPage.keyboard.press('i'); // -> S2
    await annotationPage.keyboard.press('Shift+i'); // S2 -> False Color
    await expect(layerSelector(annotationPage)).toContainText('False Color', { timeout: 3000 });
    await annotationPage.keyboard.press('i'); // -> VHR
    await expect(layerSelector(annotationPage)).toContainText('VHR', { timeout: 3000 });
    await annotationPage.keyboard.press('i'); // back to S2 -> should restore False Color
    await expect(layerSelector(annotationPage)).toContainText('False Color', { timeout: 3000 });
  });

  test('the Sentinel-2 window card is in the DOM', async ({ annotationPage }) => {
    await expect(windowCard(annotationPage, COLLECTION_S2.id)).toBeAttached();
  });

  test('the timeline follows the active source', async ({ annotationPage }) => {
    const timeline = annotationPage.locator('[data-tour="timeline-sidebar"]');
    await expect(timeline).toContainText(COLLECTION_VHR.name);
    await annotationPage.keyboard.press('i'); // -> Sentinel-2
    await expect(timeline).toContainText(COLLECTION_S2.name, { timeout: 3000 });
  });

  // A window map must NOT swallow a plain wheel event (otherwise the page can't
  // scroll when the cursor is over it). It SHOULD swallow Ctrl/Cmd+wheel (zoom).
  // We observe this via the real wheel event: a document-level listener reads
  // `defaultPrevented` after OpenLayers' viewport handler has run.
  test('plain wheel over a window is not consumed, but Ctrl+wheel is (zoom)', async ({
    annotationPage,
  }) => {
    const win = windowCard(annotationPage, COLLECTION_S2.id);
    await win.waitFor({ state: 'visible' });
    await win.scrollIntoViewIfNeeded();
    const box = await win.boundingBox();
    if (!box) throw new Error('window has no bounding box');

    await annotationPage.evaluate(() => {
      (window as unknown as { __prevented: boolean[] }).__prevented = [];
      document.addEventListener(
        'wheel',
        (e) =>
          (window as unknown as { __prevented: boolean[] }).__prevented.push(e.defaultPrevented),
        { passive: true }
      );
    });

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await annotationPage.mouse.move(cx, cy);
    await annotationPage.mouse.wheel(0, 300);

    await annotationPage.keyboard.down('Control');
    await annotationPage.mouse.wheel(0, 300);
    await annotationPage.keyboard.up('Control');

    const prevented = await annotationPage.evaluate(
      () => (window as unknown as { __prevented: boolean[] }).__prevented
    );

    expect(prevented.length).toBeGreaterThanOrEqual(2);
    expect(prevented[0]).toBe(false);
    expect(prevented[prevented.length - 1]).toBe(true);
  });

  // Discoverability: scrolling a window without the modifier (the moment the
  // user expects zoom) flashes a hint telling them to hold Ctrl/Cmd.
  test('plain scroll over a window flashes a "hold Ctrl/Cmd to zoom" hint', async ({
    annotationPage,
  }) => {
    const win = windowCard(annotationPage, COLLECTION_S2.id);
    await win.waitFor({ state: 'visible' });
    await win.scrollIntoViewIfNeeded();
    const hint = win.getByText(/Hold Ctrl\/Cmd to zoom/);

    await expect(hint).toHaveCount(0);

    const box = await win.boundingBox();
    if (!box) throw new Error('window has no bounding box');
    await annotationPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await annotationPage.mouse.wheel(0, 200);

    await expect(hint).toBeVisible();
    // A flash, not a permanent badge - it takes itself away again.
    await expect(hint).toHaveCount(0, { timeout: 5000 });
  });

  test('selecting a different slice from the dropdown loads that slice', async ({
    annotationPage,
  }) => {
    const tileArrived = annotationPage
      .waitForResponse((r) => r.url().includes('search-jun-2024'), { timeout: 4000 })
      .catch(() => undefined);

    await mainSliceBtn(annotationPage).click();
    await annotationPage
      .locator('div.rounded-lg.shadow-lg:visible')
      .getByRole('button', { name: SLICE_2024_06.name, exact: true })
      .click();

    await expect(mainSliceBtn(annotationPage)).toContainText(SLICE_2024_06.name, { timeout: 3000 });
    await tileArrived;
  });

  test('dragging the minimap viewport pans the main map only on release', async ({
    annotationPage,
  }) => {
    const start = await getMinimapCenter(annotationPage);
    const body = annotationPage.locator('[data-tour="minimap"] [data-minimap-zoom]');
    await body.scrollIntoViewIfNeeded();
    const box = await body.boundingBox();
    const x = Number(await body.getAttribute('data-viewport-center-x'));
    const y = Number(await body.getAttribute('data-viewport-center-y'));
    if (!box || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('minimap viewport has no rendered centre');
    }
    const center = { x: box.x + x, y: box.y + y };

    await annotationPage.mouse.move(center.x, center.y);
    await annotationPage.mouse.down();
    await expect(body).toHaveClass(/cursor-grabbing/);
    await annotationPage.mouse.move(center.x + 30, center.y + 20, { steps: 6 });
    // Pointer moves update only the rectangle preview.
    expect(await getMinimapCenter(annotationPage)).toEqual(start);
    await annotationPage.mouse.up();

    await expect
      .poll(
        async () => {
          const now = await getMinimapCenter(annotationPage);
          return Math.abs(now.lat - start.lat) > 0.0001 || Math.abs(now.lon - start.lon) > 0.0001;
        },
        { timeout: 4000, message: 'viewport release did not move the main map centre' }
      )
      .toBe(true);
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
    await expect(annotationPage.locator('[data-probe-lon]')).toHaveAttribute(
      'data-probe-lon',
      /-?\d/
    );
    await expect(
      annotationPage.getByRole('button', { name: 'Probe time series', exact: true })
    ).toHaveAttribute('aria-pressed', 'false');
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
      .poll(() => tsUrls.some((u) => Math.abs((tsLon(u) ?? center.lon) - center.lon) > 0.0001), {
        timeout: 5000,
      })
      .toBe(true);
  });

  test('a probe is one-shot; another click requires re-arming', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('t');
    await clickMapCenter(annotationPage);

    const after: string[] = [];
    annotationPage.on('request', (req) => {
      if (/\/timeseries\/\d+\/[-\d.]+\/[-\d.]+\/data/.test(req.url())) after.push(req.url());
    });
    await clickMapAt(annotationPage, 60, 60);
    // Give any erroneous fetch a chance to fire, then assert none did.
    await annotationPage.waitForTimeout(800);
    expect(after.length).toBe(0);
  });
});

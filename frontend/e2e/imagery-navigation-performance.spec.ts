import { test, expect, waitForNavIdle } from './fixtures/annotator-fixture';
import { isTileHost } from './fixtures/imagery-helpers';
import { MOCK_CAMPAIGN, MOCK_TASK_LIST } from './fixtures/mock-data';

const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlJRXRFWHRkYXRl' +
  'OmNyZWF0ZQAyMDI0LTAxLTAxVDAwOjAwOjAwKzAwOjAw5x5CGQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNC0wMS0w' +
  'MVQwMDowMDowMCswMDowMJZD+qUAAAAASUVORK5CYII=';

const COLLECTION_COUNT = 44;
const collections = Array.from({ length: COLLECTION_COUNT }, (_, index) => {
  const id = 1000 + index;
  return {
    source: {
      id,
      name: `Source ${index + 1}`,
      crosshair_hex6: '#ff0000',
      default_zoom: 14,
      visualizations: [{ id, name: 'True Color' }],
      collections: [
        {
          id,
          name: `Collection ${index + 1}`,
          cover_slice_index: 0,
          has_dedicated_cover: true,
          display_order: index,
          stac_config: null,
          slices: [
            {
              id,
              name: 'Cover',
              start_date: '2024-01-01',
              end_date: '2024-12-31',
              display_order: 0,
              tile_urls: [
                {
                  visualization_name: 'True Color',
                  tile_url: `https://tiles.example.com/mosaic/source-${index + 1}/tiles/WebMercatorQuad/{z}/{x}/{y}`,
                },
              ],
            },
          ],
        },
      ],
    },
    collectionId: id,
  };
});

const MANY_PANEL_CAMPAIGN = {
  ...MOCK_CAMPAIGN,
  imagery_sources: collections.map(({ source }) => source),
  imagery_views: [
    {
      id: 1,
      name: 'Many panels',
      display_order: 0,
      source_ids: collections.map(({ source }) => source.id),
      default_canvas_layout: {
        id: 1,
        user_id: null,
        layout_data: collections.map(({ collectionId }, index) => ({
          i: String(collectionId),
          x: (index % 6) * 10,
          y: 40 + Math.floor(index / 6) * 11,
          w: 10,
          h: 11,
        })),
      },
      personal_canvas_layout: null,
    },
  ],
};

test('all visible imagery panels start loading a newly selected task together', async ({
  annotationPage,
}) => {
  const firstRequestAt = new Map<string, number>();
  const firstResponseAt = new Map<string, number>();
  const activeRequests = new Map<string, number>();
  const maxActiveRequests = new Map<string, number>();
  let armed = false;
  let navigationAt = 0;

  // A slow tile server makes serial panel activation visible and deterministic:
  // if panel B waits for panel A to paint, their first requests are separated by
  // at least this delay. Both collections are uncached at task 5's location.
  await annotationPage.route('**/tiles.example.com/**', async (route) => {
    const url = route.request().url();
    if (!isTileHost(url)) return route.fallback();

    const collection = /\/mosaic\/(source-\d+)\//.exec(url)?.[1] ?? null;
    if (armed && collection && !firstRequestAt.has(collection)) {
      firstRequestAt.set(collection, Date.now());
    }
    if (armed && collection) {
      const active = (activeRequests.get(collection) ?? 0) + 1;
      activeRequests.set(collection, active);
      maxActiveRequests.set(collection, Math.max(maxActiveRequests.get(collection) ?? 0, active));
    }

    if (armed) await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(PIXEL, 'base64'),
    });
    if (armed && collection) {
      if (!firstResponseAt.has(collection)) firstResponseAt.set(collection, Date.now());
      activeRequests.set(collection, Math.max(0, (activeRequests.get(collection) ?? 1) - 1));
    }
  });

  // The default pending filter only contains tasks 1 and 2. Make all five
  // visible, so task 5 is outside the three-task look-ahead cache and remains
  // a genuinely cold random jump.
  await annotationPage.route('**/api/campaigns/*/annotation-tasks', async (route) => {
    await route.fulfill({
      json: {
        ...MOCK_TASK_LIST,
        tasks: MOCK_TASK_LIST.tasks.map((task, index) => ({
          ...task,
          task_status: 'pending',
          assignments: task.assignments.map((assignment) => ({
            ...assignment,
            status: 'pending',
          })),
          annotations: [],
          geometry: index === 4 ? { ...task.geometry, geometry: 'POINT(100 0)' } : task.geometry,
        })),
      },
    });
  });
  await annotationPage.route('**/api/campaigns/*/detailed', async (route) => {
    await route.fulfill({ json: MANY_PANEL_CAMPAIGN });
  });
  // Isolate foreground reconciliation from speculative warming. The latter's
  // pause-before-enqueue contract has a tight hook test; mixing it into this
  // network measurement lets it legitimately resume after the main map is
  // idle and makes foreground concurrency impossible to attribute.
  await annotationPage.evaluate(() => {
    const key = 'annotation:prefs';
    const existing = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(
      key,
      JSON.stringify({
        ...existing,
        state: { ...(existing.state || {}), preloadTier: 'off' },
        version: existing.version ?? 0,
      })
    );
  });
  await annotationPage.reload();
  await annotationPage.waitForSelector('[data-tour="controls"]', { timeout: 10_000 });
  await waitForNavIdle(annotationPage);
  armed = true;

  const gotoInput = annotationPage.locator('input[type="number"][title="Press Enter to go"]');
  await gotoInput.fill('5');
  navigationAt = Date.now();
  await gotoInput.press('Enter');
  await waitForNavIdle(annotationPage);
  await expect(annotationPage.locator('[data-map-loading="true"]')).toBeAttached({ timeout: 2000 });

  await expect.poll(() => firstRequestAt.size, { timeout: 15_000 }).toBe(COLLECTION_COUNT);

  await annotationPage.waitForTimeout(450);
  const windowOnlyCounts = [...maxActiveRequests]
    .filter(([source]) => source !== 'source-1')
    .map(([, count]) => count);
  expect(Math.max(...windowOnlyCounts)).toBeLessThanOrEqual(4);

  await expect.poll(() => firstResponseAt.size, { timeout: 3000 }).toBe(COLLECTION_COUNT);
  expect(Math.max(...firstResponseAt.values()) - navigationAt).toBeLessThan(2000);

  const starts = [...firstRequestAt.values()];
  expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(350);
});

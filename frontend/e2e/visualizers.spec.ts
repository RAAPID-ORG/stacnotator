import { expect, type Page } from '@playwright/test';
import { test } from './fixtures/annotator-fixture';
import { MOCK_PROJECT } from './fixtures/mock-data';

const SLUG = 'sh4red-l1nk';

const step = (id: number, start: string, end: string, label: string) => ({
  slice_id: id,
  label,
  start_date: start,
  end_date: end,
  tiles: { 'True Color': { url: `https://tiles.test/${id}/{z}/{x}/{y}.png`, provider: 'mpc' } },
});

const SHARED_VISUALIZER = {
  id: 3,
  slug: SLUG,
  name: 'Maize yield 2024',
  description: 'Predicted maize yield over the season',
  is_public: true,
  project_id: MOCK_PROJECT.id,
  project_name: MOCK_PROJECT.name,
  camera: { lon: 30.5, lat: 50.5, zoom: 8 },
  imagery: [
    {
      source_id: 11,
      campaign_id: 42,
      name: 'Sentinel-2',
      visualizations: ['True Color'],
      default_zoom: 12,
      max_native_zoom: null,
      has_api_key: false,
      steps: [
        step(1, '2024-03-01', '2024-03-31', 'Mar 2024'),
        step(2, '2024-04-01', '2024-04-30', 'Apr 2024'),
        step(3, '2024-05-01', '2024-05-31', 'May 2024'),
      ],
    },
  ],
  overlays: [
    {
      kind: 'raster',
      id: 21,
      name: 'Yield prediction',
      visible: true,
      opacity: 0.8,
      campaign_id: 42,
      tile_url: 'https://tiler.test/searches/abc/tiles/WebMercatorQuad/{z}/{x}/{y}.png',
      render_config: { mode: 'continuous', colormap_name: 'viridis', rescale: [0, 10] },
      max_native_zoom: null,
      status: 'ready',
      mlops_url: null,
    },
  ],
  can_edit: false,
};

// 1x1 transparent PNG, so tile requests resolve instead of retrying.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const mockViewer = async (page: Page) => {
  await page.route('**/tiles.test/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PIXEL })
  );
  await page.route('**/tiler.test/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PIXEL })
  );
  await page.route('**/basemaps.cartocdn.com/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PIXEL })
  );
  await page.route(`**/api/shared-visualizers/${SLUG}/tiler-token`, (route) =>
    route.fulfill({ json: { expires_in: 3600 } })
  );
  await page.route(`**/api/shared-visualizers/${SLUG}`, (route) =>
    route.fulfill({ json: SHARED_VISUALIZER })
  );
};

test.describe('Shared visualizer', () => {
  // The viewer mounts above the app shell and the login gate (see main.tsx),
  // so it renders on its own: no sidebar, no breadcrumbs, nothing but the map.
  test('opens on its own chrome and browses the dates and the overlays', async ({
    appPage: page,
  }) => {
    await mockViewer(page);

    await page.goto(`/v/${SLUG}`);

    await expect(page.getByTestId('sidebar-project-nav')).toHaveCount(0);

    await expect(page.getByRole('heading', { name: SHARED_VISUALIZER.name })).toBeVisible();
    await expect(page.getByTestId('visualizer-sidebar')).toContainText('Sentinel-2');

    // Opens on the newest date.
    const label = page.getByTestId('visualizer-step-label');
    await expect(label).toHaveText('May 2024');

    await page.getByTestId('visualizer-time-slider').getByLabel('Previous date').click();
    await expect(label).toHaveText('Apr 2024');

    await page.keyboard.press('ArrowLeft');
    await expect(label).toHaveText('Mar 2024');
    await expect(
      page.getByTestId('visualizer-time-slider').getByLabel('Previous date')
    ).toBeDisabled();

    // The overlay opens visible, with its colour scale reachable.
    const overlay = page.getByTestId('visualizer-overlay');
    await expect(overlay).toContainText('Yield prediction');
    await expect(overlay.getByTestId('custom-map-legend-max')).toHaveValue('10');
    await overlay.getByRole('checkbox').uncheck();
    await expect(overlay.getByTestId('custom-map-legend-max')).toHaveCount(0);
  });

  test('a visualizer the server will not serve says so instead of hanging', async ({
    appPage: page,
  }) => {
    await page.route(`**/api/shared-visualizers/${SLUG}`, (route) =>
      route.fulfill({ status: 404, json: { detail: 'Visualizer not found' } })
    );

    await page.goto(`/v/${SLUG}`);

    await expect(page.getByText('This visualizer is not available.')).toBeVisible();
  });
});

test.describe('Project visualizers tab', () => {
  test('lists the project visualizers with their share links', async ({ appPage }) => {
    await appPage.route(`**/api/projects/${MOCK_PROJECT.id}/visualizers`, (route) =>
      route.fulfill({
        json: [
          {
            id: 3,
            slug: SLUG,
            name: 'Maize yield 2024',
            description: null,
            is_public: true,
            imagery_count: 1,
            overlay_count: 1,
          },
        ],
      })
    );

    await appPage.goto(`/projects/${MOCK_PROJECT.id}?tab=visualizers`);

    const row = appPage.getByTestId('visualizer-row');
    await expect(row).toContainText('Maize yield 2024');
    await expect(row).toContainText('Public');
    await expect(row.getByRole('link', { name: 'Maize yield 2024' })).toHaveAttribute(
      'href',
      `/v/${SLUG}`
    );
  });
});

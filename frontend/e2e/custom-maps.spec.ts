import { test, expect } from './fixtures/annotator-fixture';
import type { Page } from '@playwright/test';
import { MOCK_CAMPAIGN } from './fixtures/mock-data';

const READY_MAP = {
  id: 1,
  campaign_id: MOCK_CAMPAIGN.id,
  name: 'Test Map',
  cog_url: 'https://example.com/pred.tif',
  render_config: { mode: 'continuous', band: 1, colormap_name: 'viridis', rescale: [0, 1] },
  max_native_zoom: null,
  status: 'ready',
  status_error: null,
  tile_url: 'https://tiles.example.com/custom/{z}/{x}/{y}.png',
  mosaic_id: 'search-1',
  display_order: 0,
};

const CAMPAIGN_WITH_MAP = { ...MOCK_CAMPAIGN, custom_maps: [READY_MAP] };

async function reloadWithCustomMap(page: Page): Promise<void> {
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: CAMPAIGN_WITH_MAP });
  });
  await page.reload();
  await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
  await page.waitForSelector('[data-tour="controls"]', { timeout: 10_000 });
}

test.describe('custom map overlay', () => {
  test('select map, then toggle overlay visibility and adjust opacity', async ({ annotationPage }) => {
    await reloadWithCustomMap(annotationPage);

    const controls = annotationPage.getByTestId('custom-map-controls');
    await expect(controls).toBeVisible();

    await annotationPage.locator('button[title="Select overlay map"]').click();
    await annotationPage
      .locator('div.rounded-lg.shadow-lg button')
      .filter({ hasText: 'Test Map' })
      .first()
      .click();

    const toggle = annotationPage.getByTestId('custom-map-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    const opacity = annotationPage.getByTestId('custom-map-opacity');
    await opacity.fill('40');
    await expect(opacity).toHaveValue('40');
  });
});

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

const READY_MAP_2 = {
  id: 2,
  campaign_id: MOCK_CAMPAIGN.id,
  name: 'Test Map 2',
  cog_url: 'https://example.com/pred2.tif',
  render_config: { mode: 'continuous', band: 1, colormap_name: 'viridis', rescale: [0, 1] },
  max_native_zoom: null,
  status: 'ready',
  status_error: null,
  tile_url: 'https://tiles.example.com/custom2/{z}/{x}/{y}.png',
  mosaic_id: 'search-2',
  display_order: 1,
};

const CAMPAIGN_WITH_MAP = { ...MOCK_CAMPAIGN, custom_maps: [READY_MAP, READY_MAP_2] };

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
  test('select map, then toggle overlay visibility and adjust opacity', async ({
    annotationPage,
  }) => {
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

    await expect(annotationPage.getByTestId('custom-map-legend')).toBeVisible();

    // The opacity slider lives inside the legend panel.
    const opacity = annotationPage.getByTestId('custom-map-opacity');
    await opacity.fill('40');
    await expect(opacity).toHaveValue('40');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // Hiding the overlay hides the legend and its opacity slider with it.
    await expect(annotationPage.getByTestId('custom-map-legend')).toBeHidden();
    await expect(opacity).toBeHidden();
  });

  test('shift+m cycles to the next map; m hides then re-enters the same map', async ({
    annotationPage,
  }) => {
    await reloadWithCustomMap(annotationPage);

    const selectTrigger = annotationPage.locator('button[title="Select overlay map"]');
    await selectTrigger.click();
    await annotationPage
      .locator('div.rounded-lg.shadow-lg button')
      .filter({ hasText: 'Test Map' })
      .first()
      .click();

    const legend = annotationPage.getByTestId('custom-map-legend');
    await expect(legend).toBeVisible();

    await annotationPage.locator('body').click();
    await annotationPage.keyboard.press('Shift+M');
    await expect(selectTrigger).toContainText('Test Map 2');
    await expect(legend).toBeVisible();

    await annotationPage.keyboard.press('m');
    await expect(legend).toBeHidden();

    await annotationPage.keyboard.press('m');
    await expect(legend).toBeVisible();
    await expect(selectTrigger).toContainText('Test Map 2');
  });
});

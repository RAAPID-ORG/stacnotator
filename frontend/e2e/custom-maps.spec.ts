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
  mlops_url: 'https://mlflow.example.com/#/experiments/7/runs/abc',
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
  mlops_url: null,
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

async function selectFirstMap(page: Page): Promise<void> {
  await page.locator('button[title="Select overlay map"]').click();
  await page
    .locator('div.rounded-lg.shadow-lg button')
    .filter({ hasText: 'Test Map' })
    .first()
    .click();
}

test.describe('custom map overlay', () => {
  test('select map, then toggle overlay visibility and adjust opacity', async ({
    annotationPage,
  }) => {
    await reloadWithCustomMap(annotationPage);

    const controls = annotationPage.getByTestId('custom-map-controls');
    await expect(controls).toBeVisible();

    await selectFirstMap(annotationPage);

    const toggle = annotationPage.getByTestId('custom-map-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    // The experiment link icon points at the map's mlops_url.
    const mlopsLink = annotationPage.getByTestId('custom-map-mlops-link');
    await expect(mlopsLink).toBeVisible();
    await expect(mlopsLink).toHaveAttribute('href', READY_MAP.mlops_url);

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

  test('legend recolours the overlay locally and resets back to the campaign default', async ({
    annotationPage,
  }) => {
    await reloadWithCustomMap(annotationPage);
    await selectFirstMap(annotationPage);

    const legend = annotationPage.getByTestId('custom-map-legend');
    await expect(legend).toBeVisible();
    await expect(legend).toHaveAttribute('data-customized', 'false');

    // The legend is the editor: the colourbar is itself the colormap control, no mode to enter.
    const colormap = annotationPage.getByTestId('custom-map-legend-colormap');
    await expect(colormap).toHaveValue(READY_MAP.render_config.colormap_name);

    await colormap.selectOption('magma');
    await expect(legend).toHaveAttribute('data-customized', 'true');

    // The override outlives the session: it is a per-device preference, not view state.
    await reloadWithCustomMap(annotationPage);
    await selectFirstMap(annotationPage);
    await expect(legend).toHaveAttribute('data-customized', 'true');
    await expect(annotationPage.getByTestId('custom-map-legend-colormap')).toHaveValue('magma');

    await annotationPage.getByTestId('custom-map-legend-reset').click();
    await expect(legend).toHaveAttribute('data-customized', 'false');
    await expect(annotationPage.getByTestId('custom-map-legend-colormap')).toHaveValue(
      READY_MAP.render_config.colormap_name
    );
  });

  test('shift+o cycles to the next map; o hides then re-enters the same map', async ({
    annotationPage,
  }) => {
    await reloadWithCustomMap(annotationPage);

    const selectTrigger = annotationPage.locator('button[title="Select overlay map"]');
    await selectFirstMap(annotationPage);

    const legend = annotationPage.getByTestId('custom-map-legend');
    await expect(legend).toBeVisible();

    await annotationPage.locator('body').click();
    await annotationPage.keyboard.press('Shift+O');
    await expect(selectTrigger).toContainText('Test Map 2');
    await expect(legend).toBeVisible();

    // Test Map 2 has no mlops_url, so no link icon is rendered for it.
    await expect(annotationPage.getByTestId('custom-map-mlops-link')).toBeHidden();

    await annotationPage.keyboard.press('o');
    await expect(legend).toBeHidden();

    await annotationPage.keyboard.press('o');
    await expect(legend).toBeVisible();
    await expect(selectTrigger).toContainText('Test Map 2');
  });
});

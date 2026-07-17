import { test, expect, waitForNavIdle } from './fixtures/annotator-fixture';
import { MOCK_CAMPAIGN_MULTI_SOURCE } from './fixtures/mock-data';
import { isTileHost } from './fixtures/imagery-helpers';

type Page = import('@playwright/test').Page;
type ApiCapture = import('./fixtures/annotator-fixture').ApiCapture;

async function useCampaign(page: Page, api: ApiCapture, campaign: object): Promise<void> {
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    await route.fulfill({ json: campaign });
  });
  await page.reload();
  await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
  await page.waitForSelector('[data-tour="controls"]', { timeout: 10_000 });
  await page
    .locator('button', { hasText: /^(Submit|Update)$/ })
    .first()
    .waitFor({ state: 'visible', timeout: 5000 });
  await waitForNavIdle(page);
  api.clear();
}

async function openLayerDropdown(page: Page): Promise<void> {
  await page.locator('[data-tour="layer-selector"] button').click();
  await page.locator('input[name="layer"]').first().waitFor({ state: 'visible' });
}

// nth > 0 disambiguates when multiple sources share a viz name (e.g. both S2 and VHR have "True Color").
async function selectDropdownOption(page: Page, text: string, nth = 0): Promise<void> {
  await page
    .locator('label')
    .filter({ has: page.locator('input[name="layer"]') })
    .filter({ hasText: text })
    .nth(nth)
    .click();
}

test.describe('Visualization cycling within one source', () => {
  test('Shift+I: True Color → False Color', async ({ annotationPage }) => {
    const layerBtn = annotationPage.locator('[data-tour="layer-selector"] button');
    await expect(layerBtn).toContainText('True Color');

    await annotationPage.keyboard.press('Shift+i');

    await expect(layerBtn).toContainText('False Color', { timeout: 3000 });
    await expect(layerBtn).not.toContainText('True Color');
  });

  test('Shift+I twice: False Color wraps back to True Color', async ({ annotationPage }) => {
    const layerBtn = annotationPage.locator('[data-tour="layer-selector"] button');

    await annotationPage.keyboard.press('Shift+i');
    await expect(layerBtn).toContainText('False Color', { timeout: 3000 });

    await annotationPage.keyboard.press('Shift+i');
    await expect(layerBtn).toContainText('True Color', { timeout: 3000 });
    await expect(layerBtn).not.toContainText('False Color');
  });

  test('Shift+I fetches false-color tiles for the active source', async ({ annotationPage }) => {
    const layerBtn = annotationPage.locator('[data-tour="layer-selector"] button');
    // False-color tiles were never loaded at startup, so switching to them MUST
    // fire a request (no cache to serve it). This makes the network assertion
    // deterministic, unlike the cache-served "switch back" direction.
    const falseColorTile = annotationPage.waitForResponse(
      (r) => isTileHost(r.url()) && r.url().includes('viz=falsecolor'),
      { timeout: 5000 }
    );

    await annotationPage.keyboard.press('Shift+i');
    await expect(layerBtn).toContainText('False Color', { timeout: 3000 });
    await falseColorTile;
  });

  test('Shift+I back returns the active visualization to True Color', async ({
    annotationPage,
  }) => {
    const layerBtn = annotationPage.locator('[data-tour="layer-selector"] button');
    await annotationPage.keyboard.press('Shift+i');
    await expect(layerBtn).toContainText('False Color', { timeout: 3000 });

    await annotationPage.keyboard.press('Shift+i');
    await expect(layerBtn).toContainText('True Color', { timeout: 3000 });
  });

  test('dropdown: clicking False Color activates it', async ({ annotationPage }) => {
    await openLayerDropdown(annotationPage);
    await selectDropdownOption(annotationPage, 'False Color');

    await expect(annotationPage.locator('[data-tour="layer-selector"] button')).toContainText(
      'False Color',
      { timeout: 3000 }
    );
  });

  test('dropdown: clicking True Color from False Color deactivates false color', async ({
    annotationPage,
  }) => {
    await annotationPage.keyboard.press('Shift+i');
    await expect(annotationPage.locator('[data-tour="layer-selector"] button')).toContainText(
      'False Color',
      { timeout: 3000 }
    );

    await openLayerDropdown(annotationPage);
    await selectDropdownOption(annotationPage, 'True Color');

    const layerBtn = annotationPage.locator('[data-tour="layer-selector"] button');
    await expect(layerBtn).toContainText('True Color', { timeout: 3000 });
    await expect(layerBtn).not.toContainText('False Color');
  });

  test('dropdown: selected radio is checked for the active visualization', async ({
    annotationPage,
  }) => {
    await openLayerDropdown(annotationPage);
    await selectDropdownOption(annotationPage, 'False Color');

    await openLayerDropdown(annotationPage);
    const falseColorRadio = annotationPage
      .locator('label')
      .filter({ has: annotationPage.locator('input[name="layer"]') })
      .filter({ hasText: 'False Color' })
      .locator('input[name="layer"]');
    await expect(falseColorRadio).toBeChecked();

    const trueColorRadio = annotationPage
      .locator('label')
      .filter({ has: annotationPage.locator('input[name="layer"]') })
      .filter({ hasText: 'True Color' })
      .locator('input[name="layer"]');
    await expect(trueColorRadio).not.toBeChecked();
  });
});

test.describe('Source cycling across two sources', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await useCampaign(annotationPage, api, MOCK_CAMPAIGN_MULTI_SOURCE);
  });

  test('I: layer selector switches from Sentinel-2 to VHR', async ({ annotationPage }) => {
    await expect(annotationPage.locator('[data-tour="layer-selector"] button')).toContainText(
      'Sentinel-2'
    );

    await annotationPage.keyboard.press('i');

    await expect(annotationPage.locator('[data-tour="layer-selector"] button')).toContainText(
      'VHR',
      { timeout: 3000 }
    );
  });

  test('I twice: VHR cycles back to Sentinel-2', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('i');
    await expect(annotationPage.locator('[data-tour="layer-selector"] button')).toContainText(
      'VHR',
      { timeout: 3000 }
    );

    await annotationPage.keyboard.press('i');
    await expect(annotationPage.locator('[data-tour="layer-selector"] button')).toContainText(
      'Sentinel-2',
      { timeout: 3000 }
    );
  });

  test('I: active small window switches to VHR window', async ({ annotationPage }) => {
    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      'Sentinel-2 - Sentinel-2 L2A'
    );

    await annotationPage.keyboard.press('i');

    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      'VHR - VHR Image',
      { timeout: 3000 }
    );
  });

  test('I twice: active small window returns to S2', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('i');
    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      'VHR - VHR Image',
      { timeout: 3000 }
    );

    await annotationPage.keyboard.press('i');
    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      'Sentinel-2 - Sentinel-2 L2A',
      { timeout: 3000 }
    );
  });

  test('I switches the active layer to the VHR source', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('i');
    await expect(annotationPage.locator('[data-tour="layer-selector"] button')).toContainText(
      'VHR',
      { timeout: 3000 }
    );
  });

  test('I twice returns the active layer to the Sentinel-2 source', async ({ annotationPage }) => {
    const layerBtn = annotationPage.locator('[data-tour="layer-selector"] button');
    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('VHR', { timeout: 3000 });

    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('Sentinel-2', { timeout: 3000 });
  });

  test('I: timeline sidebar updates to show VHR collection', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('i');
    await expect(annotationPage.locator('[data-tour="layer-selector"] button')).toContainText(
      'VHR',
      { timeout: 3000 }
    );

    await expect(annotationPage.locator('[data-tour="timeline-sidebar"]')).toContainText(
      'VHR Image',
      { timeout: 3000 }
    );
  });

  test('I back: timeline sidebar returns to S2 collections', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('i');
    await annotationPage.keyboard.press('i');
    await expect(annotationPage.locator('[data-tour="layer-selector"] button')).toContainText(
      'Sentinel-2',
      { timeout: 3000 }
    );

    await expect(annotationPage.locator('[data-tour="timeline-sidebar"]')).toContainText(
      'Sentinel-2 L2A',
      { timeout: 3000 }
    );
  });

  test('dropdown: selecting VHR True Color switches source', async ({ annotationPage }) => {
    await openLayerDropdown(annotationPage);
    // The dropdown has two "True Color" labels: S2 (nth 0) and VHR (nth 1)
    await selectDropdownOption(annotationPage, 'True Color', 1);

    const layerBtn = annotationPage.locator('[data-tour="layer-selector"] button');
    await expect(layerBtn).toContainText('VHR', { timeout: 3000 });
    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      'VHR - VHR Image',
      { timeout: 3000 }
    );
  });

  test('dropdown: selecting S2 False Color from VHR switches source and viz', async ({
    annotationPage,
  }) => {
    // Start by switching to VHR via keyboard
    await annotationPage.keyboard.press('i');
    await expect(annotationPage.locator('[data-tour="layer-selector"] button')).toContainText(
      'VHR',
      { timeout: 3000 }
    );

    // Use dropdown to pick S2 False Color (the only "False Color" option)
    await openLayerDropdown(annotationPage);
    await selectDropdownOption(annotationPage, 'False Color');

    const layerBtn = annotationPage.locator('[data-tour="layer-selector"] button');
    await expect(layerBtn).toContainText('Sentinel-2', { timeout: 3000 });
    await expect(layerBtn).toContainText('False Color', { timeout: 3000 });
    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      'Sentinel-2 - Sentinel-2 L2A',
      { timeout: 3000 }
    );
  });

  test('dropdown: VHR radio is checked after selecting it', async ({ annotationPage }) => {
    await openLayerDropdown(annotationPage);
    await selectDropdownOption(annotationPage, 'True Color', 1); // select VHR

    await openLayerDropdown(annotationPage);
    // VHR True Color is the second "True Color" radio (nth 1)
    const vhrRadio = annotationPage
      .locator('label')
      .filter({ has: annotationPage.locator('input[name="layer"]') })
      .filter({ hasText: 'True Color' })
      .nth(1)
      .locator('input[name="layer"]');
    await expect(vhrRadio).toBeChecked();
  });

  test('clicking a small window header directly switches active source', async ({
    annotationPage,
  }) => {
    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      'Sentinel-2 - Sentinel-2 L2A'
    );

    await annotationPage.locator('[title="VHR - VHR Image"]').click();

    await expect(annotationPage.locator('.active-window .card-header')).toHaveAttribute(
      'title',
      'VHR - VHR Image',
      { timeout: 3000 }
    );
    await expect(annotationPage.locator('[data-tour="layer-selector"] button')).toContainText(
      'VHR',
      { timeout: 3000 }
    );
  });
});

test.describe('Visualization preserved after source detour', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await useCampaign(annotationPage, api, MOCK_CAMPAIGN_MULTI_SOURCE);
  });

  test('S2 false color → VHR → back restores false color (hotkeys)', async ({ annotationPage }) => {
    const layerBtn = annotationPage.locator('[data-tour="layer-selector"] button');

    await annotationPage.keyboard.press('Shift+i');
    await expect(layerBtn).toContainText('False Color', { timeout: 3000 });

    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('VHR', { timeout: 3000 });

    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('Sentinel-2', { timeout: 3000 });
    await expect(layerBtn).toContainText('False Color', { timeout: 3000 });
  });

  test('S2 false color → VHR via dropdown → back restores false color', async ({
    annotationPage,
  }) => {
    const layerBtn = annotationPage.locator('[data-tour="layer-selector"] button');

    await annotationPage.keyboard.press('Shift+i');
    await expect(layerBtn).toContainText('False Color', { timeout: 3000 });

    await openLayerDropdown(annotationPage);
    await selectDropdownOption(annotationPage, 'True Color', 1); // nth(1) = VHR's True Color
    await expect(layerBtn).toContainText('VHR', { timeout: 3000 });

    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('Sentinel-2', { timeout: 3000 });
    await expect(layerBtn).toContainText('False Color', { timeout: 3000 });
  });

  test('multiple round-trips each preserve the last viz set', async ({ annotationPage }) => {
    const layerBtn = annotationPage.locator('[data-tour="layer-selector"] button');

    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('VHR', { timeout: 3000 });
    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('True Color', { timeout: 3000 });
    await expect(layerBtn).not.toContainText('False Color');

    await annotationPage.keyboard.press('Shift+i');
    await expect(layerBtn).toContainText('False Color', { timeout: 3000 });

    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('VHR', { timeout: 3000 });
    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('False Color', { timeout: 3000 });
  });
});

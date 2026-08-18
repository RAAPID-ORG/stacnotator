import { test, expect, waitForNavIdle } from './fixtures/annotator-fixture';
import { COLLECTION_S2, COLLECTION_VHR, MOCK_CAMPAIGN_MULTI_SOURCE } from './fixtures/mock-data';
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

const layerButton = (page: Page) => page.locator('[data-tour="layer-selector"] button');

// HeaderSelect portals its option list into document.body; the options are
// plain buttons carrying the option label.
const headerMenu = (page: Page) => page.locator('body > div.fixed.shadow-lg');

const layerOption = (page: Page, label: string) =>
  headerMenu(page).getByRole('button', { name: label, exact: true });

async function openLayerDropdown(page: Page): Promise<void> {
  await layerButton(page).click();
  await headerMenu(page).waitFor({ state: 'visible' });
}

async function selectLayerOption(page: Page, label: string): Promise<void> {
  await openLayerDropdown(page);
  await layerOption(page, label).click();
}

/** A small imagery window's title, which carries whether its collection is the
 *  active one. */
const windowTitle = (page: Page, collectionId: number) =>
  page.locator(`[data-panel-id="${collectionId}"] .card-header [data-window-active]`);

async function expectActiveWindow(page: Page, activeId: number, otherId: number): Promise<void> {
  await expect(windowTitle(page, activeId)).toHaveAttribute('data-window-active', 'true', {
    timeout: 3000,
  });
  await expect(windowTitle(page, otherId)).toHaveAttribute('data-window-active', 'false');
}

test.describe('Visualization cycling within one source', () => {
  test('Shift+I: True Color → False Color', async ({ annotationPage }) => {
    const layerBtn = layerButton(annotationPage);
    await expect(layerBtn).toContainText('True Color');

    await annotationPage.keyboard.press('Shift+i');

    await expect(layerBtn).toContainText('False Color', { timeout: 3000 });
    await expect(layerBtn).not.toContainText('True Color');
  });

  test('Shift+I twice: False Color wraps back to True Color', async ({ annotationPage }) => {
    const layerBtn = layerButton(annotationPage);

    await annotationPage.keyboard.press('Shift+i');
    await expect(layerBtn).toContainText('False Color', { timeout: 3000 });

    await annotationPage.keyboard.press('Shift+i');
    await expect(layerBtn).toContainText('True Color', { timeout: 3000 });
    await expect(layerBtn).not.toContainText('False Color');
  });

  test('Shift+I fetches false-color tiles for the active source', async ({ annotationPage }) => {
    const layerBtn = layerButton(annotationPage);
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
    const layerBtn = layerButton(annotationPage);
    await annotationPage.keyboard.press('Shift+i');
    await expect(layerBtn).toContainText('False Color', { timeout: 3000 });

    await annotationPage.keyboard.press('Shift+i');
    await expect(layerBtn).toContainText('True Color', { timeout: 3000 });
  });

  test('dropdown: clicking False Color activates it', async ({ annotationPage }) => {
    await selectLayerOption(annotationPage, 'False Color');

    await expect(layerButton(annotationPage)).toContainText('False Color', { timeout: 3000 });
  });

  test('dropdown: clicking True Color from False Color deactivates false color', async ({
    annotationPage,
  }) => {
    await annotationPage.keyboard.press('Shift+i');
    await expect(layerButton(annotationPage)).toContainText('False Color', { timeout: 3000 });

    await selectLayerOption(annotationPage, 'True Color');

    const layerBtn = layerButton(annotationPage);
    await expect(layerBtn).toContainText('True Color', { timeout: 3000 });
    await expect(layerBtn).not.toContainText('False Color');
  });

  test('dropdown: the active visualization is the selected option', async ({ annotationPage }) => {
    await selectLayerOption(annotationPage, 'False Color');
    await expect(layerButton(annotationPage)).toContainText('False Color', { timeout: 3000 });

    await openLayerDropdown(annotationPage);
    // HeaderSelect marks the selected option by styling alone - it exposes no
    // aria-checked/role=option - so the brand text colour is the only DOM
    // signal of which option is active.
    await expect(layerOption(annotationPage, 'False Color')).toHaveClass(/text-brand-700/);
    await expect(layerOption(annotationPage, 'True Color')).not.toHaveClass(/text-brand-700/);
  });
});

// The initially active collection is the chronologically-first one that has a
// window in the layout. VHR's collection starts 2023-01-01 and Sentinel-2's
// 2024-01-01, so this campaign opens on VHR and `i` cycles S2 <-> VHR from there.
test.describe('Source cycling across two sources', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await useCampaign(annotationPage, api, MOCK_CAMPAIGN_MULTI_SOURCE);
  });

  test('I: layer selector switches from VHR to Sentinel-2', async ({ annotationPage }) => {
    await expect(layerButton(annotationPage)).toContainText('VHR');

    await annotationPage.keyboard.press('i');

    await expect(layerButton(annotationPage)).toContainText('Sentinel-2', { timeout: 3000 });
  });

  test('I twice: Sentinel-2 cycles back to VHR', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('i');
    await expect(layerButton(annotationPage)).toContainText('Sentinel-2', { timeout: 3000 });

    await annotationPage.keyboard.press('i');
    await expect(layerButton(annotationPage)).toContainText('VHR', { timeout: 3000 });
  });

  test('I: active small window switches to the Sentinel-2 window', async ({ annotationPage }) => {
    await expectActiveWindow(annotationPage, COLLECTION_VHR.id, COLLECTION_S2.id);

    await annotationPage.keyboard.press('i');

    await expectActiveWindow(annotationPage, COLLECTION_S2.id, COLLECTION_VHR.id);
  });

  test('I twice: active small window returns to VHR', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('i');
    await expectActiveWindow(annotationPage, COLLECTION_S2.id, COLLECTION_VHR.id);

    await annotationPage.keyboard.press('i');
    await expectActiveWindow(annotationPage, COLLECTION_VHR.id, COLLECTION_S2.id);
  });

  test('I: timeline sidebar updates to show the Sentinel-2 collection', async ({
    annotationPage,
  }) => {
    await annotationPage.keyboard.press('i');
    await expect(layerButton(annotationPage)).toContainText('Sentinel-2', { timeout: 3000 });

    await expect(annotationPage.locator('[data-tour="timeline-sidebar"]')).toContainText(
      COLLECTION_S2.name,
      { timeout: 3000 }
    );
  });

  test('I back: timeline sidebar returns to the VHR collection', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('i');
    await annotationPage.keyboard.press('i');
    await expect(layerButton(annotationPage)).toContainText('VHR', { timeout: 3000 });

    await expect(annotationPage.locator('[data-tour="timeline-sidebar"]')).toContainText(
      COLLECTION_VHR.name,
      { timeout: 3000 }
    );
  });

  test('dropdown: selecting Sentinel-2 True Color switches source', async ({ annotationPage }) => {
    // With more than one source in the view, options are labelled "<Source> > <Viz>".
    await selectLayerOption(annotationPage, 'Sentinel-2 > True Color');

    await expect(layerButton(annotationPage)).toContainText('Sentinel-2', { timeout: 3000 });
    await expectActiveWindow(annotationPage, COLLECTION_S2.id, COLLECTION_VHR.id);
  });

  test('dropdown: selecting VHR True Color from Sentinel-2 switches source back', async ({
    annotationPage,
  }) => {
    await annotationPage.keyboard.press('i');
    await expect(layerButton(annotationPage)).toContainText('Sentinel-2', { timeout: 3000 });

    await selectLayerOption(annotationPage, 'VHR > True Color');

    await expect(layerButton(annotationPage)).toContainText('VHR', { timeout: 3000 });
    await expectActiveWindow(annotationPage, COLLECTION_VHR.id, COLLECTION_S2.id);
  });

  test('dropdown: selecting Sentinel-2 False Color from VHR switches source and viz', async ({
    annotationPage,
  }) => {
    await selectLayerOption(annotationPage, 'Sentinel-2 > False Color');

    const layerBtn = layerButton(annotationPage);
    await expect(layerBtn).toContainText('Sentinel-2', { timeout: 3000 });
    await expect(layerBtn).toContainText('False Color', { timeout: 3000 });
    await expectActiveWindow(annotationPage, COLLECTION_S2.id, COLLECTION_VHR.id);
  });

  test('dropdown: the VHR option is selected after switching back to it', async ({
    annotationPage,
  }) => {
    await selectLayerOption(annotationPage, 'Sentinel-2 > True Color');
    await expect(layerButton(annotationPage)).toContainText('Sentinel-2', { timeout: 3000 });

    await selectLayerOption(annotationPage, 'VHR > True Color');
    await expect(layerButton(annotationPage)).toContainText('VHR', { timeout: 3000 });

    await openLayerDropdown(annotationPage);
    // Styling is the only DOM signal of the selected option (see above).
    await expect(layerOption(annotationPage, 'VHR > True Color')).toHaveClass(/text-brand-700/);
    await expect(layerOption(annotationPage, 'Sentinel-2 > True Color')).not.toHaveClass(
      /text-brand-700/
    );
  });

  test('clicking a small window header directly switches active source', async ({
    annotationPage,
  }) => {
    await expectActiveWindow(annotationPage, COLLECTION_VHR.id, COLLECTION_S2.id);

    await windowTitle(annotationPage, COLLECTION_S2.id).click();

    await expectActiveWindow(annotationPage, COLLECTION_S2.id, COLLECTION_VHR.id);
    await expect(layerButton(annotationPage)).toContainText('Sentinel-2', { timeout: 3000 });
  });
});

// VHR publishes a single visualization, so a viz detour has to start from
// Sentinel-2 - Shift+I on VHR has nothing to cycle to.
test.describe('Visualization preserved after source detour', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await useCampaign(annotationPage, api, MOCK_CAMPAIGN_MULTI_SOURCE);
  });

  test('S2 false color → VHR → back restores false color (hotkeys)', async ({ annotationPage }) => {
    const layerBtn = layerButton(annotationPage);

    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('Sentinel-2 > True Color', { timeout: 3000 });

    await annotationPage.keyboard.press('Shift+i');
    await expect(layerBtn).toContainText('Sentinel-2 > False Color', { timeout: 3000 });

    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('VHR', { timeout: 3000 });

    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('Sentinel-2 > False Color', { timeout: 3000 });
  });

  test('S2 false color → VHR via dropdown → back restores false color', async ({
    annotationPage,
  }) => {
    const layerBtn = layerButton(annotationPage);

    await selectLayerOption(annotationPage, 'Sentinel-2 > False Color');
    await expect(layerBtn).toContainText('Sentinel-2 > False Color', { timeout: 3000 });

    await selectLayerOption(annotationPage, 'VHR > True Color');
    await expect(layerBtn).toContainText('VHR', { timeout: 3000 });

    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('Sentinel-2 > False Color', { timeout: 3000 });
  });

  test('multiple round-trips each preserve the last viz set', async ({ annotationPage }) => {
    const layerBtn = layerButton(annotationPage);

    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('Sentinel-2 > True Color', { timeout: 3000 });
    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('VHR', { timeout: 3000 });
    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('Sentinel-2 > True Color', { timeout: 3000 });

    await annotationPage.keyboard.press('Shift+i');
    await expect(layerBtn).toContainText('Sentinel-2 > False Color', { timeout: 3000 });

    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('VHR', { timeout: 3000 });
    await annotationPage.keyboard.press('i');
    await expect(layerBtn).toContainText('Sentinel-2 > False Color', { timeout: 3000 });
  });
});

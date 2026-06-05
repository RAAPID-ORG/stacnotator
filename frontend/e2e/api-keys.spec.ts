import { test, expect, waitForNavIdle } from './fixtures/annotator-fixture';
import type { Page } from '@playwright/test';
import { MOCK_CAMPAIGN, COLLECTION_S2, COLLECTION_NDVI, SOURCE } from './fixtures/mock-data';

/** Locate the API keys modal by scoping to the fixed overlay that contains its heading. */
function apiKeysModal(page: Page) {
  return page.locator('.fixed').filter({ hasText: 'API Keys Required' });
}

const KEYED_BASEMAP_ID = 99;
const KEYED_COLLECTION_ID = COLLECTION_S2.id;

const KEYED_BASEMAP = {
  id: KEYED_BASEMAP_ID,
  name: 'Planet Basemap',
  url: 'https://tiles.example.com/planet/{z}/{x}/{y}.png?api_key={api_key}',
  max_native_zoom: 18,
};

const PUBLIC_BASEMAP = {
  id: 98,
  name: 'OSM',
  url: 'https://tiles.example.com/osm/{z}/{x}/{y}.png',
  max_native_zoom: 19,
};

const KEYED_COLLECTION = {
  ...COLLECTION_S2,
  slices: COLLECTION_S2.slices.map((sl) => ({
    ...sl,
    tile_urls: sl.tile_urls.map((tu) => ({
      ...tu,
      tile_url: `https://tiles.example.com/keyed-imagery/{z}/{x}/{y}?viz=${tu.visualization_name}&api_key={api_key}`,
    })),
  })),
};

const KEYED_SOURCE = { ...SOURCE, collections: [KEYED_COLLECTION, COLLECTION_NDVI] };

function storedApiKeys(keys: Record<string, string>): string {
  return JSON.stringify({ state: { keys }, version: 0 });
}

async function reloadWithCampaign(page: Page, campaign: object): Promise<void> {
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: campaign });
  });
  await page.reload();
  await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
  await page.waitForSelector('[data-tour="controls"]', { timeout: 10_000 });
}

test.describe('API key prompt', () => {
  test('no prompt when campaign has no {api_key} placeholder', async ({ annotationPage }) => {
    await expect(annotationPage.getByText('API Keys Required')).not.toBeVisible();
  });

  test('prompt shown when a basemap URL contains {api_key} and no value is stored', async ({
    annotationPage,
  }) => {
    await reloadWithCampaign(annotationPage, { ...MOCK_CAMPAIGN, basemaps: [KEYED_BASEMAP] });

    await expect(annotationPage.getByText('API Keys Required')).toBeVisible({ timeout: 5_000 });
    await expect(annotationPage.getByPlaceholder('Paste your API key here')).toBeVisible();
  });

  test('no prompt when {api_key} value is already in localStorage', async ({ annotationPage }) => {
    await annotationPage.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: 'stacnotator:api-keys', value: storedApiKeys({ 'basemap:99': 'PLtest123' }) }
    );

    await reloadWithCampaign(annotationPage, { ...MOCK_CAMPAIGN, basemaps: [KEYED_BASEMAP] });

    await expect(annotationPage.getByText('API Keys Required')).not.toBeVisible();
  });

  test('skip dismisses the modal and annotation page remains functional', async ({
    annotationPage,
  }) => {
    await reloadWithCampaign(annotationPage, { ...MOCK_CAMPAIGN, basemaps: [KEYED_BASEMAP] });

    await expect(annotationPage.getByText('API Keys Required')).toBeVisible({ timeout: 5_000 });
    await apiKeysModal(annotationPage).getByRole('button', { name: 'Skip' }).click();
    await expect(annotationPage.getByText('API Keys Required')).not.toBeVisible();
    await expect(annotationPage.locator('[data-tour="controls"]')).toBeVisible();
  });

  test('save is disabled until the acknowledgment checkbox is ticked', async ({
    annotationPage,
  }) => {
    await reloadWithCampaign(annotationPage, { ...MOCK_CAMPAIGN, basemaps: [KEYED_BASEMAP] });

    await expect(annotationPage.getByText('API Keys Required')).toBeVisible({ timeout: 5_000 });
    await expect(annotationPage.getByRole('button', { name: 'Save' })).toBeDisabled();
    await annotationPage.getByRole('checkbox').click();
    await expect(annotationPage.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  test('entering a key and saving dismisses the modal', async ({ annotationPage }) => {
    await reloadWithCampaign(annotationPage, { ...MOCK_CAMPAIGN, basemaps: [KEYED_BASEMAP] });

    await expect(annotationPage.getByText('API Keys Required')).toBeVisible({ timeout: 5_000 });
    await annotationPage.getByPlaceholder('Paste your API key here').fill('PLtest123');
    await annotationPage.getByRole('checkbox').click();
    await annotationPage.getByRole('button', { name: 'Save' }).click();
    await expect(annotationPage.getByText('API Keys Required')).not.toBeVisible();
  });
});

test.describe('multiple API keys', () => {
  test('prompt shows one entry per missing key when both basemap and collection require keys', async ({
    annotationPage,
  }) => {
    await reloadWithCampaign(annotationPage, {
      ...MOCK_CAMPAIGN,
      basemaps: [KEYED_BASEMAP],
      imagery_sources: [KEYED_SOURCE],
    });

    const modal = apiKeysModal(annotationPage);
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByPlaceholder('Paste your API key here')).toHaveCount(2);
    await expect(modal.getByText('Planet Basemap')).toBeVisible();
    await expect(modal.getByText(COLLECTION_S2.name)).toBeVisible();
  });

  test('prompt shows only the entry whose key is missing when one is already stored', async ({
    annotationPage,
  }) => {
    await annotationPage.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: 'stacnotator:api-keys', value: storedApiKeys({ 'basemap:99': 'PLtest123' }) }
    );

    await reloadWithCampaign(annotationPage, {
      ...MOCK_CAMPAIGN,
      basemaps: [KEYED_BASEMAP],
      imagery_sources: [KEYED_SOURCE],
    });

    const modal = apiKeysModal(annotationPage);
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByPlaceholder('Paste your API key here')).toHaveCount(1);
    await expect(modal.getByText(COLLECTION_S2.name)).toBeVisible();
    await expect(modal.getByText('Planet Basemap')).not.toBeVisible();
  });

  test('no prompt when all keys are stored', async ({ annotationPage }) => {
    await annotationPage.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      {
        key: 'stacnotator:api-keys',
        value: storedApiKeys({
          'basemap:99': 'PLtest123',
          [`collection:${KEYED_COLLECTION_ID}`]: 'IMGtest456',
        }),
      }
    );

    await reloadWithCampaign(annotationPage, {
      ...MOCK_CAMPAIGN,
      basemaps: [KEYED_BASEMAP],
      imagery_sources: [KEYED_SOURCE],
    });

    await expect(annotationPage.getByText('API Keys Required')).not.toBeVisible();
  });
});

test.describe('API key tile substitution', () => {
  test('basemap tile requests contain the substituted value, not the placeholder', async ({
    annotationPage,
  }) => {
    await annotationPage.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: 'stacnotator:api-keys', value: storedApiKeys({ 'basemap:99': 'PLtest123' }) }
    );

    // Listener must be created before the action that triggers the request.
    const keyedTileRequest = annotationPage.waitForRequest(
      (req) => req.url().includes('api_key=PLtest123'),
      { timeout: 15_000 }
    );

    await reloadWithCampaign(annotationPage, { ...MOCK_CAMPAIGN, basemaps: [KEYED_BASEMAP] });
    await waitForNavIdle(annotationPage);
    // Basemap is not active by default - cycle to it so OL requests its tiles.
    await annotationPage.keyboard.press('i');

    const req = await keyedTileRequest;
    expect(req.url()).toContain('/planet/');
    expect(req.url()).toContain('api_key=PLtest123');
    expect(req.url()).not.toContain('{api_key}');
    expect(req.url()).not.toContain('{z}');
  });

  test('each entry gets only its own key value', async ({ annotationPage }) => {
    await annotationPage.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      {
        key: 'stacnotator:api-keys',
        value: storedApiKeys({
          'basemap:99': 'PLANET_KEY',
          [`collection:${KEYED_COLLECTION_ID}`]: 'IMAGERY_KEY',
        }),
      }
    );

    const planetRequest = annotationPage.waitForRequest(
      (req) => req.url().includes('api_key=PLANET_KEY'),
      { timeout: 15_000 }
    );
    const imageryRequest = annotationPage.waitForRequest(
      (req) => req.url().includes('api_key=IMAGERY_KEY'),
      { timeout: 15_000 }
    );

    await reloadWithCampaign(annotationPage, {
      ...MOCK_CAMPAIGN,
      basemaps: [KEYED_BASEMAP],
      imagery_sources: [KEYED_SOURCE],
    });
    await waitForNavIdle(annotationPage);
    // Imagery tiles (IMAGERY_KEY) are requested automatically when the app loads.
    // Basemap tiles (PLANET_KEY) require activating the basemap layer.
    await annotationPage.keyboard.press('i');

    const [planet, imagery] = await Promise.all([planetRequest, imageryRequest]);
    expect(planet.url()).toContain('/planet/');
    expect(planet.url()).not.toContain('IMAGERY_KEY');
    expect(imagery.url()).toContain('/keyed-imagery/');
    expect(imagery.url()).not.toContain('PLANET_KEY');
  });

  test('keyless tile URLs are not modified when a key is stored', async ({ annotationPage }) => {
    await annotationPage.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: 'stacnotator:api-keys', value: storedApiKeys({ 'basemap:99': 'PLtest123' }) }
    );

    const publicTileUrls: string[] = [];
    annotationPage.on('request', (req) => {
      if (req.url().includes('/osm/')) publicTileUrls.push(req.url());
    });

    await reloadWithCampaign(annotationPage, {
      ...MOCK_CAMPAIGN,
      basemaps: [PUBLIC_BASEMAP, KEYED_BASEMAP],
    });

    await annotationPage.waitForTimeout(3_000);

    for (const url of publicTileUrls) {
      expect(url).not.toContain('api_key=');
    }
  });
});

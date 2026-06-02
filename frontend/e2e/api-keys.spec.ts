/**
 * E2E tests for API key handling on the annotation page.
 *
 * Providers signal that a key is needed by including {api_key} in the tile URL
 * template. The frontend substitutes the stored value at render time.
 *
 * Covers:
 * - No prompt when campaign has no {api_key} placeholder anywhere
 * - Prompt shown when a URL contains {api_key} and no value is stored
 * - No prompt when {api_key} value is already in localStorage
 * - Skip dismisses the modal; annotation page still works
 * - Save is disabled until acknowledgment checkbox is ticked
 * - Saving stores the value and dismisses the modal
 * - Basemap tile requests contain the substituted value
 * - Keyless tile URLs are not modified
 */
import { test, expect } from './fixtures/annotator-fixture';
import type { Page } from '@playwright/test';
import { MOCK_CAMPAIGN, COLLECTION_S2, COLLECTION_NDVI, SOURCE } from './fixtures/mock-data';

// ─── helpers ────────────────────────────────────────────────────────────────

const KEYED_BASEMAP_ID = 99;

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

/** Zustand persist format for stacnotator:api-keys with scoped keys */
function storedApiKeys(keys: Record<string, string>): string {
  return JSON.stringify({ state: { keys }, version: 0 });
}

const KEYED_COLLECTION_ID = COLLECTION_S2.id; // 10

/** COLLECTION_S2 with {api_key} injected into its tile URLs. */
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

async function reloadWithCampaign(page: Page, campaign: object): Promise<void> {
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: campaign });
  });
  await page.reload();
  await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
  await page.waitForSelector('[data-tour="controls"]', { timeout: 10_000 });
}

// ─── tests ──────────────────────────────────────────────────────────────────

test.describe('API key prompt', () => {
  test('no prompt when campaign has no {api_key} placeholder', async ({ annotationPage }) => {
    await expect(annotationPage.getByText('API Keys Required')).not.toBeVisible();
  });

  test('prompt shown when a basemap URL contains {api_key} and no value is stored', async ({
    annotationPage,
  }) => {
    await reloadWithCampaign(annotationPage, {
      ...MOCK_CAMPAIGN,
      basemaps: [KEYED_BASEMAP],
    });

    await expect(annotationPage.getByText('API Keys Required')).toBeVisible({ timeout: 5_000 });
    await expect(annotationPage.getByPlaceholder('Paste your API key here')).toBeVisible();
  });

  test('no prompt when {api_key} value is already in localStorage', async ({ annotationPage }) => {
    await annotationPage.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: 'stacnotator:api-keys', value: storedApiKeys({ 'basemap:99': 'PLtest123' }) }
    );

    await reloadWithCampaign(annotationPage, {
      ...MOCK_CAMPAIGN,
      basemaps: [KEYED_BASEMAP],
    });

    await expect(annotationPage.getByText('API Keys Required')).not.toBeVisible();
  });

  test('skip dismisses the modal and annotation page remains functional', async ({
    annotationPage,
  }) => {
    await reloadWithCampaign(annotationPage, {
      ...MOCK_CAMPAIGN,
      basemaps: [KEYED_BASEMAP],
    });

    await expect(annotationPage.getByText('API Keys Required')).toBeVisible({ timeout: 5_000 });
    await annotationPage.getByRole('button', { name: 'Skip' }).click();
    await expect(annotationPage.getByText('API Keys Required')).not.toBeVisible();
    await expect(annotationPage.locator('[data-tour="controls"]')).toBeVisible();
  });

  test('save is disabled until the acknowledgment checkbox is ticked', async ({
    annotationPage,
  }) => {
    await reloadWithCampaign(annotationPage, {
      ...MOCK_CAMPAIGN,
      basemaps: [KEYED_BASEMAP],
    });

    await expect(annotationPage.getByText('API Keys Required')).toBeVisible({ timeout: 5_000 });
    await expect(annotationPage.getByRole('button', { name: 'Save' })).toBeDisabled();
    await annotationPage.getByRole('checkbox').click();
    await expect(annotationPage.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  test('entering a key and saving dismisses the modal', async ({ annotationPage }) => {
    await reloadWithCampaign(annotationPage, {
      ...MOCK_CAMPAIGN,
      basemaps: [KEYED_BASEMAP],
    });

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

    await expect(annotationPage.getByText('API Keys Required')).toBeVisible({ timeout: 5_000 });
    // One input per missing entry
    const inputs = annotationPage.getByPlaceholder('Paste your API key here');
    await expect(inputs).toHaveCount(2);
    // Each entry is labelled by its name
    await expect(annotationPage.getByText('Planet Basemap')).toBeVisible();
    await expect(annotationPage.getByText(COLLECTION_S2.name)).toBeVisible();
  });

  test('prompt shows only the entry whose key is missing when one is already stored', async ({
    annotationPage,
  }) => {
    // Basemap key already stored - only the collection should appear in the prompt.
    await annotationPage.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      {
        key: 'stacnotator:api-keys',
        value: storedApiKeys({ 'basemap:99': 'PLtest123' }),
      }
    );

    await reloadWithCampaign(annotationPage, {
      ...MOCK_CAMPAIGN,
      basemaps: [KEYED_BASEMAP],
      imagery_sources: [KEYED_SOURCE],
    });

    await expect(annotationPage.getByText('API Keys Required')).toBeVisible({ timeout: 5_000 });
    const inputs = annotationPage.getByPlaceholder('Paste your API key here');
    await expect(inputs).toHaveCount(1);
    await expect(annotationPage.getByText(COLLECTION_S2.name)).toBeVisible();
    await expect(annotationPage.getByText('Planet Basemap')).not.toBeVisible();
  });

  test('no prompt when all keys are stored across basemap and collection', async ({
    annotationPage,
  }) => {
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

    const keyedTileRequest = annotationPage.waitForRequest(
      (req) => req.url().includes('api_key=PLtest123'),
      { timeout: 15_000 }
    );

    await reloadWithCampaign(annotationPage, {
      ...MOCK_CAMPAIGN,
      basemaps: [KEYED_BASEMAP],
    });

    const req = await keyedTileRequest;
    expect(req.url()).toContain('/planet/');
    expect(req.url()).toContain('api_key=PLtest123');
    expect(req.url()).not.toContain('{api_key}');
    expect(req.url()).not.toContain('{z}');
  });

  test('each entry gets only its own key value - keys are not shared across entries', async ({
    annotationPage,
  }) => {
    await annotationPage.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      {
        key: 'stacnotator:api-keys',
        value: storedApiKeys({ 'basemap:99': 'PLANET_KEY', [`collection:${KEYED_COLLECTION_ID}`]: 'IMAGERY_KEY' }),
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

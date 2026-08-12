/**
 * Provider API keys.
 *
 * The annotator never holds a provider key: a tile template that still carries
 * an `{api_key}` placeholder is rewritten to the backend's tile proxy, which
 * injects the key server-side (`needsKeyProxy` / `resolveBasemapUrl` /
 * `sliceTileProxyUrl` in src/features/annotation/core/catalog/catalog.ts).
 * These tests hold that contract: keyed templates leave the browser only as
 * proxy paths, keyless ones are untouched, and no key or placeholder is ever
 * put on the wire.
 */
import { test, expect } from './fixtures/annotator-fixture';
import type { Page, Request } from '@playwright/test';
import { MOCK_CAMPAIGN, COLLECTION_S2, COLLECTION_NDVI, SOURCE } from './fixtures/mock-data';

const CAMPAIGN_ID = 42;
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
const KEYED_COVER_SLICE_ID = KEYED_COLLECTION.slices[KEYED_COLLECTION.cover_slice_index].id;

async function reloadWithCampaign(page: Page, campaign: object): Promise<void> {
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: campaign });
  });
  await page.reload();
  await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
  await page.waitForSelector('[data-tour="controls"]', { timeout: 10_000 });
}

/** Record every outgoing request so leak assertions can look at all of them. */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (req: Request) => urls.push(req.url()));
  return urls;
}

/** Pick a basemap from the main map's layer selector (basemaps are listed
 *  alongside the imagery visualizations). */
async function selectLayer(page: Page, name: string): Promise<void> {
  await page.locator('[data-tour="layer-selector"] button').click();
  await page.locator('div.rounded-lg.shadow-lg button').filter({ hasText: name }).first().click();
}

test.describe('Keyed tile templates go through the backend proxy', () => {
  test('a keyed basemap is requested from the proxy, never from the provider', async ({
    annotationPage,
  }) => {
    const urls = recordRequests(annotationPage);
    const proxyTile = annotationPage.waitForRequest(
      (req) =>
        req.url().includes(`/api/${CAMPAIGN_ID}/imagery/basemaps/${KEYED_BASEMAP_ID}/tiles/`),
      { timeout: 15_000 }
    );

    await reloadWithCampaign(annotationPage, { ...MOCK_CAMPAIGN, basemaps: [KEYED_BASEMAP] });
    await selectLayer(annotationPage, KEYED_BASEMAP.name);

    const req = await proxyTile;
    expect(req.url()).not.toContain('{z}');
    expect(urls.some((url) => url.includes('/planet/'))).toBe(false);
  });

  test('a keyed imagery slice is requested from the slice proxy', async ({ annotationPage }) => {
    const urls = recordRequests(annotationPage);
    const proxyTile = annotationPage.waitForRequest(
      (req) =>
        req.url().includes(`/api/${CAMPAIGN_ID}/imagery/slices/${KEYED_COVER_SLICE_ID}/tiles/`),
      { timeout: 15_000 }
    );

    await reloadWithCampaign(annotationPage, {
      ...MOCK_CAMPAIGN,
      imagery_sources: [KEYED_SOURCE],
    });

    const req = await proxyTile;
    expect(req.url()).toContain(encodeURIComponent('True Color'));
    expect(urls.some((url) => url.includes('/keyed-imagery/'))).toBe(false);
  });

  test('neither the placeholder nor a key value ever reaches the network', async ({
    annotationPage,
  }) => {
    const urls = recordRequests(annotationPage);

    await reloadWithCampaign(annotationPage, {
      ...MOCK_CAMPAIGN,
      basemaps: [KEYED_BASEMAP],
      imagery_sources: [KEYED_SOURCE],
    });
    await selectLayer(annotationPage, KEYED_BASEMAP.name);
    await annotationPage.waitForTimeout(2_000);

    expect(urls.filter((url) => url.includes('api_key'))).toEqual([]);
  });
});

test.describe('Keyless tile templates are left alone', () => {
  test('a keyless basemap is fetched straight from the provider', async ({ annotationPage }) => {
    const providerTile = annotationPage.waitForRequest(
      (req) => req.url().includes('/osm/') && !req.url().includes('/api/'),
      { timeout: 15_000 }
    );

    await reloadWithCampaign(annotationPage, {
      ...MOCK_CAMPAIGN,
      basemaps: [PUBLIC_BASEMAP, KEYED_BASEMAP],
    });
    await selectLayer(annotationPage, PUBLIC_BASEMAP.name);

    const req = await providerTile;
    expect(req.url()).not.toContain('api_key');
    expect(req.url()).not.toContain('{z}');
  });

  test('a keyless imagery slice is fetched straight from the tiler', async ({
    annotationPage,
    api,
  }) => {
    const urls = recordRequests(annotationPage);
    await reloadWithCampaign(annotationPage, MOCK_CAMPAIGN);

    await expect
      .poll(() => api.requests.some((r) => r.url.includes('/mosaic/search-jan-2024/')), {
        timeout: 15_000,
      })
      .toBe(true);
    expect(urls.some((url) => url.includes('/imagery/slices/'))).toBe(false);
  });
});

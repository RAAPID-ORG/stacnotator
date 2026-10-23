import { readFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { test, expect } from './fixtures/annotator-fixture';
import type { ApiCapture } from './fixtures/annotator-fixture';
import { MOCK_CAMPAIGN_OPEN_MODE, MOCK_CAMPAIGN_OPEN_MODE_NO_TS } from './fixtures/mock-data';
import { clickMapCenter, dragBoxOnMap, waitForCreate } from './fixtures/imagery-helpers';

type Page = import('@playwright/test').Page;

/**
 * The real SAM 2.1 weights are 155 MB, so these run against stand-ins with the
 * same inputs and outputs (fixtures/segmentation/make_fake_sam2.py) that
 * outline the inner 70% of the prompted box. Everything else is real: tiles
 * stitched at native zoom, onnxruntime-web in the worker, mask tracing, the
 * proposals and their save.
 */
const FAKE_MODELS = new URL('./fixtures/segmentation/', import.meta.url);

const WAND_LABELS = [
  { id: 1, name: 'tree', geometry_type: 'point' },
  { id: 2, name: 'field', geometry_type: 'polygon', auto_segment: true },
  { id: 3, name: 'road', geometry_type: 'line' },
];
const WAND_CAMPAIGN = {
  ...MOCK_CAMPAIGN_OPEN_MODE_NO_TS,
  settings: { ...MOCK_CAMPAIGN_OPEN_MODE.settings, labels: WAND_LABELS },
};

/** A flat grey 256px PNG: the wand stitches the tiles it actually gets, so a
 *  1px placeholder tile would make a 1px image. */
function greyTile(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(256, 0);
  header.writeUInt32BE(256, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc(256 * (1 + 256 * 3), 0x80);
  for (let y = 0; y < 256; y++) rows[y * (1 + 256 * 3)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function loadWandCampaign(page: Page, api: ApiCapture, campaign: object = WAND_CAMPAIGN) {
  const tile = greyTile();
  await page.route('**/tiles.example.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: tile,
    })
  );
  // The worker's own fetches only pass through the context's routes.
  await page.context().route('**/models/segmentation/sam2.1-hiera-tiny/*.onnx', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    return route.fulfill({ body: readFileSync(new URL(name, FAKE_MODELS)) });
  });
  await page.route('**/api/campaigns/*/detailed', (route) => route.fulfill({ json: campaign }));
  await page.reload();
  await page.locator('[title="Pan (P)"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page
    .locator('[data-testid="viewport-center"]')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  api.clear();
}

const proposals = (page: Page) =>
  page.locator('[data-panel-role="main-map"] [data-wand-proposals]').first();

test.describe('Magic wand', () => {
  test('outlines the object in a box and saves it on Enter', async ({ annotationPage, api }) => {
    await loadWandCampaign(annotationPage, api);
    await annotationPage.locator('[title="Magic wand (W)"]').click();
    await expect(annotationPage.getByTestId('wand-panel')).toBeVisible();

    await dragBoxOnMap(annotationPage, [-120, -80], [120, 80]);
    await expect(annotationPage.getByTestId('wand-accept-btn')).toHaveText('Accept 1', {
      timeout: 30_000,
    });
    await expect(proposals(annotationPage)).toHaveAttribute('data-wand-proposals', '1');

    const created = waitForCreate(annotationPage);
    await annotationPage.keyboard.press('Enter');
    const body = (await created).request().postDataJSON();
    expect(body.label_id).toBe(2);
    // The stand-in's mask is a rectangle: traced and simplified, four corners.
    expect(body.geometry_wkt).toMatch(/^POLYGON\s*\(\((\S+ \S+, ){4}\S+ \S+\)\)$/);
    await expect(proposals(annotationPage)).toHaveAttribute('data-wand-proposals', '0');
  });

  test('a click leaves an outline out, Escape discards them all', async ({
    annotationPage,
    api,
  }) => {
    await loadWandCampaign(annotationPage, api);
    await annotationPage.keyboard.press('w');
    await dragBoxOnMap(annotationPage, [-120, -80], [120, 80]);
    const accept = annotationPage.getByTestId('wand-accept-btn');
    await expect(accept).toHaveText('Accept 1', { timeout: 30_000 });

    await clickMapCenter(annotationPage);
    await expect(accept).toHaveText('Accept 0/1');
    await expect(accept).toBeDisabled();

    await annotationPage.keyboard.press('Escape');
    await expect(proposals(annotationPage)).toHaveAttribute('data-wand-proposals', '0');
    expect(api.filter(/create-annotation|batch-create/)).toHaveLength(0);
  });

  test('is only offered when a label enables it', async ({ annotationPage, api }) => {
    await loadWandCampaign(annotationPage, api, MOCK_CAMPAIGN_OPEN_MODE_NO_TS);
    await expect(annotationPage.locator('[title="Annotate (R)"]')).toBeVisible();
    await expect(annotationPage.locator('[title="Magic wand (W)"]')).toHaveCount(0);
  });
});

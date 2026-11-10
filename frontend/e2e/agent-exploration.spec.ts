import type {} from '../src/features/annotation/AgentRenderPage';
import type { ViewSpec } from '../src/features/annotation/agents/view';
import { test, expect } from './fixtures/annotator-fixture';
import { MOCK_CAMPAIGN } from './fixtures/mock-data';

test('an agent explores a nearby field without moving the task marker', async ({
  appPage: page,
}) => {
  await page.exposeFunction('stacnotatorToken', () => 'test-render-token');
  await page.route('**/api/campaigns/*/detailed', (route) =>
    route.fulfill({
      json: {
        ...MOCK_CAMPAIGN,
        settings: { ...MOCK_CAMPAIGN.settings, sample_extent_meters: 30 },
      },
    })
  );
  const tile = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#227744';
    ctx.fillRect(0, 0, 256, 256);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.route('https://tiles.example.com/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: Buffer.from(tile, 'base64') })
  );
  await page.goto('/agent-render?campaign=42');
  await expect(page.getByText('Agent render page - ready')).toBeVisible();
  const result = await page.evaluate(async () => {
    const api = window.stacnotatorAgent!;
    const task = { task_id: 1, lat: 0, lon: 0, geometry_wkt: 'POINT(0 0)' };
    const limits = { max_edge_px: 2000, max_megapixels: 4 };
    const overview: ViewSpec = { cells: [{ slice_id: 101 }], columns: 1, cell_px: 400, zoom: 12 };
    const [wide] = await api.render(task, [overview], limits);
    if ('error' in wide) throw new Error(wide.error);
    const [near, far] = api.locate(task, [
      { view: overview, reply: 1, image: 1, x: 230, y: 200 },
      { view: overview, reply: 1, image: 1, x: 310, y: 200 },
    ]);
    const closeup = { ...overview, center: near, zoom: 14 };
    const [close, distant] = await api.render(task, [closeup, { ...closeup, center: far }], limits);
    if ('error' in close) throw new Error(close.error);
    if ('error' in distant) throw new Error(distant.error);
    const [home] = await api.render(task, [overview], limits);
    if ('error' in home) throw new Error(home.error);
    const [again] = api.locate(task, [{ view: closeup, reply: 2, image: 1, x: 200, y: 200 }]);

    async function redPixels(data: string) {
      const image = new Image();
      image.src = `data:image/jpeg;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const { data: pixels } = ctx.getImageData(0, 0, image.width, image.height);
      const xs = [];
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] - Math.max(pixels[i + 1], pixels[i + 2]) > 40) xs.push((i / 4) % image.width);
      return {
        count: xs.length,
        x: xs.length ? xs.reduce((sum, x) => sum + x, 0) / xs.length : null,
      };
    }

    return {
      closeImage: close.image_base64,
      sameHome: home.image_base64 === wide.image_base64,
      closeMeta: close.meta,
      distantMeta: distant.meta,
      closeRed: await redPixels(close.image_base64),
      distantRed: await redPixels(distant.image_base64),
      near: { lat: near.lat, lon: near.lon },
      again: { lat: again.lat, lon: again.lon },
    };
  });
  const imagePath = test.info().outputPath('nearby-view.jpg');
  await writeFile(imagePath, Buffer.from(result.closeImage, 'base64'));
  await test.info().attach('nearby-view', { path: imagePath, contentType: 'image/jpeg' });
  expect(result.closeMeta).toMatchObject({
    cells: [{ task_in_view: true, inside_box: { mean_rgb: [34, 119, 68] } }],
  });
  expect(result.distantMeta).toMatchObject({ cells: [{ task_in_view: false }] });
  expect(result.closeRed.count).toBeGreaterThan(0);
  expect(result.closeRed.x).toBeGreaterThan(78);
  expect(result.closeRed.x).toBeLessThan(82);
  expect(result.distantRed.count).toBe(0);
  expect(result.sameHome).toBe(true);
  expect(result.again.lon).toBeCloseTo(result.near.lon, 9);
  expect(result.again.lat).toBeCloseTo(result.near.lat, 9);
});
import { writeFile } from 'node:fs/promises';

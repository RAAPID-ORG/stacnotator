import { writeFile } from 'node:fs/promises';
import type {} from '../src/features/annotation/AgentRenderPage';
import type { ViewSpec } from '../src/features/annotation/agents/view';
import { test, expect } from './fixtures/annotator-fixture';
import { MOCK_CAMPAIGN, MOCK_TIMESERIES_DATA, MOCK_TIMESERIES_ENTRY } from './fixtures/mock-data';

test.beforeEach(async ({ appPage: page }) => {
  await page.exposeFunction('stacnotatorToken', () => 'test-render-token');
  await page.route('**/api/campaigns/*/detailed', (route) =>
    route.fulfill({
      json: {
        ...MOCK_CAMPAIGN,
        time_series: [MOCK_TIMESERIES_ENTRY],
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
  await page.route('**/api/campaigns/*/timeseries/*/data*', (route) =>
    route.fulfill({ json: { data: MOCK_TIMESERIES_DATA } })
  );
  await page.goto('/agent-render?campaign=42');
  await expect(page.getByText('Agent render page - ready')).toBeVisible();
});

for (const lon of [0, 179.99]) {
  test(`an agent explores near longitude ${lon} without moving the task marker`, async ({
    appPage: page,
  }) => {
    const result = await page.evaluate(async (lon) => {
      const api = window.stacnotatorAgent!;
      const task = { task_id: 1, lat: 0, lon, geometry_wkt: `POINT(${lon} 0)` };
      const limits = { max_edge_px: 2000, max_megapixels: 4 };
      const overview: ViewSpec = { cells: [{ slice_id: 101 }], columns: 1, cell_px: 400, zoom: 12 };
      const [wide] = await api.render(task, [overview], limits);
      if ('error' in wide) throw new Error(wide.error);
      const [near, far] = api.locate(task, [
        { view: overview, reply: 1, image: 1, x: 230, y: 200 },
        { view: overview, reply: 1, image: 1, x: 310, y: 200 },
      ]);
      const closeup = { ...overview, center: near, zoom: 14 };
      const [close, distant] = await api.render(
        task,
        [closeup, { ...closeup, center: far }],
        limits
      );
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
          if (pixels[i] - Math.max(pixels[i + 1], pixels[i + 2]) > 40)
            xs.push((i / 4) % image.width);
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
    }, lon);
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
}

test('a fitted global probe preserves raster scale below zoom zero', async ({ appPage: page }) => {
  const tile = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#227744';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(56, 0, 16, 256);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.route('https://tiles.example.com/**/0/0/0?*', (route) =>
    route.fulfill({ contentType: 'image/png', body: Buffer.from(tile, 'base64') })
  );

  const result = await page.evaluate(async () => {
    const api = window.stacnotatorAgent!;
    const task = { task_id: 2, lat: 0, lon: 0, geometry_wkt: 'POINT(0 0)' };
    const overview: ViewSpec = { cells: [{ slice_id: 101 }], columns: 1, cell_px: 512, zoom: 1 };
    const probe = await api.probe(
      task,
      [{ view: overview, reply: 1, image: 1, x: 500, y: 256 }],
      { timeseries_ids: [1] },
      { max_edge_px: 400, max_megapixels: 0.16 }
    );
    if ('error' in probe) throw new Error(probe.error);
    const px = probe.view.cell_px!;
    const image = new Image();
    image.src = `data:image/jpeg;base64,${probe.image_base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, Math.floor(px / 2), px, 1);
    const blue = [];
    for (let x = 0; x < px; x++)
      if (data[x * 4 + 2] - Math.max(data[x * 4], data[x * 4 + 1]) > 80) blue.push(x);
    const [pickedAgain] = api.locate(task, [
      { view: probe.view, reply: 2, image: 1, x: (500 / 512) * px, y: px / 2 },
    ]);
    return {
      zoom: probe.view.cells[0].zoom,
      size: probe.meta.size,
      bluePosition: blue.reduce((sum, x) => sum + x, 0) / blue.length / px,
      longitude: pickedAgain.lon,
      probes: probe.meta.probes,
    };
  });
  expect(result.zoom).toBeLessThan(0);
  expect(result.size).toEqual([216, 396]);
  expect(result.bluePosition).toBeCloseTo(0.25, 2);
  expect(Math.abs(result.longitude - 171.5625)).toBeLessThan(1);
  expect(result.probes).toMatchObject([{ lon: 171.5625 }]);
});

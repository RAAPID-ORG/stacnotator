import { writeFile } from 'node:fs/promises';
import type {} from '../src/features/annotation/AgentRenderPage';
import { test, expect } from './fixtures/annotator-fixture';
import { MOCK_CAMPAIGN, MOCK_TIMESERIES_ENTRY } from './fixtures/mock-data';

const ndvi = [
  { time: '2024-06-01T10:00:00Z', values: 0.3, cloud: 0 },
  { time: '2024-06-06T10:00:00Z', values: 0.65, cloud: 0 },
  { time: '2024-06-06T10:00:00Z', values: 0.55, cloud: 0 },
  { time: '2024-07-05T11:00:00Z', values: 0.123456789, cloud: 1 },
  { time: '2024-07-26T10:00:00Z', values: 0.4, cloud: 0 },
  { time: '2024-07-31T10:00:00Z', values: 0.7, cloud: 0 },
];
const rep = {
  ...MOCK_TIMESERIES_ENTRY,
  id: 2,
  name: 'REP',
  ts_type: 'REP',
  index: {
    key: 'REP',
    label: 'REP',
    formula: '',
    domain_min: 680,
    domain_max: 760,
    reference_lines: [],
  },
};

test.beforeEach(async ({ annotationPage: page }) => {
  await page.exposeFunction('stacnotatorToken', () => 'test-render-token');
  await page.route('**/api/campaigns/*/detailed', (route) =>
    route.fulfill({
      json: {
        ...MOCK_CAMPAIGN,
        time_series: [MOCK_TIMESERIES_ENTRY, rep],
        default_main_canvas_layout: {
          ...MOCK_CAMPAIGN.default_main_canvas_layout,
          layout_data: MOCK_CAMPAIGN.default_main_canvas_layout.layout_data.map((item) =>
            item.i === 'timeseries' ? { ...item, i: 'timeseries:1', h: 20 } : item
          ),
        },
      },
    })
  );
  await page.route('**/api/campaigns/*/timeseries/*/data*', (route) =>
    route.fulfill({
      json: {
        data: route.request().url().includes('/timeseries/2/')
          ? ndvi.map((row, i) => ({ ...row, values: [500, 720, 730, 725, 740, 1100][i] }))
          : ndvi,
      },
    })
  );
});

for (const surface of ['agent', 'interactive'] as const) {
  test(`${surface} plots connecting guides across gaps and discloses REP overflow`, async ({
    appPage: page,
  }) => {
    let image: string;
    if (surface === 'agent') {
      await page.goto('/agent-render?campaign=42');
      await expect(page.getByText('Agent render page - ready')).toBeVisible();
      const result = await page.evaluate(async () => {
        const [result] = await window.stacnotatorAgent!.render(
          { task_id: 1, lat: 0, lon: 0, geometry_wkt: 'POINT(0 0)' },
          [{ cells: [{ timeseries_ids: [1, 2], remove_cloudy: true }], columns: 1, cell_px: 800 }],
          { max_edge_px: 1600, max_megapixels: 4 }
        );
        if ('error' in result) throw new Error(result.error);
        return result;
      });
      expect(result.meta).toMatchObject({
        cells: [
          {
            line_interpretation:
              'Connecting lines are visual guides, not observations between dates.',
            axes: [
              { min: -0.2, max: 1 },
              { min: 680, max: 760 },
            ],
            warning: '2 off-scale observations marked with boundary triangles; see raw rows.',
            series: [
              {
                axis: 'y',
                off_scale: 0,
                columns: ['date', 'value', 'cloudy', 'source_row', 'filtered'],
                rows: ndvi.map((row, i) => [row.time, row.values, row.cloud, i + 1, row.cloud]),
              },
              { axis: 'y2', off_scale: 2 },
            ],
          },
        ],
      });
      image = `data:image/jpeg;base64,${result.image_base64}`;
    } else {
      await page.goto('/projects/7/campaigns/42/annotate');
      await expect(page.getByText('2 off-scale observations:', { exact: false })).toBeVisible();
      const canvas = page.locator('[data-panel-role="timeseries"] canvas');
      await expect(canvas).toBeVisible();
      await expect(
        page.getByText('Lines are visual guides, not observations between dates.', { exact: false })
      ).toBeVisible();
      // Wait for the chart animation to finish by observing stable pixels.
      let previous = '';
      await expect
        .poll(async () => {
          const current = await canvas.evaluate((element: HTMLCanvasElement) =>
            element.toDataURL()
          );
          const stable = previous === current;
          previous = current;
          return stable;
        })
        .toBe(true);
      image = await canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
    }

    const pixels = await page.evaluate(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, img.width, img.height);
      const blueXs: number[] = [];
      for (let y = Math.floor(img.height * 0.3); y < img.height * 0.85; y++) {
        for (let x = Math.floor(img.width * 0.08); x < img.width * 0.92; x++) {
          const i = (y * img.width + x) * 4;
          if (data[i + 2] - data[i] > 100 && data[i + 2] - data[i + 1] > 60)
            blueXs.push(x / img.width);
        }
      }
      return {
        left: blueXs.filter((x) => x < 0.3).length,
        gap: blueXs.filter((x) => x >= 0.3 && x <= 0.7).length,
        right: blueXs.filter((x) => x > 0.7).length,
      };
    }, image);
    const imagePath = test
      .info()
      .outputPath(`${surface}-chart.${surface === 'agent' ? 'jpg' : 'png'}`);
    await writeFile(imagePath, Buffer.from(image.split(',')[1], 'base64'));
    await test.info().attach(`${surface}-chart`, {
      path: imagePath,
      contentType: surface === 'agent' ? 'image/jpeg' : 'image/png',
    });
    expect(pixels.left).toBeGreaterThan(5);
    expect(pixels.right).toBeGreaterThan(5);
    expect(pixels.gap).toBeGreaterThan(50);
  });
}

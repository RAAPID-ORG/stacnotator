import { test, expect } from './fixtures/annotator-fixture';
import { MOCK_CAMPAIGN, MOCK_TIMESERIES_ENTRY } from './fixtures/mock-data';
import type {} from '../src/features/annotation/AgentRenderPage';

test.beforeEach(async ({ appPage: page }) => {
  await page.exposeFunction('stacnotatorToken', () => 'test-render-token');
  await page.route('**/api/campaigns/*/detailed', (route) =>
    route.fulfill({ json: { ...MOCK_CAMPAIGN, time_series: [MOCK_TIMESERIES_ENTRY] } })
  );
});

test('agent chart positions observations by elapsed days and keeps concise metadata', async ({
  appPage: page,
}) => {
  await page.route('**/api/campaigns/*/timeseries/*/data*', (route) =>
    route.fulfill({
      json: {
        data: [
          { time: '2024-06-01T10:00:00Z', values: 0.3, cloud: 0 },
          { time: '2024-06-06T10:00:00Z', values: 0.8123456789, cloud: 0 },
          { time: '2024-07-26T10:00:00Z', values: 0.4, cloud: 0 },
        ],
      },
    })
  );
  await page.goto('/agent-render?campaign=42');
  await expect(page.getByText('Agent render page - ready')).toBeVisible();
  const result = await page.evaluate(async () => {
    const [result] = await window.stacnotatorAgent!.render(
      { task_id: 1, lat: 0, lon: 0, geometry_wkt: 'POINT(0 0)' },
      [{ cells: [{ timeseries_ids: [1] }], columns: 1, cell_px: 800 }],
      { max_edge_px: 1600, max_megapixels: 4 }
    );
    if ('error' in result) throw new Error(result.error);
    return result;
  });
  expect(result.meta).toMatchObject({
    cells: [
      {
        series: [
          {
            columns: ['date', 'value', 'cloudy'],
            rows: [
              ['2024-06-01', 0.3, 0],
              ['2024-06-06', 0.812, 0],
              ['2024-07-26', 0.4, 0],
            ],
          },
        ],
      },
    ],
  });
  const peakX = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let y = Math.floor(canvas.height * 0.1); y < canvas.height * 0.85; y++) {
      for (let x = Math.floor(canvas.width * 0.08); x < canvas.width * 0.92; x++) {
        const i = (y * canvas.width + x) * 4;
        if (data[i + 2] - data[i] > 100 && data[i + 2] - data[i + 1] > 60) {
          return x / canvas.width;
        }
      }
    }
    throw new Error('No plotted curve found');
  }, result.image_base64);
  expect(peakX).toBeGreaterThan(0.08);
  expect(peakX).toBeLessThan(0.2);
});

test('agent chart draws monthly grid marks even across months without observations', async ({
  appPage: page,
}) => {
  await page.route('**/api/campaigns/*/timeseries/*/data*', (route) =>
    route.fulfill({
      json: {
        data: [
          { time: '2024-01-01', values: 0.3, cloud: 0 },
          { time: '2025-12-31', values: 0.3, cloud: 0 },
        ],
      },
    })
  );
  await page.goto('/agent-render?campaign=42');
  await expect(page.getByText('Agent render page - ready')).toBeVisible();
  const marks = await page.evaluate(async () => {
    const [result] = await window.stacnotatorAgent!.render(
      { task_id: 1, lat: 0, lon: 0, geometry_wkt: 'POINT(0 0)' },
      [{ cells: [{ timeseries_ids: [1] }], columns: 1, cell_px: 800 }],
      { max_edge_px: 1600, max_megapixels: 4 }
    );
    if ('error' in result) throw new Error(result.error);
    const image = new Image();
    image.src = `data:image/jpeg;base64,${result.image_base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const positions: number[] = [];
    let previous = -2;
    for (let x = Math.floor(canvas.width * 0.1); x < canvas.width * 0.9; x++) {
      const isGrid = [0.33, 0.47, 0.61].every((fraction) => {
        const i = (Math.floor(canvas.height * fraction) * canvas.width + x) * 4;
        return (
          data[i] > 190 &&
          data[i] < 245 &&
          Math.abs(data[i] - data[i + 1]) < 6 &&
          Math.abs(data[i] - data[i + 2]) < 6
        );
      });
      if (isGrid) {
        if (x > previous + 1) positions.push(x);
        previous = x;
      }
    }
    return positions;
  });
  expect(marks.length).toBeGreaterThanOrEqual(18);
  expect(marks.length).toBeLessThanOrEqual(22);
  const gaps = marks.slice(1).map((x, i) => x - marks[i]);
  expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(1.2);
});

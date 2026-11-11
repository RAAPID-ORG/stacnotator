import { test, expect } from './fixtures/annotator-fixture';
import {
  MOCK_CAMPAIGN_EXPLORE,
  MOCK_CAMPAIGN_WITH_TIMESERIES,
  MOCK_TASK_LIST,
  TASK_1,
  TASK_2,
} from './fixtures/mock-data';
import { clickMapAt, clickMapCenter, drawPolygon, waitForCreate } from './fixtures/imagery-helpers';

type Page = import('@playwright/test').Page;

const isZonalRequest = (request: import('@playwright/test').Request) =>
  request.method() === 'POST' && /\/timeseries\/\d+\/data$/.test(new URL(request.url()).pathname);

async function openExplore(page: Page) {
  await page.route('**/api/campaigns/*/detailed', (route) =>
    route.fulfill({ json: MOCK_CAMPAIGN_EXPLORE })
  );
  await page.goto('/projects/7/campaigns/42/annotate?mode=explore');
  await page.getByRole('button', { name: 'Probe time series (T)', exact: true }).waitFor();
}

const triangle: Array<[number, number]> = [
  [-60, -45],
  [60, -45],
  [0, 60],
];

test('task mode can draw a polygon probe and reports its validation error beside the task chart', async ({
  annotationPage: page,
}) => {
  await page.route('**/api/campaigns/*/detailed', (route) =>
    route.fulfill({ json: MOCK_CAMPAIGN_WITH_TIMESERIES })
  );
  await page.route('**/api/campaigns/*/timeseries/*/data*', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 422,
      json: { detail: [{ msg: 'Polygon area exceeds the 50 km² limit' }] },
    });
  });
  await page.reload();
  await page.locator('[data-tour^="timeseries:"] canvas').waitFor();
  await page.getByTestId('probe-toggle').click();
  await page.getByRole('radio', { name: 'Draw polygon', exact: true }).click();
  await Promise.all([page.waitForRequest(isZonalRequest), drawPolygon(page, triangle)]);
  await expect(page.getByRole('alert')).toContainText('Polygon area exceeds the 50 km² limit');
  await expect(page.locator('[data-tour^="timeseries:"] canvas')).toBeVisible();
});

test('polygon tasks and prefetch use full geometry rather than a centroid or sample square', async ({
  annotationPage: page,
}) => {
  const requests: import('@playwright/test').Request[] = [];
  page.on('request', (request) => {
    if (isZonalRequest(request)) requests.push(request);
  });
  const ring = [
    [30.51, 50.44],
    [30.53, 50.44],
    [30.53, 50.46],
    [30.51, 50.46],
    [30.51, 50.44],
  ];
  const hole = [
    [30.515, 50.445],
    [30.515, 50.455],
    [30.525, 50.455],
    [30.525, 50.445],
    [30.515, 50.445],
  ];
  const coordinates = [ring, hole];
  const wktRings = coordinates.map((r) => `(${r.map((p) => p.join(' ')).join(', ')})`).join(', ');
  await page.route('**/api/campaigns/*/detailed', (route) =>
    route.fulfill({ json: MOCK_CAMPAIGN_WITH_TIMESERIES })
  );
  await page.route('**/api/campaigns/*/tasks', (route) =>
    route.fulfill({
      json: {
        ...MOCK_TASK_LIST,
        tasks: [
          { ...TASK_1, geometry_wkt: `POLYGON (${wktRings})` },
          { ...TASK_2, geometry_wkt: `MULTIPOLYGON ((${wktRings}))` },
        ],
      },
    })
  );
  await page.reload();
  await expect(page.getByText('Polygons: mean index of clear pixels')).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests.map((r) => r.postDataJSON())).toEqual(
    expect.arrayContaining([
      { geometry: { type: 'Polygon', coordinates } },
      { geometry: { type: 'MultiPolygon', coordinates: [coordinates] } },
    ])
  );
});

test('drawing a polygon probe does not save an annotation and a point can be added inside it', async ({
  annotationPage: page,
  api,
}) => {
  await openExplore(page);
  await page.getByRole('button', { name: 'Probe time series (T)', exact: true }).click();
  await page.getByRole('radio', { name: 'Draw polygon', exact: true }).click();
  api.clear();
  const [request] = await Promise.all([
    page.waitForRequest(isZonalRequest),
    drawPolygon(page, triangle),
  ]);
  expect(request.postDataJSON().geometry.type).toBe('Polygon');
  expect(request.postDataJSON().geometry.coordinates[0]).toHaveLength(4);
  await expect(page.locator('[data-probe-count]')).toHaveAttribute('data-probe-count', '1');
  expect(api.filter(/\/annotations(?:\/\d+)?$/)).toEqual([]);
  // Finishing with Shift adds the polygon instead of replacing the first.
  const shifted = triangle.map(([x, y]): [number, number] => [x + 20, y - 10]);
  for (const [x, y] of shifted) await clickMapAt(page, x, y);
  await Promise.all([
    page.waitForRequest(isZonalRequest),
    clickMapAt(page, ...shifted[0], { shift: true }),
  ]);
  await expect(page.locator('[data-probe-count]')).toHaveAttribute('data-probe-count', '2');
  await page.getByRole('radio', { name: 'Point', exact: true }).click();
  const isPointRequest = (r: import('@playwright/test').Request) =>
    r.method() === 'GET' && /\/timeseries\/\d+\/data\?/.test(r.url());
  const [pointRequest] = await Promise.all([
    page.waitForRequest(isPointRequest),
    clickMapCenter(page, { shift: true }),
  ]);
  expect(new URL(pointRequest.url()).searchParams.has('latitude')).toBe(true);
  await expect(page.locator('[data-probe-count]')).toHaveAttribute('data-probe-count', '3');
  await Promise.all([page.waitForRequest(isPointRequest), clickMapAt(page, 100, 50)]);
  await expect(page.locator('[data-probe-count]')).toHaveAttribute('data-probe-count', '3');
});

test('Select saved loads the full saved polygon and empty-map clicks do not start a sketch', async ({
  annotationPage: page,
  api,
}) => {
  await openExplore(page);
  await page.keyboard.press('2');
  await Promise.all([waitForCreate(page), drawPolygon(page, triangle)]);
  await expect(page.locator('[data-annotation-delta]')).toHaveAttribute(
    'data-annotation-delta',
    '1'
  );
  await page.getByRole('button', { name: 'Probe time series (T)', exact: true }).click();
  await page.getByRole('radio', { name: 'Select saved', exact: true }).click();
  api.clear();
  // A deliberately different server geometry proves the probe did not use the hit tile.
  const geometry = {
    type: 'Polygon',
    coordinates: [
      [
        [30.495, 50.495],
        [30.505, 50.495],
        [30.505, 50.505],
        [30.495, 50.505],
        [30.495, 50.495],
      ],
    ],
  };
  await page.route('**/api/campaigns/*/annotations/9100', (route) =>
    route.fulfill({
      json: {
        id: 9100,
        geometry_wkt:
          'POLYGON ((30.495 50.495, 30.505 50.495, 30.505 50.505, 30.495 50.505, 30.495 50.495))',
      },
    })
  );
  const [request] = await Promise.all([page.waitForRequest(isZonalRequest), clickMapCenter(page)]);
  expect(request.postDataJSON()).toEqual({ geometry });
  await page.getByTestId('clear-probes').click();
  await drawPolygon(page, [
    [90, 40],
    [130, 40],
    [110, 75],
  ]);
  await expect(page.locator('[data-probe-count]')).toHaveAttribute('data-probe-count', '0');
  expect(api.filter(/\/annotations$/).filter((r) => r.method === 'POST')).toEqual([]);
});

test('polygon probes let Pan, Edit and Select saved reach covered annotations', async ({
  annotationPage: page,
}) => {
  await openExplore(page);
  await page.keyboard.press('2');
  await Promise.all([waitForCreate(page), drawPolygon(page, triangle)]);
  await page.getByRole('button', { name: 'Probe time series (T)', exact: true }).click();
  await page.getByRole('radio', { name: 'Select saved', exact: true }).click();
  await Promise.all([page.waitForRequest(isZonalRequest), clickMapCenter(page)]);
  await expect(page.locator('[data-probe-count]')).toHaveAttribute('data-probe-count', '1');

  const annotationRead = () =>
    page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' && /\/annotations\/9100$/.test(response.url())
    );
  for (const tool of ['Pan (P)', 'Edit (E)']) {
    await page.getByRole('button', { name: tool, exact: true }).click();
    await Promise.all([annotationRead(), clickMapCenter(page)]);
    await expect(page.locator('[data-probe-count]')).toHaveAttribute('data-probe-count', '1');
    await page.getByRole('button', { name: 'Probe time series (T)', exact: true }).click();
  }

  // Select saved reaches the annotation under a polygon probe: a click replaces
  // the active probe, Shift+click adds another.
  await Promise.all([annotationRead(), clickMapCenter(page)]);
  await expect(page.locator('[data-probe-count]')).toHaveAttribute('data-probe-count', '1');
  await Promise.all([annotationRead(), clickMapCenter(page, { shift: true })]);
  await expect(page.locator('[data-probe-count]')).toHaveAttribute('data-probe-count', '2');
});

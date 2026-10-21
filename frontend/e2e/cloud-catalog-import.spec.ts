/**
 * Specification (issue #158): a project admin creates an Azure catalog, picks discovered
 * files with explicit times, imports them, sees a failed file named in place, retries, and
 * the catalog becomes ready - all without a review/inspection step.
 *
 * Page: /projects/:projectId/catalogs. Selectors this spec fixes:
 *   buttons "New catalog", "Create catalog", "Index selected", "Retry indexing";
 *   labelled fields "Title", "Container URL", "Path prefix", "SAS token";
 *   rows data-testid="cloud-object-row" with a checkbox labelled by the object path;
 *   per selected path p: data-testid `time-mode-${p}` (interval checkbox),
 *   `time-instant-${p}`, `time-start-${p}`, `time-end-${p}`;
 *   data-testid="cloud-import-status" (text Indexing | Failed | Ready) and
 *   data-testid="cloud-import-error" (one per error, shows path and message).
 * API: /api/cloud-imagery/... as in backend/tests/test_cloud_imagery_api.py.
 */
import { test, expect, ROUTE } from './fixtures/annotator-fixture';
import { MOCK_PROJECT } from './fixtures/mock-data';

const CONTAINER = 'https://acct.blob.core.windows.net/imagery';
const SECRET = 'sp=rl&se=2099-01-01T00:00:00Z&spr=https&sr=c&sig=TOPSECRET';
const COLLECTION = {
  id: 11,
  title: 'Drone flights',
  project_id: MOCK_PROJECT.id,
  status: 'draft',
  tiler: 'hosted',
  container_url: CONTAINER,
  prefix: 'flights/',
  storage_access: { kind: 'azure_sas', expires_at: '2099-01-01T00:00:00Z' },
  data_region: null,
  tiler_region: null,
};
const IMPORT = {
  id: 21,
  collection_id: COLLECTION.id,
  status: 'registering',
  total: 2,
  completed: 0,
  errors: [],
  retryable: false,
};

test('group monthly assets manually or by rules, then use indexed band names', async ({
  appPage: page,
}) => {
  const paths = ['01', '02'].flatMap((month) =>
    ['reflectance', 'clear-count'].map(
      (asset) => `imagery/guaviare-s2-2025-${month}/guaviare-s2-2025-${month}_${asset}.tif`
    )
  );
  const unmatched = 'imagery/other.tif';
  let indexed: {
    path: string;
    item_key: string;
    asset_key: string;
    band_names?: string[];
    start_datetime: string;
    end_datetime: string;
  }[] = [];
  const catalog = () => ({
    ...COLLECTION,
    status: indexed.length ? 'ready' : 'draft',
    visualizations: [],
    import_id: indexed.length ? IMPORT.id : null,
    item_assets: indexed.length
      ? {
          reflectance: {
            title: 'Reflectance',
            type: 'image/tiff',
            roles: ['data'],
            bands: [{ name: 'red' }, { name: 'green' }, { name: 'blue' }],
          },
          'clear-count': {
            title: 'Clear count',
            type: 'image/tiff',
            roles: ['data'],
            bands: [{ name: 'count' }],
          },
        }
      : {},
  });
  await page.route(/\/api\/cloud-imagery\/collections\?/, (route) =>
    route.fulfill({ json: { items: [catalog()] } })
  );
  await page.route(`**/api/cloud-imagery/collections/${COLLECTION.id}`, (route) =>
    route.fulfill({ json: catalog() })
  );
  await page.route(`**/api/cloud-imagery/collections/${COLLECTION.id}/discover*`, (route) =>
    route.fulfill({
      json: {
        objects: [...paths, unmatched].map((path) => ({ path, etag: '"1"', size: 1000 })),
        next_cursor: null,
      },
    })
  );
  await page.route(`**/api/cloud-imagery/collections/${COLLECTION.id}/imports`, (route) => {
    indexed = route.request().postDataJSON().files;
    return route.fulfill({ status: 202, json: IMPORT });
  });
  await page.route(`**/api/cloud-imagery/imports/${IMPORT.id}`, (route) =>
    route.fulfill({ json: { ...IMPORT, status: 'ready', total: 5, completed: 5 } })
  );
  await page.goto(`/projects/${MOCK_PROJECT.id}/catalogs`);
  await page.getByTestId('cloud-catalog-row').getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('cloud-object-row')).toHaveCount(5);
  await page.getByRole('checkbox', { name: 'Select all files' }).uncheck();
  for (const path of paths.slice(0, 2))
    await page.getByRole('checkbox', { name: path, exact: true }).check();
  await page.getByText('Group files into items (optional)', { exact: true }).click();
  await page.getByRole('button', { name: 'Group selected as one item' }).click();
  const groups = page.getByTestId('cloud-item-group');
  await expect(groups).toHaveCount(1);
  await expect(groups).toContainText('2 assets');
  await groups.getByRole('button', { name: 'Ungroup' }).click();
  await page.getByRole('checkbox', { name: 'Select all files' }).check();
  await page.getByLabel('Asset name rule 1').fill('reflectance');
  await page.getByLabel('File pattern rule 1').fill('_reflectance\\.tif$');
  await page.getByRole('button', { name: 'Add asset rule' }).click();
  await page.getByLabel('Asset name rule 2').fill('clear-count');
  await page.getByLabel('File pattern rule 2').fill('_clear-count\\.tif$');
  await expect(page.getByLabel('Grouping preview')).toContainText(
    '4 matching files → 2 dated items'
  );
  await expect(page.getByLabel('Grouping preview')).toContainText('1 selected file unchanged');
  await expect(page.getByLabel('Band names rule 1')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('grouping-preview.png'), fullPage: true });
  await page.getByRole('button', { name: 'Apply grouping', exact: true }).click();
  await expect(groups).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: unmatched, exact: true })).toBeChecked();
  await expect(page.getByLabel(`Date for ${unmatched}`, { exact: true })).toHaveValue('');
  await page.getByLabel(`Date for ${unmatched}`, { exact: true }).fill('2025-03-01');
  await expect(groups.nth(0).getByRole('textbox').first()).toHaveValue('2025-01-01');
  await expect(groups.nth(1).getByRole('textbox').last()).toHaveValue('2025-02-28');
  await page.getByText('Group files into items (optional)', { exact: true }).click();
  await groups.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('grouped-assets.png'), fullPage: true });
  await page.getByRole('button', { name: 'Index selected' }).click();
  await expect(page.getByTestId('cloud-import-status')).toHaveText('Ready');
  expect(indexed).toHaveLength(5);
  expect(new Set(indexed.filter((file) => file.item_key).map((file) => file.item_key)).size).toBe(
    2
  );
  expect(indexed[0]).toMatchObject({
    asset_key: 'reflectance',
    start_datetime: '2025-01-01T00:00:00Z',
    end_datetime: '2025-01-31T23:59:59.999999Z',
  });
  expect(indexed.every((file) => file.band_names === undefined)).toBe(true);
  await page.getByText('Catalog settings', { exact: true }).click();
  await expect(page.getByLabel('Detected bands')).toContainText(
    'reflectance · 3 bands: red, green, blue'
  );
  await expect(page.getByLabel('Detected bands')).toContainText('clear-count · 1 band: count');
  await page.getByRole('button', { name: 'Add a visualization preset' }).click();
  await expect(page.getByLabel('Bands in each file')).toHaveCount(0);
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.getByRole('radio', { name: /RGB/ }).check();
  await page
    .getByRole('combobox', { name: 'Red (R) asset', exact: true })
    .selectOption('reflectance');
  await expect(page.getByRole('combobox', { name: 'Red (R) band', exact: true })).toContainText(
    '1: red'
  );
  await expect(page.getByRole('combobox', { name: 'Red (R) band', exact: true })).toContainText(
    '3: blue'
  );
});

test('draft catalog: select files, apply matching dates, and delete', async ({ appPage: page }) => {
  const dated = 'flights/2026-01-05.tif';
  const other = 'flights/other.tif';
  let deleted = false;
  await page.route(/\/api\/cloud-imagery\/collections\?/, (route) =>
    route.fulfill({ json: { items: deleted ? [] : [COLLECTION] } })
  );
  await page.route(`**/api/cloud-imagery/collections/${COLLECTION.id}`, (route) => {
    if (route.request().method() === 'DELETE') {
      deleted = true;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: COLLECTION });
  });
  await page.route(`**/api/cloud-imagery/collections/${COLLECTION.id}/discover*`, (route) =>
    route.fulfill({
      json: {
        objects: [dated, other].map((path) => ({ path, etag: '"1"', size: 1000 })),
        next_cursor: null,
      },
    })
  );
  await page.goto(`/projects/${MOCK_PROJECT.id}/catalogs`);
  await page.getByTestId('cloud-catalog-row').getByRole('button', { name: 'Open' }).click();
  const matching = page.getByRole('checkbox', { name: dated, exact: true });
  const nonmatching = page.getByRole('checkbox', { name: other, exact: true });
  await expect(matching).toBeChecked();
  await expect(nonmatching).toBeChecked();
  await expect(page.getByText('Times are in UTC.', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Time zone', exact: true }).hover();
  await expect(page.getByText('Times are in UTC.', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select all files' }).uncheck();
  await expect(matching).not.toBeChecked();
  await expect(nonmatching).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Select all files' }).check();
  await expect(nonmatching).toBeChecked();
  const pattern = page.getByRole('textbox', { name: /regular expression/i });
  await expect(pattern).toBeHidden();
  const date = page.getByLabel(`Date for ${dated}`, { exact: true });
  const interval = page.getByRole('checkbox', { name: `Interval for ${dated}`, exact: true });
  await expect(date).toBeVisible();
  await expect(interval).not.toBeChecked();
  await date.scrollIntoViewIfNeeded();
  const dateBox = (await date.boundingBox())!;
  const intervalBox = (await interval.boundingBox())!;
  expect(dateBox.height).toBeLessThanOrEqual(32);
  expect(intervalBox.x).toBeGreaterThanOrEqual(dateBox.x + dateBox.width);
  await date.fill('2026-01-05');
  await interval.check();
  await expect(page.getByLabel(`Start for ${dated}`, { exact: true })).toHaveValue('2026-01-05');
  await expect(page.getByLabel(`End for ${dated}`, { exact: true })).toBeVisible();
  await interval.uncheck();
  await expect(date).toHaveValue('2026-01-05');
  await page.getByRole('button', { name: 'Date extraction example' }).hover();
  await expect(page.getByText(/flight_2026-01-05\.tif/)).toBeVisible();
  await page.getByText('Extract dates from filenames (optional)', { exact: true }).click();
  await expect(pattern).toBeVisible();
  expect((await pattern.boundingBox())!.y).toBeLessThan(
    (await page.getByTestId('cloud-object-row').first().boundingBox())!.y
  );
  await page.getByRole('checkbox', { name: 'Auto-select matching entries only' }).check();
  await pattern.fill('(');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('The pattern is not a valid regular expression')).toBeVisible();
  await expect(nonmatching).toBeChecked();
  await pattern.fill('(\\d{4}-\\d{2}-\\d{2})');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(matching).toBeChecked();
  await expect(nonmatching).not.toBeChecked();
  await expect(page.getByLabel(`Date for ${dated}`, { exact: true })).toHaveValue('2026-01-05');
  await test.info().attach('catalog-date-controls', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: 'Delete catalog' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(deleted).toBe(false);
  await page.getByRole('button', { name: 'Delete catalog' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByTestId('cloud-catalog-row')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: COLLECTION.title })).toHaveCount(0);
  expect(deleted).toBe(true);
});

/** Browser-side failures, attached when the test fails (the config already screenshots).
 *  Aborted requests are dropped: polling and route changes cancel mocked requests. */
let problems: string[] = [];

test.afterEach(async () => {
  const testInfo = test.info();
  if (testInfo.status === testInfo.expectedStatus) return;
  await testInfo.attach('browser-problems', {
    body: problems.join('\n') || '(none)',
    contentType: 'text/plain',
  });
});

test('create catalog, import with explicit times, see failure, retry to ready', async ({
  appPage: page,
}) => {
  problems = [];
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText ?? '';
    if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(failure))
      problems.push(`requestfailed: ${req.url()} ${failure}`);
  });

  // ProjectTilersOut (backend/src/projects/schemas.py): an org tiler that can ingest
  // files, which the create form requires before it enables "Create catalog".
  await page.route(ROUTE.projectTilers, (route) =>
    route.fulfill({
      json: {
        tilers: [
          {
            name: 'hosted',
            kind: 'hosted',
            url: 'https://tiler.test',
            is_default: true,
            stac_url: null,
            allows_ingest: true,
          },
        ],
        allows_internal_storage: false,
      },
    })
  );

  const bodies: Record<string, unknown> = {};
  let importState: Record<string, unknown> = IMPORT;

  await page.route(/\/api\/cloud-imagery\/collections\?/, (route) =>
    route.fulfill({ json: { items: [] } })
  );
  await page.route('**/api/cloud-imagery/collections', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    bodies.collection = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: COLLECTION });
  });
  await page.route(`**/api/cloud-imagery/collections/${COLLECTION.id}`, (route) =>
    route.fulfill({ json: COLLECTION })
  );
  await page.route(`**/api/cloud-imagery/collections/${COLLECTION.id}/discover*`, (route) =>
    route.fulfill({
      json: {
        objects: [
          { path: 'flights/a.tif', etag: '"0x0"', size: 1000 },
          { path: 'flights/b.tif', etag: '"0x1"', size: 1001 },
        ],
        next_cursor: null,
      },
    })
  );
  await page.route(`**/api/cloud-imagery/collections/${COLLECTION.id}/imports`, async (route) => {
    bodies.import = route.request().postDataJSON();
    importState = {
      ...IMPORT,
      status: 'failed',
      completed: 1,
      retryable: true,
      errors: [
        {
          code: 'invalid_raster',
          path: 'flights/b.tif',
          message: 'raster has no CRS',
        },
      ],
    };
    await route.fulfill({ status: 202, json: IMPORT });
  });
  await page.route(`**/api/cloud-imagery/imports/${IMPORT.id}`, (route) =>
    route.fulfill({ json: importState })
  );
  await page.route(`**/api/cloud-imagery/imports/${IMPORT.id}/retry`, async (route) => {
    importState = { ...IMPORT, status: 'ready', completed: 2 };
    await route.fulfill({ status: 202, json: { ...IMPORT, completed: 1 } });
  });

  await page.goto(`/projects/${MOCK_PROJECT.id}/catalogs`);
  await page.getByRole('button', { name: 'New catalog' }).click();
  await page.getByLabel('Title').fill('Drone flights');
  await page.getByLabel('Container URL').fill(CONTAINER);
  await page.getByLabel('Path prefix').fill('flights/');
  await page.getByLabel('SAS token').fill(SECRET);
  await page.getByRole('button', { name: 'Create catalog' }).click();

  await expect(page.getByTestId('cloud-object-row')).toHaveCount(2);
  expect(bodies.collection).toMatchObject({
    title: 'Drone flights',
    project_id: MOCK_PROJECT.id,
    container_url: CONTAINER,
    prefix: 'flights/',
    storage_access: { kind: 'azure_sas', secret: SECRET },
  });
  expect(bodies.collection).not.toHaveProperty('owner');
  expect(bodies.collection).not.toHaveProperty('organization_id');
  await expect(page.locator('body')).not.toContainText('TOPSECRET');

  await page.getByRole('checkbox', { name: 'flights/a.tif', exact: true }).check();
  await page.getByRole('checkbox', { name: 'flights/b.tif', exact: true }).check();
  await page.getByTestId('time-instant-flights/a.tif').fill('2026-01-12T10:20:00Z');
  await page.getByTestId('time-mode-flights/b.tif').check();
  await page.getByTestId('time-start-flights/b.tif').fill('2026-01-01');
  await page.getByTestId('time-end-flights/b.tif').fill('2026-01-31');
  await page.getByRole('button', { name: 'Index selected' }).click();

  await expect(page.getByTestId('cloud-import-status')).toHaveText(/Failed/);
  expect(bodies.import).toEqual({
    files: [
      {
        path: 'flights/a.tif',
        etag: '"0x0"',
        datetime: '2026-01-12T10:20:00Z',
      },
      {
        path: 'flights/b.tif',
        etag: '"0x1"',
        start_datetime: '2026-01-01T00:00:00Z',
        end_datetime: '2026-01-31T23:59:59.999999Z',
      },
    ],
  });
  const error = page.getByTestId('cloud-import-error');
  await expect(error).toContainText('flights/b.tif');
  await expect(error).toContainText('raster has no CRS');

  await page.getByRole('button', { name: 'Retry indexing' }).click();
  await expect(page.getByTestId('cloud-import-status')).toHaveText(/Ready/, {
    timeout: 15_000,
  });
  await expect(page.getByTestId('cloud-import-error')).toHaveCount(0);
});

/** Server state that moves with the import: the catalog reads `importing` once the import
 *  starts, then the outcome once the second poll of the import reports it. */
const mockFirstImport = async (
  page: import('@playwright/test').Page,
  outcome: { status: 'ready' | 'failed'; collection: 'ready' | 'failed'; errors?: unknown[] }
) => {
  let catalogStatus = 'draft';
  let polls = 0;
  const collection = () => ({
    ...COLLECTION,
    status: catalogStatus,
    visualizations: [],
    item_count: catalogStatus === 'ready' ? 1 : null,
    import_id: catalogStatus === 'draft' ? null : IMPORT.id,
  });
  const job = (status: string) => ({
    ...IMPORT,
    status,
    total: 1,
    completed: status === 'ready' ? 1 : 0,
    errors: status === 'failed' ? (outcome.errors ?? []) : [],
    retryable: false,
  });
  await page.route(ROUTE.projectTilers, (route) =>
    route.fulfill({
      json: {
        tilers: [
          {
            name: 'hosted',
            kind: 'hosted',
            url: 'https://tiler.test',
            is_default: true,
            stac_url: null,
            allows_ingest: true,
          },
        ],
        allows_internal_storage: false,
      },
    })
  );
  await page.route(/\/api\/cloud-imagery\/collections\?/, (route) =>
    route.fulfill({ json: { items: catalogStatus === 'draft' ? [] : [collection()] } })
  );
  await page.route('**/api/cloud-imagery/collections', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 201, json: collection() })
      : route.fallback()
  );
  await page.route(`**/api/cloud-imagery/collections/${COLLECTION.id}`, (route) =>
    route.fulfill({ json: collection() })
  );
  await page.route(`**/api/cloud-imagery/collections/${COLLECTION.id}/discover*`, (route) =>
    route.fulfill({
      json: { objects: [{ path: 'flights/a.tif', etag: '"0x0"', size: 1000 }], next_cursor: null },
    })
  );
  await page.route(`**/api/cloud-imagery/collections/${COLLECTION.id}/imports`, (route) => {
    catalogStatus = 'importing';
    return route.fulfill({ status: 202, json: job('registering') });
  });
  await page.route(`**/api/cloud-imagery/imports/${IMPORT.id}`, (route) => {
    polls++;
    if (polls >= 2) catalogStatus = outcome.collection;
    return route.fulfill({ json: job(polls >= 2 ? outcome.status : 'registering') });
  });

  await page.goto(`/projects/${MOCK_PROJECT.id}/catalogs`);
  await page.getByRole('button', { name: 'New catalog' }).click();
  await page.getByLabel('Title').fill('Drone flights');
  await page.getByLabel('Container URL').fill(CONTAINER);
  await page.getByLabel('Path prefix').fill('flights/');
  await page.getByLabel('SAS token').fill(SECRET);
  await page.getByRole('button', { name: 'Create catalog' }).click();
  await page.getByRole('checkbox', { name: 'flights/a.tif', exact: true }).check();
  await page.getByTestId('time-instant-flights/a.tif').fill('2026-01-12T10:20:00Z');
  await page.getByRole('button', { name: 'Index selected' }).click();
};

test('a first import that finishes while polling shows the catalog Ready everywhere', async ({
  appPage: page,
}) => {
  await mockFirstImport(page, { status: 'ready', collection: 'ready' });

  await expect(page.getByTestId('cloud-import-status')).toHaveText(/Ready/, { timeout: 15_000 });
  const row = page.getByTestId('cloud-catalog-row').filter({ hasText: 'Drone flights' });
  await expect(row).toContainText('Ready');
  await expect(row).not.toContainText('Indexing');
  await expect(page.getByText('Catalog settings')).toBeVisible();
});

test('a first import that fails while polling offers the repair settings without a retry', async ({
  appPage: page,
}) => {
  await mockFirstImport(page, {
    status: 'failed',
    collection: 'failed',
    errors: [{ code: 'storage_error', path: 'flights/a.tif', message: 'could not be read' }],
  });

  await expect(page.getByTestId('cloud-import-status')).toHaveText(/Failed/, { timeout: 15_000 });
  const row = page.getByTestId('cloud-catalog-row').filter({ hasText: 'Drone flights' });
  await expect(row).toContainText('Indexing failed');
  await expect(row.getByText('Indexing', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Catalog settings')).toBeVisible();
  await expect(page.getByText(/replace the SAS token below/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry indexing' })).toHaveCount(0);
});

/**
 * Specification (issue #158): a project admin creates an Azure catalog, picks discovered
 * files with explicit times, imports them, sees a failed file named in place, retries, and
 * the catalog becomes ready - all without a review/inspection step.
 *
 * Page: /projects/:projectId/catalogs. Selectors this spec fixes:
 *   buttons "New catalog", "Create catalog", "Import selected", "Retry import";
 *   labelled fields "Title", "Container URL", "Path prefix", "SAS token";
 *   rows data-testid="cloud-object-row" with a checkbox labelled by the object path;
 *   per selected path p: data-testid `time-mode-${p}` (select: instant|interval),
 *   `time-instant-${p}`, `time-start-${p}`, `time-end-${p}`;
 *   data-testid="cloud-import-status" (text Importing | Failed | Ready) and
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
  owner: { project_id: MOCK_PROJECT.id },
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
    owner: { project_id: MOCK_PROJECT.id },
    container_url: CONTAINER,
    prefix: 'flights/',
    storage_access: { kind: 'azure_sas', secret: SECRET },
  });
  await expect(page.locator('body')).not.toContainText('TOPSECRET');

  await page.getByRole('checkbox', { name: 'flights/a.tif' }).check();
  await page.getByRole('checkbox', { name: 'flights/b.tif' }).check();
  await page.getByTestId('time-instant-flights/a.tif').fill('2026-01-12T10:20:00Z');
  await page.getByTestId('time-mode-flights/b.tif').selectOption('interval');
  await page.getByTestId('time-start-flights/b.tif').fill('2026-01-01');
  await page.getByTestId('time-end-flights/b.tif').fill('2026-01-31');
  await page.getByRole('button', { name: 'Import selected' }).click();

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

  await page.getByRole('button', { name: 'Retry import' }).click();
  await expect(page.getByTestId('cloud-import-status')).toHaveText(/Ready/, {
    timeout: 15_000,
  });
  await expect(page.getByTestId('cloud-import-error')).toHaveCount(0);
});

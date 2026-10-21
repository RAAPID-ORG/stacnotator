/**
 * Imagery catalogs belong to projects only and are managed under the project's Settings
 * tab. The create form posts a flat project_id taken from the page (no owner object, no
 * organization). The organization page keeps Details, Members and API keys but has no
 * Imagery tab, and the old organization catalogs address exposes no catalog management.
 * The old project /catalogs address still lands on Settings with the catalog selected.
 * Admin gating stays: non-admins get no catalog management.
 *
 * API shapes follow cloud-catalog-import.spec.ts (CollectionOut, ProjectTilersOut).
 */
import type { Page } from '@playwright/test';
import { test, expect, ROUTE } from './fixtures/annotator-fixture';
import { MOCK_ORG, MOCK_PROJECT } from './fixtures/mock-data';

const CONTAINER = 'https://acct.blob.core.windows.net/imagery';
const SECRET = 'sp=rl&se=2099-01-01T00:00:00Z&spr=https&sr=c&sig=TOPSECRET';

const catalog = (id: number, title: string, projectId = MOCK_PROJECT.id, status = 'ready') => ({
  id,
  title,
  project_id: projectId,
  status,
  tiler: 'hosted',
  container_url: CONTAINER,
  prefix: 'flights/',
  storage_access: { kind: 'azure_sas', expires_at: '2099-01-01T00:00:00Z' },
  data_region: null,
  tiler_region: null,
  visualizations: [],
  item_count: status === 'ready' ? 1 : null,
  import_id: status === 'ready' ? 21 : null,
});

/** Mocks the catalog API and organization management reads; returns created bodies. */
async function mockCatalogs(page: Page, listed: ReturnType<typeof catalog>[]) {
  const created: unknown[] = [];
  const draft = catalog(11, 'Drone flights', MOCK_PROJECT.id, 'draft');
  const byId = new Map([draft, ...listed].map((c) => [c.id, c]));

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
  await page.route(/\/api\/organizations\/\d+\/(access-requests|api-keys)(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { items: [] } }) : route.fallback()
  );
  await page.route(/\/api\/organizations\/\d+\/users(\?.*)?$/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { organization_id: MOCK_ORG.id, users: [] } })
      : route.fallback()
  );
  await page.route(/\/api\/cloud-imagery\/collections\?/, (route) =>
    route.fulfill({ json: { items: listed } })
  );
  await page.route('**/api/cloud-imagery/collections', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    created.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: draft });
  });
  await page.route(/\/api\/cloud-imagery\/collections\/\d+(\?.*)?$/, (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').pop());
    const found = byId.get(id);
    return found ? route.fulfill({ json: found }) : route.fulfill({ status: 404, json: {} });
  });
  await page.route(/\/api\/cloud-imagery\/collections\/\d+\/discover/, (route) =>
    route.fulfill({ json: { objects: [], next_cursor: null } })
  );
  await page.route('**/api/cloud-imagery/imports/21', (route) =>
    route.fulfill({
      json: {
        id: 21,
        collection_id: 12,
        status: 'ready',
        total: 1,
        completed: 1,
        errors: [],
        retryable: false,
      },
    })
  );
  return created;
}

const searchParams = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams);

async function createCatalogFromForm(page: Page) {
  await page.getByRole('button', { name: 'New catalog' }).click();
  await expect(page.getByRole('heading', { name: 'New catalog', exact: true })).toBeVisible();
  await expect(page.getByLabel('Title')).toBeVisible();
  await expect(page.getByLabel('Shared with')).toHaveCount(0);
  await page.getByLabel('Title').fill('Drone flights');
  await page.getByLabel('Container URL').fill(CONTAINER);
  await page.getByLabel('Path prefix').fill('flights/');
  await page.getByLabel('SAS token').fill(SECRET);
  await page.getByRole('button', { name: 'Create catalog' }).click();
}

test('organization page keeps Details, Members and API keys but has no Imagery tab', async ({
  appPage: page,
}) => {
  await mockCatalogs(page, []);

  await page.goto(`/organizations/${MOCK_ORG.id}`);
  await expect(page.getByRole('heading', { name: MOCK_ORG.name })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Imagery' })).toHaveCount(0);

  const headings = new Set<string>();
  const tabs = page.getByRole('tab');
  for (let i = 0; i < (await tabs.count()); i++) {
    await tabs.nth(i).click();
    await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
    for (const h of await page.locator('h2').allTextContents()) headings.add(h.trim());
  }
  const all = [...headings].join(' | ');
  for (const section of ['Details', 'Access requests', 'Provider API keys', 'Members']) {
    expect(all).toContain(section);
  }
  expect(all).not.toContain('Imagery catalogs');
  await expect(page.getByRole('button', { name: 'New catalog' })).toHaveCount(0);
});

test('project Settings tab creates catalogs owned by the project', async ({ appPage: page }) => {
  const created = await mockCatalogs(page, []);

  await page.goto(`/projects/${MOCK_PROJECT.id}`);
  await expect(page.getByRole('tab', { name: 'Campaigns' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByRole('link', { name: 'Imagery catalogs' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Imagery catalogs' })).toBeVisible();
  const imagery = await page.getByRole('heading', { name: 'Imagery catalogs' }).boundingBox();
  const deletion = await page.getByRole('heading', { name: 'Delete project' }).boundingBox();
  expect(imagery).not.toBeNull();
  expect(deletion).not.toBeNull();
  expect(imagery!.y).toBeLessThan(deletion!.y);

  await createCatalogFromForm(page);
  await expect.poll(() => created).toHaveLength(1);
  expect(created[0]).toMatchObject({
    project_id: MOCK_PROJECT.id,
    container_url: CONTAINER,
    storage_access: { kind: 'azure_sas', secret: SECRET },
  });
  expect(created[0]).not.toHaveProperty('owner');
  expect(created[0]).not.toHaveProperty('organization_id');
  await expect.poll(() => searchParams(page)).toMatchObject({ tab: 'settings', catalog: '11' });
});

test('old project catalogs address lands on Settings with the catalog open', async ({
  appPage: page,
}) => {
  await mockCatalogs(page, [catalog(12, 'Field survey'), catalog(13, 'Second survey')]);

  await page.goto(`/projects/${MOCK_PROJECT.id}/catalogs?catalog=12`);

  await expect(page).toHaveURL(new RegExp(`/projects/${MOCK_PROJECT.id}\\?`));
  await expect.poll(() => searchParams(page)).toMatchObject({ tab: 'settings', catalog: '12' });
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByText('Catalog setup', { exact: true })).toBeVisible();

  await page
    .getByTestId('cloud-catalog-row')
    .filter({ hasText: 'Second survey' })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await expect.poll(() => searchParams(page)).toMatchObject({ tab: 'settings', catalog: '13' });
});

test('old organization catalogs address exposes no catalog management', async ({
  appPage: page,
}) => {
  await mockCatalogs(page, [catalog(12, 'Field survey')]);
  const catalogReads: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/cloud-imagery/')) catalogReads.push(request.url());
  });

  await page.goto(`/organizations/${MOCK_ORG.id}/catalogs?catalog=12`);

  await expect(
    page
      .getByText('Page not found')
      .or(page.getByRole('heading', { name: MOCK_ORG.name }))
      .first()
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Imagery' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Imagery catalogs' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New catalog' })).toHaveCount(0);
  await expect(page.getByText('Catalog settings')).toHaveCount(0);
  expect(catalogReads).toEqual([]);
});

test('non-admins get no catalog management on project or organization pages', async ({
  appPage: page,
}) => {
  const member = { ...MOCK_PROJECT, is_admin: false };
  await page.route(ROUTE.project, (route) => route.fulfill({ json: member }));
  await page.route(ROUTE.projects, (route) => route.fulfill({ json: { items: [member] } }));
  await page.route(ROUTE.organizations, (route) =>
    route.fulfill({ json: { items: [{ ...MOCK_ORG, is_admin: false }] } })
  );
  await mockCatalogs(page, []);

  await page.goto(`/projects/${MOCK_PROJECT.id}/catalogs`);
  await expect(page.getByRole('tab', { name: 'Campaigns' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Imagery catalogs' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New catalog' })).toHaveCount(0);

  await page.goto(`/organizations/${MOCK_ORG.id}`);
  await expect(page.getByText('You are not an admin of this organization.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Imagery' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New catalog' })).toHaveCount(0);
});

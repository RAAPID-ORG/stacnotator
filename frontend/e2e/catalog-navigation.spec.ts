/**
 * Imagery catalogs live inside the pages that own them instead of on separate pages:
 * the organization page gets an Imagery tab, the project page shows catalogs under its
 * Settings tab. The scope comes from the page, so the create form has no "Shared with"
 * choice and posts the owner of the surface it was opened from. The old /catalogs
 * addresses keep working by landing on the canonical tab with the catalog still selected,
 * and selecting or creating a catalog never drops the tab from the address.
 * Admin gating stays: non-admins get no catalog management on either page.
 *
 * API shapes follow cloud-catalog-import.spec.ts (CollectionOut, ProjectTilersOut) and
 * the generated client (OrganizationTilersOut = { tiler_names }).
 */
import type { Page } from '@playwright/test';
import { test, expect, ROUTE } from './fixtures/annotator-fixture';
import { MOCK_ORG, MOCK_PROJECT } from './fixtures/mock-data';

type Owner = { project_id: number } | { organization_id: number };

const CONTAINER = 'https://acct.blob.core.windows.net/imagery';
const SECRET = 'sp=rl&se=2099-01-01T00:00:00Z&spr=https&sr=c&sig=TOPSECRET';

const catalog = (id: number, title: string, owner: Owner, status = 'ready') => ({
  id,
  title,
  owner,
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

/** Mocks the catalog API for one owner; returns the bodies of created catalogs. */
async function mockCatalogs(page: Page, owner: Owner, listed: ReturnType<typeof catalog>[]) {
  const created: unknown[] = [];
  const draft = catalog(11, 'Drone flights', owner, 'draft');
  const byId = new Map([draft, ...listed].map((c) => [c.id, c]));

  if ('project_id' in owner) {
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
  } else {
    await page.route(`**/api/organizations/${owner.organization_id}/tilers`, (route) =>
      route.fulfill({ json: { tiler_names: ['hosted'] } })
    );
  }
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
  await expect(page.getByLabel('Title')).toBeVisible();
  await expect(page.getByLabel('Shared with')).toHaveCount(0);
  await page.getByLabel('Title').fill('Drone flights');
  await page.getByLabel('Container URL').fill(CONTAINER);
  await page.getByLabel('Path prefix').fill('flights/');
  await page.getByLabel('SAS token').fill(SECRET);
  await page.getByRole('button', { name: 'Create catalog' }).click();
}

test('organization Imagery tab manages catalogs for the organization', async ({
  appPage: page,
}) => {
  const created = await mockCatalogs(page, { organization_id: MOCK_ORG.id }, []);

  await page.goto(`/organizations/${MOCK_ORG.id}`);
  const imageryTab = page.getByRole('tab', { name: 'Imagery' });
  await imageryTab.click();

  await expect.poll(() => searchParams(page).tab).toBe('imagery');
  await expect(imageryTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: MOCK_ORG.name })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Imagery catalogs' })).toBeVisible();

  await createCatalogFromForm(page);
  await expect.poll(() => created).toHaveLength(1);
  expect(created[0]).toMatchObject({
    owner: { organization_id: MOCK_ORG.id },
    container_url: CONTAINER,
    storage_access: { kind: 'azure_sas', secret: SECRET },
  });
  expect(created[0]).not.toHaveProperty('owner.project_id');
  await expect.poll(() => searchParams(page)).toMatchObject({ tab: 'imagery', catalog: '11' });

  const headings = new Set<string>();
  const otherTabs = page.getByRole('tab').filter({ hasNotText: 'Imagery' });
  for (let i = 0; i < (await otherTabs.count()); i++) {
    await otherTabs.nth(i).click();
    for (const h of await page.locator('h2').allTextContents()) headings.add(h.trim());
  }
  const all = [...headings].join(' | ');
  for (const section of ['Details', 'Access requests', 'Provider API keys', 'Members']) {
    expect(all).toContain(section);
  }
});

test('project Settings tab creates catalogs owned by the project', async ({ appPage: page }) => {
  const created = await mockCatalogs(page, { project_id: MOCK_PROJECT.id }, []);

  await page.goto(`/projects/${MOCK_PROJECT.id}`);
  await expect(page.getByRole('tab', { name: 'Campaigns' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByRole('link', { name: 'Imagery catalogs' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Imagery catalogs' })).toBeVisible();

  await createCatalogFromForm(page);
  await expect.poll(() => created).toHaveLength(1);
  expect(created[0]).toMatchObject({ owner: { project_id: MOCK_PROJECT.id } });
  expect(created[0]).not.toHaveProperty('owner.organization_id');
  await expect.poll(() => searchParams(page)).toMatchObject({ tab: 'settings', catalog: '11' });
});

test('old project catalogs address lands on Settings with the catalog open', async ({
  appPage: page,
}) => {
  const owner = { project_id: MOCK_PROJECT.id };
  await mockCatalogs(page, owner, [
    catalog(12, 'Field survey', owner),
    catalog(13, 'Second survey', owner),
  ]);

  await page.goto(`/projects/${MOCK_PROJECT.id}/catalogs?catalog=12`);

  await expect(page).toHaveURL(new RegExp(`/projects/${MOCK_PROJECT.id}\\?`));
  await expect.poll(() => searchParams(page)).toMatchObject({ tab: 'settings', catalog: '12' });
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(page.getByText('Catalog settings')).toBeVisible();

  await page
    .getByTestId('cloud-catalog-row')
    .filter({ hasText: 'Second survey' })
    .getByRole('button', { name: 'Open' })
    .click();
  await expect.poll(() => searchParams(page)).toMatchObject({ tab: 'settings', catalog: '13' });
});

test('old organization catalogs address lands on the Imagery tab with the catalog open', async ({
  appPage: page,
}) => {
  const owner = { organization_id: MOCK_ORG.id };
  await mockCatalogs(page, owner, [catalog(12, 'Org mosaics', owner)]);

  await page.goto(`/organizations/${MOCK_ORG.id}/catalogs?catalog=12`);

  await expect(page).toHaveURL(new RegExp(`/organizations/${MOCK_ORG.id}\\?`));
  await expect.poll(() => searchParams(page)).toMatchObject({ tab: 'imagery', catalog: '12' });
  await expect(page.getByRole('tab', { name: 'Imagery' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Catalog settings')).toBeVisible();
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
  await mockCatalogs(page, { project_id: MOCK_PROJECT.id }, []);

  await page.goto(`/projects/${MOCK_PROJECT.id}/catalogs`);
  await expect(page.getByRole('tab', { name: 'Campaigns' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Imagery catalogs' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New catalog' })).toHaveCount(0);

  await page.goto(`/organizations/${MOCK_ORG.id}/catalogs`);
  await expect(page.getByText('You are not an admin of this organization.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Imagery' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New catalog' })).toHaveCount(0);
});

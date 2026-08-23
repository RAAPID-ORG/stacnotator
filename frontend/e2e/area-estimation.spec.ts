import { test, expect } from './fixtures/annotator-fixture';
import type { Page } from '@playwright/test';
import { MOCK_CAMPAIGN } from './fixtures/mock-data';

const SAMPLE_SET_ID = 99;
const SAMPLE_SET_NAME = 'Winter crops 2025';

const set = (id: number, name: string, numTasks: number) => ({
  id,
  name,
  created_at: '2026-01-01T00:00:00Z',
  num_tasks: numTasks,
  num_labeled: 0,
});

/**
 * The tasks page needs the plain campaign GET, which the shared fixture only
 * mocks in its /detailed form for the annotation page.
 */
async function mockCampaignAdmin(page: Page): Promise<{ created: string[] }> {
  const created: string[] = [];
  const sets = [set(1, 'Default', 3)];

  await page.route('**/api/campaigns/42', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: { ...MOCK_CAMPAIGN, viewer_is_admin: true } });
  });

  await page.route('**/api/campaigns/*/task-sets', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { name: string };
      created.push(body.name);
      sets.push(set(SAMPLE_SET_ID, body.name, 0));
      await route.fulfill({ json: set(SAMPLE_SET_ID, body.name, 0) });
      return;
    }
    if (request.method() === 'GET') {
      await route.fulfill({ json: sets });
      return;
    }
    return route.fallback();
  });

  return { created };
}

/** Start an area estimate from the campaign overview, its first-class home. */
async function startAreaEstimate(page: Page): Promise<void> {
  await page.goto('/projects/7/campaigns/42');
  await page.getByRole('button', { name: 'New area estimate' }).first().click();
  await page.getByTestId('new-area-estimate-name').fill(SAMPLE_SET_NAME);
  await page.getByTestId('new-area-estimate-create').click();
  await expect(page.getByRole('heading', { name: 'Map & Areas of Interest' })).toBeVisible();
}

/** Walk the wizard as far as the named step, leaving it filled in. */
async function fillWizard(page: Page, upTo: 'prior' | 'design'): Promise<void> {
  await startAreaEstimate(page);

  await page.getByTestId('uae-map-file').setInputFiles({
    name: 'cropmap_2025.tif',
    mimeType: 'image/tiff',
    buffer: Buffer.from('raster'),
  });
  await page.getByTestId('uae-areas-file').setInputFiles({
    name: 'oblast_regions.geojson',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  // Counting runs itself, first over the whole map and again once the areas
  // narrow it. Anchoring on the end of the line waits for the second one: only
  // the whole-map count carries a trailing clause.
  await expect(page.getByText(/pixels in the reporting area$/)).toBeVisible();

  await page.getByTestId('uae-continue').click();
  await page.getByTestId('uae-continue').click();
  if (upTo === 'prior') return;

  await page.getByTestId('uae-prior-last_season_map').click();
  await page.getByTestId('uae-continue').click();
  await page.getByTestId('uae-target-class').selectOption({ label: 'Winter wheat' });
}

test('sizes a sample from the target precision and locks the set it lives in', async ({
  appPage: page,
}) => {
  const { created } = await mockCampaignAdmin(page);
  await fillWizard(page, 'design');

  // The map's five classes each became a stratum, the nodata value did not,
  // and the design meets the 5% default the precision cards start on.
  const perStratum = page.getByRole('spinbutton', { name: /^Sample size for / });
  await expect(perStratum).toHaveCount(5);
  await expect(page.getByText(/Expected for the target class/)).toBeVisible();
  await expect(page.getByText(/^±[0-4]\.\d%$/)).toBeVisible();

  // The wizard owns the page while it is open: the set list and the task table
  // cannot be acted on until the sample is drawn, and would otherwise repeat
  // under every step.
  await expect(page.getByTestId('task-scope-bar')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /^Annotation tasks/ })).toHaveCount(0);

  await page.getByTestId('uae-activate').click();
  await expect(page.getByTestId('uae-edit-design')).toBeVisible();
  await expect(page.getByTestId('task-scope-bar')).toBeVisible();
  expect(created).toEqual([SAMPLE_SET_NAME]);

  // The sample set is closed to anything the design did not draw.
  await expect(page.getByRole('heading', { name: 'Add annotation tasks' })).toHaveCount(0);
  await expect(page.getByTitle('Rename set')).toHaveCount(0);
  await expect(page.getByTitle('Delete set')).toHaveCount(0);

  // Ordinary sets keep their controls, and their own way of getting tasks.
  await page.goto('/projects/7/campaigns/42/tasks?taskSet=1');
  await expect(page.getByRole('heading', { name: 'Add annotation tasks' })).toBeVisible();
  await expect(page.getByTitle('Rename set')).toBeVisible();

  // The estimate has its own section on the overview and is not repeated as
  // an ordinary task set.
  await page.goto('/projects/7/campaigns/42');
  const estimates = page.locator('section', { has: page.getByText('Area estimates') }).first();
  await expect(estimates.getByText(SAMPLE_SET_NAME)).toBeVisible();
  const taskSets = page.locator('section', { has: page.getByText('Task sets') }).last();
  await expect(taskSets.getByText(SAMPLE_SET_NAME)).toHaveCount(0);
});

test('takes a test set for allocation only, and pilots when nothing is known', async ({
  appPage: page,
}) => {
  await mockCampaignAdmin(page);
  await fillWizard(page, 'prior');

  // A test set is admissible, because the conjecture only ever drives the
  // allocation. Choosing it expands the card with that reasoning and the
  // pitfalls that keep it out of anything published.
  await page.getByTestId('uae-prior-held_out_test_set').click();
  const testSetCard = page.getByTestId('uae-prior-held_out_test_set');
  await expect(testSetCard.getByText(/allocate the sample across strata/)).toBeVisible();
  await expect(testSetCard.getByText(/almost never a probability sample/)).toBeVisible();
  await page.getByTestId('uae-continue').click();
  await page.getByTestId('uae-target-class').selectOption({ label: 'Winter wheat' });
  await expect(page.getByTestId('uae-activate')).toBeEnabled();

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByTestId('uae-prior-none').click();
  await page.getByTestId('uae-continue').click();

  // No accuracy information at all is what forces a pilot: a flat budget per
  // stratum, not a precision target.
  await expect(page.getByRole('heading', { name: 'Pilot sample' })).toBeVisible();
  await expect(page.getByTestId('uae-activate')).toBeEnabled();

  // Its parameters are for experts and stay out of the way until asked for.
  await expect(page.getByTestId('uae-pilot-budget')).toHaveCount(0);
  await page.getByTestId('uae-customize-pilot').click();
  await expect(page.getByTestId('uae-pilot-budget')).toHaveValue('40');
  await expect(page.getByTestId('uae-pilot-floor')).toHaveValue('20');
});

test('proposes an equal-area projection and keeps nodata handling out of the way', async ({
  appPage: page,
}) => {
  await mockCampaignAdmin(page);
  await startAreaEstimate(page);

  await page.getByTestId('uae-map-file').setInputFiles({
    name: 'cropmap_2025.tif',
    mimeType: 'image/tiff',
    buffer: Buffer.from('raster'),
  });

  // The projection is proposed from what the map covers and stated in a
  // sentence; nobody has to choose one to get a correct area.
  await expect(
    page.getByText(/Lambert azimuthal equal-area projection centred on this map/)
  ).toBeVisible();
  const crs = page.getByTestId('uae-equal-area-crs');
  await expect(crs).toHaveCount(0);

  // Anything PROJ understands can still be typed over it, under advanced.
  await page.getByRole('button', { name: /Change the default equal-area projection/ }).click();
  await expect(crs).toHaveValue(/^\+proj=laea /);
  await crs.fill('EPSG:4326');
  await expect(page.getByText(/does not preserve area/)).toBeVisible();
  await page.getByTestId('uae-use-proposed-crs').click();
  await expect(crs).toHaveValue(/^\+proj=laea /);

  await page.getByTestId('uae-areas-file').setInputFiles({
    name: 'oblast_regions.geojson',
    mimeType: 'application/json',
    buffer: Buffer.from('{}'),
  });
  await expect(page.getByText(/pixels in the reporting area$/)).toBeVisible();
  await page.getByTestId('uae-continue').click();

  // Nodata is excluded by default and says so; changing it is an advanced
  // option rather than a question everyone has to answer.
  await expect(page.getByText(/excluded from the sample/)).toBeVisible();
  await expect(page.getByTestId('uae-nodata-stratum')).toHaveCount(0);
  await page.getByTestId('uae-classes-advanced').click();
  await expect(page.getByTestId('uae-nodata-stratum')).toBeVisible();
});

test('a map that already covers the reporting area needs no boundary file', async ({
  appPage: page,
}) => {
  await mockCampaignAdmin(page);
  await startAreaEstimate(page);

  await page.getByTestId('uae-map-file').setInputFiles({
    name: 'cropmap_2025.tif',
    mimeType: 'image/tiff',
    buffer: Buffer.from('raster'),
  });

  // The census runs against the map's own extent, with nothing uploaded.
  await expect(
    page.getByText(/pixels in the reporting area, which is the whole map/)
  ).toBeVisible();

  // And the design solves from it, so the wizard reaches an activatable sample.
  await page.getByTestId('uae-continue').click();
  await page.getByTestId('uae-continue').click();
  await page.getByTestId('uae-prior-last_season_map').click();
  await page.getByTestId('uae-continue').click();
  await page.getByTestId('uae-target-class').selectOption({ label: 'Winter wheat' });
  await expect(page.getByRole('spinbutton', { name: /^Sample size for / })).toHaveCount(5);
  await expect(page.getByTestId('uae-activate')).toBeEnabled();
});

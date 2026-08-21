import { test, expect } from './fixtures/annotator-fixture';
import type { Page } from '@playwright/test';
import { MOCK_CAMPAIGN } from './fixtures/mock-data';

const SAMPLE_SET_ID = 99;
const SAMPLE_SET_NAME = 'Area estimation sample';

const set = (id: number, name: string, numTasks: number) => ({
  id,
  name,
  created_at: '2026-01-01T00:00:00Z',
  num_tasks: numTasks,
  num_labeled: 0,
});

/**
 * The settings page needs the plain campaign GET, which the shared fixture
 * only mocks in its /detailed form for the annotation page.
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

/** Walk the wizard as far as the named step, leaving it filled in. */
async function fillWizard(page: Page, upTo: 'prior' | 'design'): Promise<void> {
  await page.goto('/projects/7/campaigns/42/settings');
  await page.getByRole('tab', { name: 'Area Estimation' }).click();
  await page.getByTestId('uae-start').click();

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
  // Counting runs itself once there is a map and an area to count inside.
  await expect(page.getByText(/pixels in the study area/)).toBeVisible();

  await page.getByTestId('uae-continue').click();
  await page.getByTestId('uae-continue').click();
  await page.getByTestId('uae-target-class').selectOption({ label: 'Winter wheat' });
  await page.getByTestId('uae-continue').click();
  if (upTo === 'prior') return;

  await page.getByTestId('uae-prior-last_season_map').click();
  await page.getByTestId('uae-continue').click();
}

test('sizes a sample from the target precision and locks the set it lives in', async ({
  appPage: page,
}) => {
  const { created } = await mockCampaignAdmin(page);
  await fillWizard(page, 'design');

  // The map's five classes each became a reporting class, the unmapped value
  // did not, and the design meets the 5% default the target step starts on.
  const points = page.getByRole('spinbutton', { name: /^Sample points for / });
  await expect(points).toHaveCount(5);
  await expect(page.getByText(/Expected precision for the target class/)).toBeVisible();
  await expect(page.getByText(/^±[0-4]\.\d%$/)).toBeVisible();

  await page.getByTestId('uae-activate').click();
  await expect(page.getByText('Turn off area estimation')).toBeVisible();
  expect(created).toEqual([SAMPLE_SET_NAME]);

  // The sample set is closed to anything the design did not draw.
  await page.goto(`/projects/7/campaigns/42/tasks?taskSet=${SAMPLE_SET_ID}`);
  await expect(
    page.getByRole('heading', { name: 'Managed by the area estimation design' })
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add annotation tasks' })).toHaveCount(0);
  await expect(page.getByTitle('Rename set')).toHaveCount(0);
  await expect(page.getByTitle('Delete set')).toHaveCount(0);

  // Other sets keep their controls.
  await page.goto('/projects/7/campaigns/42/tasks?taskSet=1');
  await expect(page.getByTitle('Rename set')).toBeVisible();
});

test('refuses a held-out test set as a prior and offers a pilot instead', async ({
  appPage: page,
}) => {
  await mockCampaignAdmin(page);
  await fillWizard(page, 'prior');

  // Choosing it expands the card with why it cannot be used and what to do.
  await page.getByTestId('uae-prior-held_out_test_set').click();
  await expect(
    page.getByTestId('uae-prior-held_out_test_set').getByText(/Test sets are almost never/)
  ).toBeVisible();
  await page.getByTestId('uae-continue').click();
  await expect(page.getByTestId('uae-activate')).toBeDisabled();

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByTestId('uae-prior-none').click();
  await page.getByTestId('uae-continue').click();

  // No prior means a pilot: a flat budget per class, not a precision target.
  await expect(page.getByRole('heading', { name: 'Pilot sample' })).toBeVisible();
  await expect(page.getByTestId('uae-pilot-per-stratum')).toHaveValue('50');
  await expect(page.getByText(/points in the pilot/)).toBeVisible();
  await expect(page.getByTestId('uae-activate')).toBeEnabled();
});

import { test, expect } from './fixtures/annotator-fixture';
import type { ApiCapture } from './fixtures/annotator-fixture';
import { MOCK_CAMPAIGN_OPEN_MODE_FORMS } from './fixtures/mock-data';
import { drawPolygon, waitForCreate } from './fixtures/imagery-helpers';

type Page = import('@playwright/test').Page;

async function loadOpenModeForms(page: Page, api: ApiCapture): Promise<void> {
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    await route.fulfill({ json: MOCK_CAMPAIGN_OPEN_MODE_FORMS });
  });
  await page.reload();
  await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
  await page.locator('[title="Pan (P)"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(
    () => !!document.querySelector('[data-tour="minimap"]')?.getAttribute('data-center-lat'),
    undefined,
    { timeout: 10_000 }
  );
  api.clear();
}

const controls = (page: Page) => page.locator('[data-tour="controls"]');
const catalog = (page: Page) => page.locator('[data-testid="draft-catalog"]');
const createPosts = (api: ApiCapture) =>
  api.requests.filter((r) => r.method === 'POST' && r.pathname.endsWith('/create-annotation'));

const POLY: Array<[number, number]> = [
  [-50, -40],
  [50, -40],
  [0, 50],
];

test.describe('Open mode custom-field catalog', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadOpenModeForms(annotationPage, api);
  });

  test('custom fields stay hidden until a geometry is drawn', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('2'); // polygon label -> annotate
    await expect(controls(annotationPage)).toContainText('Labels');
    await expect(catalog(annotationPage)).toHaveCount(0);
    await expect(controls(annotationPage)).not.toContainText('Condition');
  });

  test('drawing opens the catalog without saving; answering + Save posts form_values', async ({
    annotationPage,
    api,
  }) => {
    await annotationPage.keyboard.press('2');
    await drawPolygon(annotationPage, POLY);

    // The catalog replaces the label list and nothing is POSTed yet.
    await expect(catalog(annotationPage)).toBeVisible();
    await expect(catalog(annotationPage)).toContainText('Condition');
    expect(createPosts(api)).toHaveLength(0);

    // Required field unanswered -> Save is refused and the catalog stays up.
    await annotationPage.locator('[data-testid="draft-save"]').click();
    await expect(catalog(annotationPage)).toBeVisible();
    expect(createPosts(api)).toHaveLength(0);

    // Answer the required category, then save.
    await catalog(annotationPage)
      .getByRole('button', { name: /Healthy/ })
      .click();
    await Promise.all([
      waitForCreate(annotationPage),
      annotationPage.locator('[data-testid="draft-save"]').click(),
    ]);

    const post = createPosts(api).at(-1);
    expect(post).toBeTruthy();
    expect(post!.body.label_id).toBe(2);
    expect(post!.body.form_values).toEqual({ '100': 1001 });

    // Catalog dismissed, labels back.
    await expect(catalog(annotationPage)).toHaveCount(0);
    await expect(controls(annotationPage)).toContainText('Labels');
  });

  test('the first required field is pre-selected after drawing', async ({ annotationPage }) => {
    await annotationPage.keyboard.press('2');
    await drawPolygon(annotationPage, POLY);
    await expect(catalog(annotationPage)).toBeVisible();

    // Field 100 (Condition) is required and first, so its cell carries the
    // active-field highlight ring; pressing a digit answers it immediately.
    await expect(annotationPage.locator('[data-form-field-id="100"]')).toHaveClass(/ring-2/);
    await annotationPage.keyboard.press('1'); // picks "Healthy"
    await expect(
      catalog(annotationPage)
        .getByRole('button', { name: /Healthy/ })
        .first()
    ).toContainText('✓');
  });

  test('closing with the x discards a draft whose required fields are unfilled', async ({
    annotationPage,
    api,
  }) => {
    await annotationPage.keyboard.press('2');
    await drawPolygon(annotationPage, POLY);
    await expect(catalog(annotationPage)).toBeVisible();

    await annotationPage.locator('[data-testid="draft-close"]').click();
    await expect(catalog(annotationPage)).toHaveCount(0);
    await expect(controls(annotationPage)).toContainText('Labels');
    expect(createPosts(api)).toHaveLength(0);
  });

  test('closing with the x saves the draft when the required fields are complete', async ({
    annotationPage,
    api,
  }) => {
    await annotationPage.keyboard.press('2');
    await drawPolygon(annotationPage, POLY);
    await catalog(annotationPage)
      .getByRole('button', { name: /Healthy/ })
      .click();

    await Promise.all([
      waitForCreate(annotationPage),
      annotationPage.locator('[data-testid="draft-close"]').click(),
    ]);

    const post = createPosts(api).at(-1);
    expect(post!.body.form_values).toEqual({ '100': 1001 });
    await expect(catalog(annotationPage)).toHaveCount(0);
  });

  test('Esc discards an incomplete draft (its geometry is not saved)', async ({
    annotationPage,
    api,
  }) => {
    await annotationPage.keyboard.press('2');
    await drawPolygon(annotationPage, POLY);
    await expect(catalog(annotationPage)).toBeVisible();

    await annotationPage.keyboard.press('Escape');
    await expect(catalog(annotationPage)).toHaveCount(0);
    expect(createPosts(api)).toHaveLength(0);
  });

  test('drawing a second polygon commits the first draft', async ({ annotationPage, api }) => {
    await annotationPage.keyboard.press('2');
    await drawPolygon(annotationPage, POLY);
    await catalog(annotationPage)
      .getByRole('button', { name: /Healthy/ })
      .click();

    // The next draw auto-saves the open draft (one POST) and opens a fresh one.
    await Promise.all([
      waitForCreate(annotationPage),
      drawPolygon(annotationPage, [
        [-30, -20],
        [30, -20],
        [0, 30],
      ]),
    ]);

    const posts = createPosts(api);
    expect(posts).toHaveLength(1);
    expect(posts[0].body.form_values).toEqual({ '100': 1001 });
    await expect(catalog(annotationPage)).toBeVisible();
  });

  test('drawing a second polygon discards an incomplete first draft', async ({
    annotationPage,
    api,
  }) => {
    await annotationPage.keyboard.press('2');
    await drawPolygon(annotationPage, POLY);
    await expect(catalog(annotationPage)).toBeVisible();

    // Second draw with the first still missing its required field: the first is
    // thrown away (no POST) and a fresh catalog opens for the new shape.
    await drawPolygon(annotationPage, [
      [-30, -20],
      [30, -20],
      [0, 30],
    ]);
    await expect(catalog(annotationPage)).toBeVisible();
    expect(createPosts(api)).toHaveLength(0);
  });
});

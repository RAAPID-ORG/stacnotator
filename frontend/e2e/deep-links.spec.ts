// The review pages' "View" links: a task opens in Tasks mode whatever work is
// left, an annotation opens in Explore, selected and framed.
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/annotator-fixture';
import {
  MOCK_CAMPAIGN_EXPLORE,
  EXPLORE_ANN_NE_FLAGGED,
  EXPLORE_ANN_SW_POLYGON,
  TASK_3,
  TASK_4,
} from './fixtures/mock-data';
import { routeTaskList } from './fixtures/task-summary';
import { waitForMinimapCenter } from './fixtures/imagery-helpers';

const controls = (page: Page) => page.locator('[data-tour="controls"]');
const annotate = '/projects/7/campaigns/42/annotate';

test('a task link opens the task when the viewer has nothing left to answer', async ({
  annotationPage,
}) => {
  await routeTaskList(annotationPage, () => ({ campaign_id: 42, tasks: [TASK_3, TASK_4] }));
  await annotationPage.goto(`${annotate}?task=${TASK_3.id}&review=true`);

  await expect(annotationPage.getByTestId('review-list')).toBeVisible({ timeout: 15_000 });
  await waitForMinimapCenter(annotationPage, { lat: 50.3, lon: 30.9 }, 'task centre');
});

test('an annotation link selects the annotation and frames it', async ({ annotationPage }) => {
  await annotationPage.route('**/api/campaigns/*/detailed', (route) =>
    route.fulfill({ json: MOCK_CAMPAIGN_EXPLORE })
  );
  await annotationPage.goto(
    `${annotate}?mode=explore&lat=50.2&lon=30.2&annotation=${EXPLORE_ANN_SW_POLYGON.id}`
  );

  await expect(controls(annotationPage)).toContainText(
    `Selected annotation #${EXPLORE_ANN_SW_POLYGON.id}`,
    { timeout: 15_000 }
  );
  await waitForMinimapCenter(annotationPage, { lat: 50.2, lon: 30.2 }, 'annotation centre');
});

test('an annotation link carries the table filters, so W steps through the same list', async ({
  annotationPage: page,
}) => {
  await page.route('**/api/campaigns/*/detailed', (route) =>
    route.fulfill({ json: MOCK_CAMPAIGN_EXPLORE })
  );
  await page.goto(
    `${annotate}?mode=explore&lat=50.2&lon=30.2&annotation=${EXPLORE_ANN_SW_POLYGON.id}` +
      '&position=2&labels=1,2&sort=time-desc&flagged=true'
  );
  await expect(controls(page).getByTestId('browse-position')).toHaveText('3 of 3', {
    timeout: 15_000,
  });

  const [request] = await Promise.all([
    page.waitForRequest((r) => /\/annotations\?.*offset=1/.test(r.url())),
    page.keyboard.press('w'),
  ]);
  const query = new URL(request.url()).searchParams;
  expect(query.getAll('label_ids')).toEqual(['1', '2']);
  expect(query.get('sort')).toBe('time-desc');
  expect(query.get('flagged_only')).toBe('true');
  await expect(controls(page).getByTestId('browse-position')).toHaveText('2 of 3');
  await expect(controls(page)).toContainText(`Selected annotation #${EXPLORE_ANN_NE_FLAGGED.id}`);
});

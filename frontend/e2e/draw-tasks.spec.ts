/**
 * Draw tasks: the campaign's tasks are answered by drawing shapes around each
 * location instead of labelling it. Task mode carries the drawing tools, every
 * shape is saved against the current task, and Done finishes the task.
 */
import { test, expect, type CapturedRequest } from './fixtures/annotator-fixture';
import { drawPolygon, waitForCreate } from './fixtures/imagery-helpers';
import { MOCK_CAMPAIGN } from './fixtures/mock-data';

const lastPost = (requests: CapturedRequest[], suffix: string) =>
  [...requests].reverse().find((r) => r.method === 'POST' && r.pathname.endsWith(suffix));

test.describe('Draw tasks', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await annotationPage.route('**/api/campaigns/*/detailed', async (route) => {
      await route.fulfill({
        json: { ...MOCK_CAMPAIGN, settings: { ...MOCK_CAMPAIGN.settings, task_output: 'draw' } },
      });
    });
    await annotationPage.reload();
    await annotationPage.getByRole('button', { name: 'Done' }).waitFor({ timeout: 15_000 });
    api.clear();
  });

  test('a shape drawn on a task is saved against it, and Done finishes the task', async ({
    annotationPage,
    api,
  }) => {
    await expect(annotationPage.locator('button', { hasText: /^Submit$/ })).toHaveCount(0);

    await annotationPage.keyboard.press('1');
    await Promise.all([
      waitForCreate(annotationPage),
      drawPolygon(annotationPage, [
        [-50, -40],
        [50, -40],
        [0, 50],
      ]),
    ]);
    const shape = lastPost(api.requests, '/create-annotation')!.body;
    expect(shape.output_of_task_id).toBe(100);
    expect(shape.origin_task_id).toBeUndefined();

    await Promise.all([
      annotationPage.waitForResponse((r) => r.url().endsWith('/100/annotate')),
      annotationPage.getByRole('button', { name: 'Done' }).click(),
    ]);
    const finish = lastPost(api.requests, '/annotate')!.body;
    expect(finish.label_id).toBeNull();
    expect(finish.outcome).toBe('drawn');
  });
});

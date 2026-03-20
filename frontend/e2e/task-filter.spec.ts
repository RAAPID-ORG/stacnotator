/**
 * Tests for task status filtering.
 *
 * The filter controls which tasks are visible in the navigation.
 * When the filter changes, the visible task list updates and the
 * current task resets to the first matching task.
 */
import { test, expect } from './fixtures/annotator-fixture';
import { ALL_TASKS, TASK_1, TASK_2, TASK_3, TASK_4, TASK_5 } from './fixtures/mock-data';

test.describe('Task Status Filtering', () => {
  test('default filter shows only pending tasks assigned to current user', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    // Default filter: assignedTo=[current user], statuses=['pending']
    // Tasks 1 and 2 are pending and assigned to our user
    // The point number display should show one of these

    // The GoTo input should show "1" (first pending task)
    const gotoInput = page.locator('input[type="number"]');
    await expect(gotoInput).toHaveValue('1');
  });

  test('submitting an annotation advances to the next pending task', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    // On task 1 (pending). Submit it.
    await page.locator('button', { hasText: 'Forest' }).first().click();
    await page.locator('button', { hasText: 'Submit' }).first().click();

    // Wait for submit + auto-advance to settle (GoTo shows next task)
    const gotoInput = page.locator('input[type="number"]');
    await expect(gotoInput).toHaveValue('2', { timeout: 5000 });

    // The annotate request should have targeted task 1 (id=100)
    const req = api.requests.find(
      (r) => r.method === 'POST' && r.pathname.endsWith('/annotate')
    );
    expect(req).toBeDefined();
    expect(req!.pathParams.annotation_task_id).toBe('100');
  });
});

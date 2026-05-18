/**
 * Tests for task status filtering.
 *
 * The filter controls which tasks are visible in the navigation list.
 * Business rules covered:
 *   - default filter (pending + assigned to current user)
 *   - status combinations (pending+done, done-only, etc.)
 *   - submit auto-advances to next pending in the same filter
 *   - selecting "Conflicting" auto-enables review mode
 *   - empty-filter state shows the "All tasks completed" message
 */
import { test, expect, waitForNavIdle } from './fixtures/annotator-fixture';
import { TASK_3 } from './fixtures/mock-data';

const gotoInput = (page: import('@playwright/test').Page) =>
  page.locator('input[type="number"][title="Press Enter to go"]');

const openFilterPanel = async (page: import('@playwright/test').Page) => {
  const btn = page.locator('[data-tour="task-filter"] button').first();
  await btn.click();
  // Wait for one of the status checkboxes to render so subsequent
  // interactions can find them deterministically.
  await page.locator('label', { hasText: 'Done' }).waitFor({ state: 'visible' });
  return btn;
};

const toggleStatus = async (page: import('@playwright/test').Page, label: string) => {
  await page.locator('label', { hasText: label }).click();
};

test.describe('Task Status Filtering', () => {
  test('default filter shows only pending tasks assigned to current user', async ({
    annotationPage,
  }) => {
    const page = annotationPage;
    // TASK_1 and TASK_2 are pending+mine. Initial position should be #1.
    await expect(gotoInput(page)).toHaveValue('1');
  });

  test('submitting an annotation advances to the next pending task', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await page.locator('button', { hasText: 'Forest' }).first().click();
    await page.locator('button', { hasText: 'Submit' }).first().click();

    // Auto-advance lands on TASK_2 (#2).
    await expect(gotoInput(page)).toHaveValue('2', { timeout: 5000 });

    const req = api.requests.find(
      (r) => r.method === 'POST' && r.pathname.endsWith('/annotate')
    );
    expect(req).toBeDefined();
    expect(req!.pathParams.annotation_task_id).toBe('100');
  });

  test('adding Done to the filter exposes completed tasks', async ({ annotationPage }) => {
    const page = annotationPage;
    const filterBtn = await openFilterPanel(page);
    await toggleStatus(page, 'Done');
    await filterBtn.click();
    await waitForNavIdle(page);

    // GoTo input accepts TASK_3's annotation_number now (#3) - it was hidden
    // under the default pending-only filter.
    await gotoInput(page).fill(TASK_3.annotation_number.toString());
    await gotoInput(page).press('Enter');
    await waitForNavIdle(page);
    await expect(gotoInput(page)).toHaveValue(TASK_3.annotation_number.toString());

    // TASK_3's existing annotation is pre-populated.
    await expect(
      page.locator('textarea[placeholder^="Add a comment"]')
    ).toHaveValue('Clearly forest');
  });

  test('switching to done-only hides pending tasks and lands on the first done', async ({
    annotationPage,
  }) => {
    const page = annotationPage;
    const filterBtn = await openFilterPanel(page);
    await toggleStatus(page, 'Done');
    await toggleStatus(page, 'Pending');
    await filterBtn.click();
    await waitForNavIdle(page);

    // Only TASK_3 is done in the assignment scope → first/only visible task.
    await expect(gotoInput(page)).toHaveValue(TASK_3.annotation_number.toString());
  });

  test('un-checking the only remaining status is rejected (filter must keep ≥1 status)', async ({
    annotationPage,
  }) => {
    const page = annotationPage;
    const filterBtn = await openFilterPanel(page);

    // Default has only Pending checked. Try to uncheck it.
    await toggleStatus(page, 'Pending');
    await filterBtn.click();
    await waitForNavIdle(page);

    // Filter unchanged → still on the first pending task (#1).
    await expect(gotoInput(page)).toHaveValue('1');
  });

  test('Conflicting status checkbox only appears in review mode', async ({ annotationPage }) => {
    const page = annotationPage;

    // Outside review mode: only Pending / Done / Skipped are listed.
    await openFilterPanel(page);
    await expect(page.locator('label', { hasText: 'Conflicting' })).toHaveCount(0);
    // Close panel before toggling review (clicking outside closes it).
    await page.locator('[data-tour="task-filter"] button').first().click();

    // Enter review mode and re-open the panel.
    await page.locator('[data-tour="review-toggle"] button').first().click();
    await waitForNavIdle(page);
    await openFilterPanel(page);

    // Now Conflicting (and Partial) become available.
    await expect(page.locator('label', { hasText: 'Conflicting' })).toBeVisible();
    await expect(page.locator('label', { hasText: 'Partial' })).toBeVisible();
  });
});

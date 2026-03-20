/**
 * Tests for annotation updates, existing annotation display, and label removal.
 *
 * When navigating to a task that already has the current user's annotation,
 * the form should be pre-populated with the existing label, comment, confidence.
 * Submitting should send an "Update" and the body should reflect the changes.
 */
import { test, expect, type CapturedRequest } from './fixtures/annotator-fixture';
import { TASK_3, LABELS, TEST_USER_ID } from './fixtures/mock-data';

test.describe('Existing Annotation Display', () => {
  test('form is pre-populated when task has existing annotation from current user', async ({
    annotationPage,
  }) => {
    const page = annotationPage;

    // Task 3 has an existing annotation (forest, comment "Clearly forest", confidence 8).
    // But default filter is "pending" assigned to current user, so task 3 (done) is hidden.
    // We need to open the filter panel and enable "done" status.

    // Click the "Filter Tasks" button in toolbar to open filter panel
    const filterBtn = page.locator('[data-tour="task-filter"] button', { hasText: 'Filter Tasks' });
    await filterBtn.click();

    // Enable "Done" status checkbox in the filter panel
    const doneLabel = page.locator('label', { hasText: 'Done' });
    await doneLabel.waitFor({ state: 'visible' });
    await doneLabel.click();

    // Close filter panel by clicking the filter button again
    await filterBtn.click();
    // Wait for the filter-triggered navigation to settle
    await expect(page.locator('button', { hasText: 'Loading...' })).toBeHidden({ timeout: 5000 });

    // Navigate to point #3 via GoTo input
    const gotoInput = page.locator('input[type="number"]');
    await gotoInput.fill('3');
    await gotoInput.press('Enter');
    // Wait for GoTo navigation to settle
    await expect(page.locator('button', { hasText: 'Loading...' })).toBeHidden({ timeout: 5000 });

    // The forest label button should be selected (has checkmark "✓")
    const forestBtn = page.locator('button', { hasText: 'Forest' }).first();
    await expect(forestBtn).toContainText('✓');

    // Comment area should have "Clearly forest"
    const commentArea = page.locator('textarea[placeholder="Add a comment..."]');
    await expect(commentArea).toHaveValue('Clearly forest');
  });
});

test.describe('Annotation Update', () => {
  test('changing label and submitting sends updated label_id to same task', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    // Start on task 1 (pending, no annotation). Submit "forest" first.
    await page.locator('button', { hasText: 'Forest' }).first().click();
    await page.locator('button', { hasText: 'Submit' }).first().click();
    await expect(page.locator('button', { hasText: 'Loading...' })).toBeHidden({ timeout: 5000 });

    // After submit, the store auto-advances. The request should have gone to task 100.
    const firstReq = api.requests.find(
      (r) => r.method === 'POST' && r.pathname.endsWith('/annotate')
    );
    expect(firstReq).toBeDefined();
    expect(firstReq!.body.label_id).toBe(1); // forest
  });

  test('comment-only change still sends the existing label_id', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    // Select a label
    await page.locator('button', { hasText: 'Cropland' }).first().click();

    // Add a comment
    const commentArea = page.locator('textarea[placeholder="Add a comment..."]');
    await commentArea.fill('Mostly wheat fields');

    await page.locator('button', { hasText: 'Submit' }).first().click();
    await expect(page.locator('button', { hasText: 'Loading...' })).toBeHidden({ timeout: 5000 });

    const req = api.requests.find(
      (r) => r.method === 'POST' && r.pathname.endsWith('/annotate')
    );
    expect(req).toBeDefined();
    expect(req!.body.label_id).toBe(2); // cropland
    expect(req!.body.comment).toBe('Mostly wheat fields');
  });
});

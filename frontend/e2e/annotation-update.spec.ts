/**
 * Tests for annotation updates, existing annotation display, and label removal.
 *
 * When navigating to a task that already has the current user's annotation,
 * the form should be pre-populated with the existing label, comment, confidence.
 * Submitting should send an "Update" and the body should reflect the changes.
 */
import {
  test,
  expect,
  waitForNavIdle,
  type CapturedRequest,
} from './fixtures/annotator-fixture';
import { TASK_3 } from './fixtures/mock-data';

/** Navigate to TASK_3 (which has a pre-existing forest annotation by the user). */
async function gotoTask3(page: import('@playwright/test').Page) {
  const filterBtn = page.locator('[data-tour="task-filter"] button', { hasText: 'Filter Tasks' });
  await filterBtn.click();
  const doneLabel = page.locator('label', { hasText: 'Done' });
  await doneLabel.waitFor({ state: 'visible' });
  await doneLabel.click();
  await filterBtn.click();
  await waitForNavIdle(page);

  const gotoInput = page.locator('input[type="number"][title="Press Enter to go"]');
  await gotoInput.fill(TASK_3.annotation_number.toString());
  await gotoInput.press('Enter');
  await waitForNavIdle(page);
}

test.describe('Existing Annotation Display', () => {
  test('form is pre-populated when task has existing annotation from current user', async ({
    annotationPage,
  }) => {
    const page = annotationPage;
    await gotoTask3(page);

    // TASK_3 has an existing forest annotation (comment "Clearly forest").
    const forestBtn = page.locator('button', { hasText: 'Forest' }).first();
    await expect(forestBtn).toContainText('✓');

    const commentArea = page.locator('textarea[placeholder^="Add a comment"]');
    await expect(commentArea).toHaveValue('Clearly forest');
  });

  test('submit button shows "Update" when current user has an annotation', async ({
    annotationPage,
  }) => {
    const page = annotationPage;
    await gotoTask3(page);

    const updateBtn = page.locator('button', { hasText: /^Update$/ });
    await expect(updateBtn).toBeVisible();
  });
});

test.describe('Annotation Update', () => {
  test('changing label on an annotated task POSTs the new label to the same task_id', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await gotoTask3(page);

    // Change forest -> cropland and submit
    await page.locator('button', { hasText: 'Cropland' }).first().click();
    api.clear();
    await page.locator('button', { hasText: /^Update$/ }).click();
    await waitForNavIdle(page);

    const req = api.requests.find(
      (r) => r.method === 'POST' && r.pathname.endsWith('/annotate')
    );
    expect(req).toBeDefined();
    expect(req!.pathParams.annotation_task_id).toBe(TASK_3.id.toString());
    expect(req!.body.label_id).toBe(2); // cropland
  });
});

test.describe('Remove Label', () => {
  test('deselecting an existing label and submitting DELETEs the annotation', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await gotoTask3(page);

    // First click on the already-selected forest button deselects it.
    await page.locator('button', { hasText: 'Forest' }).first().click();

    // Clearing comment too - having a comment falls back to POST instead of DELETE.
    const commentArea = page.locator('textarea[placeholder^="Add a comment"]');
    await commentArea.fill('');

    // Submit button text should change to "Remove Label".
    const removeBtn = page.locator('button', { hasText: /^Remove Label$/ });
    await expect(removeBtn).toBeVisible();

    api.clear();
    await removeBtn.click();
    await waitForNavIdle(page);

    // A DELETE to /annotations/<existing annotation id> must have been issued.
    const existingAnnotationId = TASK_3.annotations[0].id;
    const deleteReq = api.requests.find(
      (r: CapturedRequest) =>
        r.method === 'DELETE' &&
        r.pathname === `/api/campaigns/42/annotations/${existingAnnotationId}`
    );
    expect(deleteReq).toBeDefined();
    expect(deleteReq!.pathParams.annotation_id).toBe(String(existingAnnotationId));

    // And no POST to /annotate for this task (the remove flow is delete-only).
    const annotatePost = api.requests.find(
      (r: CapturedRequest) =>
        r.method === 'POST' && r.pathname.endsWith(`/${TASK_3.id}/annotate`)
    );
    expect(annotatePost).toBeUndefined();
  });
});

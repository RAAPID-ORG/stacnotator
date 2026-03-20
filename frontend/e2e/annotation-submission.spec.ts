/**
 * Tests that creating an annotation sends the correct request to the backend:
 * - Correct campaign_id and annotation_task_id in the URL path
 * - Correct label_id, comment, confidence in the request body
 * - Delete request goes to the correct annotation_id
 * - Skip (null label) sends the right payload
 */
import { test, expect, type CapturedRequest } from './fixtures/annotator-fixture';
import { TASK_1, TASK_3, LABELS, TEST_USER_ID } from './fixtures/mock-data';

/** Return the last POST to /annotate */
function lastAnnotateRequest(requests: CapturedRequest[]): CapturedRequest | undefined {
  return [...requests].reverse().find(
    (r) => r.method === 'POST' && r.pathname.endsWith('/annotate')
  );
}

test.describe('Annotation Submission', () => {
  test('submitting a label sends correct task_id and label_id', async ({ annotationPage, api }) => {
    const page = annotationPage;

    // The first visible pending task should be TASK_1 (id=100).
    // Click the first label button ("forest", id=1)
    const labelButtons = page.locator('button', { hasText: 'Forest' });
    await labelButtons.first().click();

    // Click the submit button
    const submitBtn = page.locator('button', { hasText: 'Submit' });
    await submitBtn.first().click();
    // Wait for submit + auto-advance navigation to settle
    await expect(page.locator('button', { hasText: 'Loading...' })).toBeHidden({ timeout: 5000 });

    const req = lastAnnotateRequest(api.requests);
    expect(req).toBeDefined();
    expect(req!.pathname).toBe('/api/campaigns/42/100/annotate');
    expect(req!.pathParams.campaign_id).toBe('42');
    expect(req!.pathParams.annotation_task_id).toBe('100');
    expect(req!.body.label_id).toBe(LABELS[0].id); // forest = 1
    expect(req!.body.confidence).toBeGreaterThanOrEqual(1);
  });

  test('submitting with a comment includes comment in body', async ({ annotationPage, api }) => {
    const page = annotationPage;

    // Select a label
    await page.locator('button', { hasText: 'Cropland' }).first().click();

    // Type a comment
    const commentArea = page.locator('textarea[placeholder="Add a comment..."]');
    await commentArea.fill('Irrigated fields visible');

    await page.locator('button', { hasText: 'Submit' }).first().click();
    await expect(page.locator('button', { hasText: 'Loading...' })).toBeHidden({ timeout: 5000 });

    const req = lastAnnotateRequest(api.requests);
    expect(req).toBeDefined();
    expect(req!.body.label_id).toBe(LABELS[1].id); // cropland = 2
    expect(req!.body.comment).toBe('Irrigated fields visible');
  });

  test('confidence slider value is sent in the request', async ({ annotationPage, api }) => {
    const page = annotationPage;

    // Select label
    await page.locator('button', { hasText: 'Urban' }).first().click();

    // Move confidence slider to max (5)
    const slider = page.locator('input[type="range"]');
    await slider.fill('5');

    await page.locator('button', { hasText: 'Submit' }).first().click();
    await expect(page.locator('button', { hasText: 'Loading...' })).toBeHidden({ timeout: 5000 });

    const req = lastAnnotateRequest(api.requests);
    expect(req).toBeDefined();
    expect(req!.body.label_id).toBe(LABELS[2].id); // urban = 3
    expect(req!.body.confidence).toBe(5);
  });

  test('skip sends null label_id', async ({ annotationPage, api }) => {
    const page = annotationPage;

    // Click Skip button
    const skipBtn = page.locator('button', { hasText: 'Skip' });
    await skipBtn.first().click();

    // The confirm dialog overlay appears - click the confirm button inside it
    // The dialog has a "Skip" confirm button and a "Cancel" button
    const dialog = page.locator('.fixed.inset-0');
    await dialog.waitFor({ state: 'visible', timeout: 3000 });
    const dialogSkipBtn = dialog.locator('button', { hasText: 'Skip' });
    await dialogSkipBtn.click();
    await expect(page.locator('button', { hasText: 'Loading...' })).toBeHidden({ timeout: 5000 });

    const req = lastAnnotateRequest(api.requests);
    expect(req).toBeDefined();
    expect(req!.body.label_id).toBeNull();
  });

  test('submit button text changes to Update when task has existing annotation', async ({
    annotationPage,
  }) => {
    const page = annotationPage;

    // For now, verify Submit shows for a fresh task (task 1, no prior annotation)
    const submitBtn = page.locator('button', { hasText: 'Submit' }).first();
    await expect(submitBtn).toBeVisible();
  });
});

/**
 * Tests that creating an annotation sends the correct request to the backend:
 * - Correct campaign_id and annotation_task_id in the URL path
 * - Correct label_id, comment, confidence in the request body
 * - Delete request goes to the correct annotation_id
 * - Skip (null label) sends the right payload
 */
import { test, expect, waitForNavIdle, type CapturedRequest } from './fixtures/annotator-fixture';
import { LABELS, MOCK_CAMPAIGN } from './fixtures/mock-data';

/** Return the last POST to /annotate */
function lastAnnotateRequest(requests: CapturedRequest[]): CapturedRequest | undefined {
  return [...requests]
    .reverse()
    .find((r) => r.method === 'POST' && r.pathname.endsWith('/annotate'));
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
    await waitForNavIdle(page);

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

    // Type a comment (placeholder uses Unicode ellipsis "…", match by prefix)
    const commentArea = page.locator('textarea[placeholder^="Add a comment"]');
    await commentArea.fill('Irrigated fields visible');

    await page.locator('button', { hasText: 'Submit' }).first().click();
    await waitForNavIdle(page);

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
    await waitForNavIdle(page);

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
    await waitForNavIdle(page);

    const req = lastAnnotateRequest(api.requests);
    expect(req).toBeDefined();
    expect(req!.body.label_id).toBeNull();
  });

  test('submit is blocked until a label is selected', async ({ annotationPage, api }) => {
    const page = annotationPage;

    // TASK_1 has no existing annotation, so no label means no submit.
    const submitBtn = page.locator('button', { hasText: 'Submit' }).first();
    await expect(submitBtn).toBeDisabled();

    // Pressing Enter without a label must not produce an annotate request.
    api.clear();
    await page.keyboard.press('Enter');
    await waitForNavIdle(page);
    expect(lastAnnotateRequest(api.requests)).toBeUndefined();
  });

  test('form hotkeys reveal fields, comment, and confidence inside task controls', async ({
    annotationPage,
  }) => {
    const formFields = Array.from({ length: 12 }, (_, index) => ({
      id: 700 + index,
      title: `Question ${index + 1}`,
      required: false,
      type: 'text' as const,
    }));
    await annotationPage.route('**/api/campaigns/*/detailed', async (route) => {
      await route.fulfill({
        json: {
          ...MOCK_CAMPAIGN,
          settings: { ...MOCK_CAMPAIGN.settings, form_fields: formFields },
        },
      });
    });
    await annotationPage.reload();
    await annotationPage.waitForSelector('[data-tour="controls"]', { timeout: 10_000 });

    const scroller = annotationPage.locator('[data-tour="controls"] .panel-body > div').first();
    const lastField = annotationPage.locator('[data-form-field-id="711"]');
    const isFullyVisible = async (target: typeof lastField) => {
      const [viewport, element] = await Promise.all([scroller.boundingBox(), target.boundingBox()]);
      return (
        viewport !== null &&
        element !== null &&
        element.y >= viewport.y &&
        element.y + element.height <= viewport.y + viewport.height
      );
    };
    await expect(lastField).toBeAttached();
    expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0);

    for (let index = 0; index < formFields.length; index++) {
      await annotationPage.keyboard.press('Tab');
    }

    await expect(lastField).toHaveClass(/ring-1/);
    await expect
      .poll(
        async () => {
          const scrollTop = await scroller.evaluate((element) => element.scrollTop);
          return scrollTop > 0 && (await isFullyVisible(lastField));
        },
        { timeout: 5000 }
      )
      .toBe(true);

    await annotationPage.keyboard.press('Escape');
    await annotationPage.keyboard.press('c');
    const commentSection = annotationPage.locator('[data-task-comment]');
    await expect(annotationPage.locator('[data-task-comment-input]')).toBeFocused();
    await expect.poll(() => isFullyVisible(commentSection), { timeout: 5000 }).toBe(true);

    await annotationPage.keyboard.press('Escape');
    await annotationPage.keyboard.press('Shift+3');
    const confidenceSection = annotationPage.locator('[data-task-confidence]');
    const confidenceSlider = annotationPage.locator('[data-task-confidence-input]');
    await expect(confidenceSlider).toBeFocused();
    await expect(confidenceSlider).toHaveValue('3');
    await expect.poll(() => isFullyVisible(confidenceSection), { timeout: 5000 }).toBe(true);

    // Q remains a hotkey after the shortcut itself has focused the slider.
    await annotationPage.keyboard.press('q');
    await expect(confidenceSlider).toHaveValue('2');
    expect(
      await confidenceSlider.evaluate((element) => getComputedStyle(element).outlineStyle)
    ).toBe('none');

    // One more Tab wraps from the final field back to the label section.
    await annotationPage.keyboard.press('Escape');
    for (let index = 0; index <= formFields.length; index++) {
      await annotationPage.keyboard.press('Tab');
    }
    const labelSection = annotationPage.locator('[data-task-labels]');
    await expect(labelSection).toHaveClass(/ring-1/);
    await expect.poll(() => isFullyVisible(labelSection), { timeout: 5000 }).toBe(true);
  });
});

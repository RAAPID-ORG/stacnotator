/**
 * Tests for the two "marker" submit paths:
 *   - Authoritative submit: only available to users flagged
 *     `is_authorative_reviewer` on the campaign. Goes through a confirm
 *     dialog and POSTs `is_authoritative: true` in the body.
 *   - Flag for review: any user can flag their own annotation. The submit
 *     body must include `flagged_for_review: true` and the typed
 *     `flag_comment`.
 */
import {
  test,
  expect,
  waitForNavIdle,
  elevateToAuthoritativeReviewer,
  type CapturedRequest,
} from './fixtures/annotator-fixture';

function lastAnnotateRequest(requests: CapturedRequest[]): CapturedRequest | undefined {
  return [...requests]
    .reverse()
    .find((r) => r.method === 'POST' && r.pathname.endsWith('/annotate'));
}

test.describe('Authoritative submit', () => {
  test('button is hidden when the current user is not an authoritative reviewer', async ({
    annotationPage,
  }) => {
    // Default mock: current user has is_authorative_reviewer=false.
    await expect(
      annotationPage.locator('button', { hasText: 'Submit authoritative' })
    ).toHaveCount(0);
  });

  test('authoritative submit POSTs is_authoritative=true after the confirm dialog', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await elevateToAuthoritativeReviewer(page);

    // Button is visible only after elevation.
    const authBtn = page.locator('button', { hasText: 'Submit authoritative' });
    await expect(authBtn).toBeVisible();

    // Pick a label so the auth button is enabled, then trigger it.
    await page.locator('button', { hasText: 'Forest' }).first().click();
    api.clear();
    await authBtn.click();

    // The confirm dialog appears with the dangerous confirm button.
    const dialog = page.locator('.fixed.inset-0');
    await dialog.waitFor({ state: 'visible', timeout: 3000 });
    await dialog.locator('button', { hasText: 'Submit Authoritative' }).click();
    await waitForNavIdle(page);

    const req = lastAnnotateRequest(api.requests);
    expect(req).toBeDefined();
    expect(req!.pathParams.annotation_task_id).toBe('100');
    expect(req!.body.is_authoritative).toBe(true);
    expect(req!.body.label_id).toBe(1); // forest
  });

  test('cancelling the authoritative dialog does not POST', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;
    await elevateToAuthoritativeReviewer(page);

    await page.locator('button', { hasText: 'Forest' }).first().click();
    api.clear();
    await page.locator('button', { hasText: 'Submit authoritative' }).click();

    const dialog = page.locator('.fixed.inset-0');
    await dialog.waitFor({ state: 'visible', timeout: 3000 });
    await dialog.locator('button', { hasText: 'Cancel' }).click();
    // Dialog dismissal should not trigger any navigation; small idle wait.
    await waitForNavIdle(page);

    expect(lastAnnotateRequest(api.requests)).toBeUndefined();
  });
});

test.describe('Flag for review', () => {
  test('pressing F toggles the flag and reveals the flag-comment textarea', async ({
    annotationPage,
  }) => {
    const page = annotationPage;

    // The flag-comment textarea is not rendered until flagged_for_review=true.
    const flagComment = page.locator('textarea[placeholder^="Why are you flagging"]');
    await expect(flagComment).toHaveCount(0);

    await page.keyboard.press('f');
    await expect(flagComment).toBeVisible();

    // Toggling off hides it again.
    await page.keyboard.press('f');
    await expect(flagComment).toHaveCount(0);
  });

  test('submitting with the flag set sends flagged_for_review + flag_comment', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await page.locator('button', { hasText: 'Forest' }).first().click();
    await page.keyboard.press('f');
    await page
      .locator('textarea[placeholder^="Why are you flagging"]')
      .fill('Looks ambiguous from the True-Color view');
    api.clear();
    await page.locator('button', { hasText: 'Submit' }).first().click();
    await waitForNavIdle(page);

    const req = lastAnnotateRequest(api.requests);
    expect(req).toBeDefined();
    expect(req!.body.flagged_for_review).toBe(true);
    expect(req!.body.flag_comment).toBe('Looks ambiguous from the True-Color view');
    expect(req!.body.label_id).toBe(1); // forest
  });

  test('unflagging before submit drops both flag fields from the body', async ({
    annotationPage,
    api,
  }) => {
    const page = annotationPage;

    await page.locator('button', { hasText: 'Forest' }).first().click();
    await page.keyboard.press('f');
    await page
      .locator('textarea[placeholder^="Why are you flagging"]')
      .fill('Will undo this');

    // Toggle the flag off via the button. We can't press F again here -
    // focus is on the flag textarea, so F would just insert the letter.
    // The button's title varies with state; both forms include
    // "reviewer attention".
    await page.locator('button[title*="reviewer attention"]').click();

    api.clear();
    await page.locator('button', { hasText: 'Submit' }).first().click();
    await waitForNavIdle(page);

    const req = lastAnnotateRequest(api.requests);
    expect(req).toBeDefined();
    expect(req!.body.flagged_for_review).toBe(false);
    // When not flagged the comment is forced to null regardless of what was typed.
    expect(req!.body.flag_comment).toBeNull();
  });
});

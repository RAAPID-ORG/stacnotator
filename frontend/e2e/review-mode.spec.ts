/**
 * Tests for review-mode behavior: the ReviewAnnotationList card group that
 * appears inside the controls when review mode is on, including:
 *   - one card per annotator for the current task
 *   - "You" / display-name resolution
 *   - "Conflict" badge on conflicting tasks
 *   - authoritative (🗲) and flagged-for-review (flag icon + comment) markers
 *   - review list is hidden when review mode is off
 */
import { test, expect, waitForNavIdle } from './fixtures/annotator-fixture';
import { TASK_3, TASK_4, TASK_5 } from './fixtures/mock-data';

const gotoInput = (page: import('@playwright/test').Page) =>
  page.locator('input[type="number"][title="Press Enter to go"]');

const enterReviewMode = async (page: import('@playwright/test').Page) => {
  await page.locator('[data-tour="review-toggle"] button').first().click();
  await waitForNavIdle(page);
};

/**
 * Step through the visible task list with `s` until the GoTo input reads
 * the target annotation_number. Used instead of typing into the GoTo input
 * because that field is bounded by visibleTasks.length, not the highest
 * annotation_number - so e.g. GoTo 5 silently fails when the filter shows
 * only 3 tasks.
 */
const navigateTo = async (page: import('@playwright/test').Page, annotationNumber: number) => {
  for (let i = 0; i < 10; i++) {
    if ((await gotoInput(page).inputValue()) === String(annotationNumber)) return;
    await page.keyboard.press('s');
    await waitForNavIdle(page);
  }
  throw new Error(`Failed to reach annotation #${annotationNumber}`);
};

test.describe('Review-mode list display', () => {
  test('review list shows one card per annotator with names and labels', async ({
    annotationPage,
  }) => {
    const page = annotationPage;
    await enterReviewMode(page);
    await navigateTo(page, TASK_5.annotation_number);

    const reviewList = page.getByTestId('review-list');
    await expect(reviewList).toBeVisible();

    // TASK_5 has two annotators: current user (Forest) and Other User (Cropland).
    // The current user resolves to "You"; the other user uses their display_name.
    await expect(reviewList.getByText('You', { exact: false })).toBeVisible();
    await expect(reviewList.getByText('Other User')).toBeVisible();
    await expect(reviewList.getByText('Forest')).toBeVisible();
    await expect(reviewList.getByText('Cropland')).toBeVisible();
  });

  test('conflicting tasks render the Conflict badge inside the review list', async ({
    annotationPage,
  }) => {
    const page = annotationPage;
    await enterReviewMode(page);
    await navigateTo(page, TASK_5.annotation_number);

    await expect(
      page.getByTestId('review-list').getByText('Conflict', { exact: true })
    ).toBeVisible();
  });

  test('non-conflicting tasks do not render the Conflict badge', async ({ annotationPage }) => {
    const page = annotationPage;
    await enterReviewMode(page);
    await navigateTo(page, TASK_3.annotation_number);

    const reviewList = page.getByTestId('review-list');
    await expect(reviewList).toBeVisible();
    // TASK_3 is `done`, not conflicting → no badge.
    await expect(reviewList.getByText('Conflict', { exact: true })).toHaveCount(0);
  });

  test('authoritative annotation gets the 🗲 marker in the review list', async ({
    annotationPage,
  }) => {
    const page = annotationPage;
    await enterReviewMode(page);
    await navigateTo(page, TASK_5.annotation_number);

    // TASK_5's other-user annotation is marked authoritative in the mock.
    const reviewList = page.getByTestId('review-list');
    await expect(reviewList.getByTitle('Authoritative')).toBeVisible();
    await expect(reviewList).toContainText('🗲');
  });

  test('flagged annotation renders the flag icon and surfaces the flag comment', async ({
    annotationPage,
  }) => {
    const page = annotationPage;
    await enterReviewMode(page);
    await navigateTo(page, TASK_5.annotation_number);

    // Current user's annotation on TASK_5 has flag_comment "Unsure about this one".
    const reviewList = page.getByTestId('review-list');
    await expect(reviewList.getByTitle('Unsure about this one')).toBeVisible();
    await expect(reviewList.getByText('Unsure about this one')).toBeVisible();
  });

  test('tasks with assignments but no annotations show a "Not labeled yet" placeholder', async ({
    annotationPage,
  }) => {
    const page = annotationPage;
    await enterReviewMode(page);
    await navigateTo(page, TASK_4.annotation_number); // skipped, no annotations

    // Skipped tasks still get a placeholder card because the assignment exists.
    const reviewList = page.getByTestId('review-list');
    await expect(reviewList).toBeVisible();
    await expect(reviewList.getByText('Not labeled yet')).toBeVisible();
  });

  test('exiting review mode hides the review list', async ({ annotationPage }) => {
    const page = annotationPage;
    await enterReviewMode(page);
    await expect(page.getByTestId('review-list')).toBeVisible();

    // Toggle review off - the list disappears immediately even though the
    // task list itself is preserved (filter keeps its statuses/assignedTo).
    await page.locator('[data-tour="review-toggle"] button').first().click();
    await waitForNavIdle(page);

    await expect(page.getByTestId('review-list')).toHaveCount(0);
  });
});

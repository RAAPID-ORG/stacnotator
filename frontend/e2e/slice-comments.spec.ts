/**
 * Notes attached to one imagery slice: opening the dialog, the indicator that
 * says a slice carries a note, and the note travelling with the submitted
 * annotation. The main map opens on collection 10's cover slice, "Jan 2024"
 * (id 101).
 */
import { test, expect, waitForNavIdle, type CapturedRequest } from './fixtures/annotator-fixture';

const JAN_2024_SLICE_ID = 101;

const mainMapNoteButton = (page: import('@playwright/test').Page) =>
  page.locator('[data-tour="map-controls"] [data-slice-comment-open]');

const dialogInput = (page: import('@playwright/test').Page) =>
  page.locator('[data-slice-comment-input]');

function lastAnnotateRequest(requests: CapturedRequest[]): CapturedRequest | undefined {
  return [...requests]
    .reverse()
    .find((r) => r.method === 'POST' && r.pathname.endsWith('/annotate'));
}

async function writeNote(page: import('@playwright/test').Page, text: string) {
  await page.keyboard.press('Shift+C');
  await expect(dialogInput(page)).toBeVisible();
  await dialogInput(page).fill(text);
  await page.locator('[data-testid="slice-comment-save"]').click();
  await expect(dialogInput(page)).toBeHidden();
}

test.describe('Imagery slice comments', () => {
  test('Shift+C opens a note for the imagery the main map is showing', async ({
    annotationPage,
  }) => {
    await annotationPage.keyboard.press('Shift+C');

    await expect(dialogInput(annotationPage)).toBeVisible();
    await expect(annotationPage.locator('[data-testid="slice-comment-subject"]')).toContainText(
      'Jan 2024'
    );
  });

  test('a saved note marks the slice and comes back on reopen', async ({ annotationPage }) => {
    await expect(mainMapNoteButton(annotationPage)).toHaveAttribute('data-has-note', 'false');

    await writeNote(annotationPage, 'Thin cloud over the plot');

    await expect(mainMapNoteButton(annotationPage)).toHaveAttribute('data-has-note', 'true');

    await mainMapNoteButton(annotationPage).click();
    await expect(dialogInput(annotationPage)).toHaveValue('Thin cloud over the plot');
  });

  test('clearing a note takes the marker off again', async ({ annotationPage }) => {
    await writeNote(annotationPage, 'Thin cloud over the plot');
    await writeNote(annotationPage, '');

    await expect(mainMapNoteButton(annotationPage)).toHaveAttribute('data-has-note', 'false');
  });

  test('the note is submitted with the annotation', async ({ annotationPage, api }) => {
    await writeNote(annotationPage, 'Thin cloud over the plot');

    await annotationPage.locator('button', { hasText: 'Forest' }).first().click();
    await annotationPage.locator('button', { hasText: 'Submit' }).first().click();
    await waitForNavIdle(annotationPage);

    const req = lastAnnotateRequest(api.requests);
    expect(req).toBeDefined();
    expect(req!.body.slice_comments).toEqual([
      expect.objectContaining({
        slice_id: JAN_2024_SLICE_ID,
        text: 'Thin cloud over the plot',
        start_date: '2024-01-01',
      }),
    ]);
  });
});

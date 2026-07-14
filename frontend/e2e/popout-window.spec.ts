/**
 * Multi-monitor pop-out: a canvas card can move into its own browser window
 * and returns to the grid when that window closes. Observed via the popup
 * page object and DOM only - no store globals, no tile requests.
 */
import { test, expect } from './fixtures/annotator-fixture';

test.describe('Pop-out windows', () => {
  test('controls card moves to a popup window and returns on close', async ({
    annotationPage,
  }) => {
    const page = annotationPage;

    const controlsCard = page.locator('[data-tour="controls"]');
    await expect(controlsCard).toBeVisible();

    await controlsCard.hover();
    const popupPromise = page.waitForEvent('popup');
    await page.locator('[data-testid="popout-controls"]').click();
    const popup = await popupPromise;

    // The card content now lives in the popup, not in the grid.
    await expect(popup.locator('button', { hasText: 'Submit' }).first()).toBeVisible();
    await expect(popup.locator('text=Return to canvas')).toBeVisible();
    await expect(controlsCard).toHaveCount(0);

    // Closing the OS window puts the card back into its grid slot.
    await popup.close({ runBeforeUnload: true });
    await expect(page.locator('[data-tour="controls"]')).toBeVisible();
    await expect(page.locator('button', { hasText: 'Submit' }).first()).toBeVisible();
  });

  test('return-to-canvas button restores the card', async ({ annotationPage }) => {
    const page = annotationPage;

    await page.locator('[data-tour="controls"]').hover();
    const popupPromise = page.waitForEvent('popup');
    await page.locator('[data-testid="popout-controls"]').click();
    const popup = await popupPromise;

    await popup.locator('text=Return to canvas').click();
    await expect(page.locator('[data-tour="controls"]')).toBeVisible();
  });
});

/**
 * Multi-monitor screens: canvas cards can be sent to secondary browser
 * windows ("screens") that each host their own arrangeable grid, and return
 * to the main canvas individually or when the screen closes. Observed via
 * the popup page object and DOM only - no store globals, no tile requests.
 */
import { test, expect } from './fixtures/annotator-fixture';

test.describe('Secondary screens', () => {
  test('sending a card opens a screen; more cards join it; closing returns all', async ({
    annotationPage,
  }) => {
    const page = annotationPage;

    const controlsCard = page.locator('[data-tour="controls"]');
    await expect(controlsCard).toBeVisible();

    // First send: no screen open yet, so one click opens Screen 2 directly.
    await controlsCard.hover();
    const popupPromise = page.waitForEvent('popup');
    await page.locator('[data-testid="send-to-screen-controls"]').click();
    const popup = await popupPromise;

    await expect(popup.locator('[data-testid="popout-screen-2"]')).toBeVisible();
    await expect(popup.locator('button', { hasText: 'Submit' }).first()).toBeVisible();
    await expect(controlsCard).toHaveCount(0);

    // Second send: a screen exists now, so the button opens a target menu.
    await page.locator('[data-tour="minimap"]').hover();
    await page.locator('[data-testid="send-to-screen-minimap"]').click();
    await page.locator('[data-testid="send-to-screen-minimap-2"]').click();
    await expect(popup.locator('[data-testid="return-minimap"]')).toBeVisible();
    await expect(page.locator('[data-tour="minimap"]')).toHaveCount(0);

    // Closing the screen window returns every card to the main canvas.
    await popup.close({ runBeforeUnload: true });
    await expect(page.locator('[data-tour="controls"]')).toBeVisible();
    await expect(page.locator('[data-tour="minimap"]')).toBeVisible();
  });

  test('a card returns individually and the screen stays open', async ({ annotationPage }) => {
    const page = annotationPage;

    await page.locator('[data-tour="controls"]').hover();
    const popupPromise = page.waitForEvent('popup');
    await page.locator('[data-testid="send-to-screen-controls"]').click();
    const popup = await popupPromise;

    await popup.locator('[data-testid="return-controls"]').click();
    await expect(page.locator('[data-tour="controls"]')).toBeVisible();
    // The empty screen stays open, inviting more cards.
    await expect(popup.locator('[data-testid="popout-screen-2"]')).toContainText(
      'This screen is empty'
    );
  });
});

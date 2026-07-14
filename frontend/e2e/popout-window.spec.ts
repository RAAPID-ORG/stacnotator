/**
 * Multi-monitor screens: in edit-layout mode, canvas cards can be sent to
 * secondary browser windows ("screens") that each host their own arrangeable
 * grid. Cards return individually or when the screen closes, and the split
 * persists per user+campaign with a one-click restore after reload.
 * Observed via the popup page object and DOM only - no store globals.
 */
import { test, expect } from './fixtures/annotator-fixture';
import type { Page } from '@playwright/test';

async function enterEditMode(page: Page) {
  await page.locator('button', { hasText: 'Edit Layout' }).click();
  // The floating hidden-windows panel overlays bottom-right cards in this
  // viewport; collapse it to its chip so card headers are reachable.
  await page.locator('[aria-label="Minimize hidden windows panel"]').click();
}

async function sendControlsToNewScreen(page: Page) {
  await enterEditMode(page);
  await page.locator('[data-tour="controls"]').hover();
  const popupPromise = page.waitForEvent('popup');
  await page.locator('[data-testid="send-to-screen-controls"]').click();
  return popupPromise;
}

test.describe('Secondary screens', () => {
  test('sending a card opens a screen; more cards join it; closing returns all', async ({
    annotationPage,
  }) => {
    const page = annotationPage;

    // Send buttons are an edit-mode affordance, like hiding windows.
    await expect(page.locator('[data-testid="send-to-screen-controls"]')).toHaveCount(0);

    const popup = await sendControlsToNewScreen(page);
    await expect(popup.locator('[data-testid="popout-screen-2"]')).toBeVisible();
    await expect(popup.locator('button', { hasText: 'Submit' }).first()).toBeVisible();
    await expect(page.locator('[data-tour="controls"]')).toHaveCount(0);

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

    const popup = await sendControlsToNewScreen(page);
    await popup.locator('[data-testid="return-controls"]').click();
    await expect(page.locator('[data-tour="controls"]')).toBeVisible();
    // The empty screen stays open, inviting more cards.
    await expect(popup.locator('[data-testid="popout-screen-2"]')).toContainText(
      'This screen is empty'
    );
  });

  test('the split persists across reload and restores with one click', async ({
    annotationPage,
  }) => {
    const page = annotationPage;

    await sendControlsToNewScreen(page);

    await page.reload();
    await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });

    // Cards start on the main canvas after a reload (popups cannot reopen
    // without a user gesture); the saved split is offered back as a chip.
    await expect(page.locator('[data-tour="controls"]')).toBeVisible();
    const popupPromise = page.waitForEvent('popup');
    await page.locator('[data-testid="restore-screens"]').click();
    const popup = await popupPromise;

    await expect(popup.locator('button', { hasText: 'Submit' }).first()).toBeVisible();
    await expect(page.locator('[data-tour="controls"]')).toHaveCount(0);
  });

  test('dismissing the restore chip forgets the saved split', async ({ annotationPage }) => {
    const page = annotationPage;

    await sendControlsToNewScreen(page);
    await page.reload();
    await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });

    await page.locator('[data-testid="dismiss-saved-screens"]').click();
    await expect(page.locator('[data-testid="restore-screens"]')).toHaveCount(0);
    await expect(page.locator('[data-tour="controls"]')).toBeVisible();
  });
});

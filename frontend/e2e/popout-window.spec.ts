/**
 * Multi-monitor screens: in edit-layout mode, canvas cards can be sent to
 * secondary browser windows ("screens") that each host their own arrangeable
 * grid. Cards return when the screen closes, and the split persists per
 * user+campaign with a one-click restore after reload.
 * Observed via the popup page object and DOM only - no store globals.
 */
import { test, expect } from './fixtures/annotator-fixture';
import type { Page } from '@playwright/test';

async function enterEditMode(page: Page) {
  await page.locator('button', { hasText: 'Edit Layout' }).click();
  // The floating hidden-panels tray overlays bottom-right panels in this
  // viewport; collapse it to its chip so panel headers are reachable.
  await page.getByRole('button', { name: 'Minimize edit layout', exact: true }).click();
}

async function sendControlsToNewScreen(page: Page) {
  await enterEditMode(page);
  await page.locator('[data-tour="controls"]').hover();
  const popupPromise = page.waitForEvent('popup');
  await page.locator('[data-testid="send-to-screen-controls"]').click();
  return popupPromise;
}

test.describe('Secondary screens', () => {
  test('edge scrolling in a secondary canvas stops on focus loss', async ({ annotationPage }) => {
    const popup = await sendControlsToNewScreen(annotationPage);
    await popup.setViewportSize({ width: 900, height: 360 });
    const canvas = popup.getByTestId('popout-screen-2');
    const panel = popup.locator('[data-panel-id="controls"]');
    const header = await panel.locator('.card-header').boundingBox();
    const bounds = await canvas.boundingBox();
    if (!header || !bounds) throw new Error('Secondary canvas or controls header is missing');
    const x = header.x + 30;
    await popup.mouse.move(x, header.y + header.height / 2);
    await popup.mouse.down();
    await popup.mouse.move(x, Math.min(bounds.y + bounds.height, 360) - 8, { steps: 6 });
    await expect.poll(() => canvas.evaluate((node) => node.scrollTop)).toBeGreaterThan(100);
    await popup.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(panel).not.toHaveClass(/react-draggable-dragging/);
    await expect(popup.locator('.react-grid-placeholder')).toHaveCount(0);
    const stoppedAt = await canvas.evaluate((node) => node.scrollTop);
    const afterBlur = await canvas.evaluate(async (node) => {
      for (let i = 0; i < 4; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      return node.scrollTop;
    });
    expect(afterBlur).toBe(stoppedAt);
    await popup.mouse.up();
  });

  test('dragging a secondary panel by its body stops when the window loses focus', async ({
    annotationPage,
  }) => {
    const popup = await sendControlsToNewScreen(annotationPage);
    const panel = popup.locator('[data-panel-id="controls"]');
    const target = panel.getByText('Confidence', { exact: true });
    await target.scrollIntoViewIfNeeded();
    const body = await target.boundingBox();
    if (!body) throw new Error('Secondary screen controls body is missing');
    await popup.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
    await popup.mouse.down();
    await popup.mouse.move(body.x + body.width / 2 + 50, body.y + 50, { steps: 4 });
    await expect(panel).toHaveClass(/react-draggable-dragging/);
    await popup.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(panel).not.toHaveClass(/react-draggable-dragging/);
    await expect(popup.locator('.react-grid-placeholder')).toHaveCount(0);
    await popup.mouse.up();
    const dropped = await panel.boundingBox();
    await popup.mouse.move(body.x + body.width / 2 + 100, body.y + 90, { steps: 4 });
    await expect.poll(() => panel.boundingBox()).toEqual(dropped);
  });

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
    await expect(popup.locator('[data-testid="send-to-screen-minimap"]')).toBeVisible();
    await expect(page.locator('[data-tour="minimap"]')).toHaveCount(0);

    // Closing the screen window returns every card to the main canvas.
    await popup.close({ runBeforeUnload: true });
    await expect(page.locator('[data-tour="controls"]')).toBeVisible();
    await expect(page.locator('[data-tour="minimap"]')).toBeVisible();
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

  test('a card on a screen keeps the main canvas actions: send back, and hide', async ({
    annotationPage,
  }) => {
    const page = annotationPage;
    await enterEditMode(page);

    // An imagery window, so the card is one the main canvas lets you hide.
    const card = page.locator('[data-panel-id="10"]');
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    const popupPromise = page.waitForEvent('popup');
    await page.locator('[data-testid="send-to-screen-10"]').click();
    const popup = await popupPromise;
    await expect(popup.locator('[data-panel-id="10"]')).toBeVisible();

    // Back to the main window from the card's own header.
    await popup.locator('[data-testid="send-to-screen-10"]').click();
    await popup.locator('[data-testid="send-to-screen-10-main"]').click();
    await expect(page.locator('[data-panel-id="10"]')).toBeVisible();
    await expect(popup.getByText('This screen is empty')).toBeVisible();

    // Send it back out, and hide it from where it now sits.
    await page.locator('[data-testid="send-to-screen-10"]').click();
    await page.locator('[data-testid="send-to-screen-10-2"]').click();
    await popup.locator('[data-testid="hide-panel-10"]').click();

    await expect(popup.locator('[data-panel-id="10"]')).toHaveCount(0);
    await expect(page.locator('[data-panel-id="10"]')).toHaveCount(0);
  });

  test('closing a screen is undoable: the chip reopens it with its cards', async ({
    annotationPage,
  }) => {
    const page = annotationPage;

    const popup = await sendControlsToNewScreen(page);
    await page.getByRole('button', { name: 'Show edit layout', exact: true }).click();
    await page
      .getByTestId('layout-footer-actions')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();

    await popup.close({ runBeforeUnload: true });
    await expect(page.locator('[data-tour="controls"]')).toBeVisible();

    const reopened = page.waitForEvent('popup');
    await page.locator('[data-testid="restore-screens"]').click();
    await expect((await reopened).locator('button', { hasText: 'Submit' }).first()).toBeVisible();
    await expect(page.locator('[data-tour="controls"]')).toHaveCount(0);
  });

  test('hiding the restore chip keeps the split for the next visit', async ({ annotationPage }) => {
    const page = annotationPage;

    await sendControlsToNewScreen(page);
    await page.reload();
    await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });

    await page.locator('[data-testid="hide-restore-screens"]').click();
    await expect(page.locator('[data-testid="restore-screens"]')).toHaveCount(0);
    await expect(page.locator('[data-tour="controls"]')).toBeVisible();

    await page.reload();
    await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
    await expect(page.locator('[data-testid="restore-screens"]')).toBeVisible();
  });
});

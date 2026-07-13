import { test, expect } from './fixtures/annotator-fixture';
import type { ApiCapture } from './fixtures/annotator-fixture';
import { MOCK_CAMPAIGN_OPEN_MODE } from './fixtures/mock-data';

type Page = import('@playwright/test').Page;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait until open mode has finished laying out (toolbar + map ready). */
async function waitOpenModeReady(page: Page): Promise<void> {
  await page.waitForSelector('[data-tour="toolbar"]', { timeout: 15_000 });
  await page.locator('[title="Pan (P)"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(
    () => !!document.querySelector('[data-tour="minimap"]')?.getAttribute('data-center-lat'),
    undefined,
    { timeout: 10_000 }
  );
}

async function loadOpenMode(page: Page, api: ApiCapture): Promise<void> {
  await page.route('**/api/campaigns/*/detailed', async (route) => {
    await route.fulfill({ json: MOCK_CAMPAIGN_OPEN_MODE });
  });
  await page.reload();
  await waitOpenModeReady(page);
  api.clear();
}

const controls = (page: Page) => page.locator('[data-tour="controls"]');

/** Open the inline style editor for the first label (Tree) and return its parts. */
async function openFirstLabelStyleEditor(page: Page) {
  await page.keyboard.press('r'); // annotate -> reveal the label list
  await controls(page).locator('[title="Customize this label\'s style"]').first().click();
  return {
    fillColorInput: controls(page).locator('[title="Fill color"]'),
    swatch: controls(page).locator('span.rounded-sm').first(),
  };
}

// ---------------------------------------------------------------------------
// Per-label styling persists across reloads
// ---------------------------------------------------------------------------

test.describe('Open mode - per-label styling', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadOpenMode(annotationPage, api);
  });

  test('a per-label fill color recolors the swatch and survives a reload', async ({
    annotationPage: page,
  }) => {
    // Starts on the label's default color (Tree = first LABEL_COLORS entry).
    const editor = await openFirstLabelStyleEditor(page);
    await expect(editor.fillColorInput).toHaveValue('#10b981');
    await expect
      .poll(() => editor.swatch.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe('rgb(16, 185, 129)');

    // User picks their own fill color.
    await editor.fillColorInput.fill('#ff00aa');
    await expect
      .poll(() => editor.swatch.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe('rgb(255, 0, 170)');

    // Reload the whole app: the override must come back from localStorage,
    // not reset to the default color.
    await page.reload();
    await waitOpenModeReady(page);

    const reopened = await openFirstLabelStyleEditor(page);
    await expect(reopened.fillColorInput).toHaveValue('#ff00aa');
    await expect
      .poll(() => reopened.swatch.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe('rgb(255, 0, 170)');
  });

  test('Reset to default clears the override', async ({ annotationPage: page }) => {
    const editor = await openFirstLabelStyleEditor(page);
    await editor.fillColorInput.fill('#123456');
    await expect(editor.fillColorInput).toHaveValue('#123456');

    await controls(page).getByText('Reset to default').click();
    await expect(controls(page).locator('[title="Fill color"]')).toHaveValue('#10b981');
  });
});

// ---------------------------------------------------------------------------
// Visibility toggle: button and the D hotkey drive the same state
// ---------------------------------------------------------------------------

test.describe('Open mode - drawn object visibility', () => {
  test.beforeEach(async ({ annotationPage, api }) => {
    await loadOpenMode(annotationPage, api);
  });

  test('the eye button and the X hotkey both toggle visibility', async ({
    annotationPage: page,
  }) => {
    const hideBtn = page.locator('[title="Hide drawn objects (X)"]');
    const showBtn = page.locator('[title="Show drawn objects (X)"]');

    // Default: objects shown -> button offers to Hide.
    await expect(hideBtn).toBeVisible();

    // Click hides; the control flips to offer Show.
    await hideBtn.click();
    await expect(showBtn).toBeVisible();
    await expect(hideBtn).toHaveCount(0);

    // The Shift+X hotkey toggles the same state back to shown.
    await page.keyboard.press('Shift+X');
    await expect(hideBtn).toBeVisible();
    await expect(showBtn).toHaveCount(0);
  });

  test('the toggle is not bound to keys already used in open mode', async ({
    annotationPage: page,
  }) => {
    // `a`/`d` drive slice navigation (live in open mode via the task-mode
    // keyboard hook), `p` is Pan, `e` is Edit. None of them may toggle
    // annotation visibility - regression guard against a key collision.
    const hideBtn = page.locator('[title="Hide drawn objects (X)"]');
    await expect(hideBtn).toBeVisible();

    for (const key of ['d', 'a', 'p', 'e']) {
      await page.keyboard.press(key);
      await expect(hideBtn).toBeVisible(); // still "Hide" => still shown
    }
  });
});
